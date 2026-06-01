//
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { AccountClient, Integration } from '@hcengineering/account-client'
import {
  MeasureContext,
  RateLimiter,
  WorkspaceInfoWithStatus,
  WorkspaceUuid,
  isActiveMode,
  isDeletingMode
} from '@hcengineering/core'
import { getAccountClient } from '@hcengineering/server-client'
import config from './config'
import { getIntegrations } from './integrations'
import { IncomingSyncManager } from './sync'
import { getWorkspaceTokens } from './tokens'
import { WorkspaceClient } from './workspaceClient'

interface WorkspaceStateInfo {
  shouldStart: boolean
  needRecheck: boolean
}

export class CalendarController {
  protected static _instance: CalendarController
  private periodicSyncTimer: NodeJS.Timeout | undefined
  private periodicSyncRunning = false

  private constructor (
    private readonly ctx: MeasureContext,
    readonly accountClient: AccountClient
  ) {
    CalendarController._instance = this
  }

  static getCalendarController (ctx: MeasureContext, accountClient: AccountClient): CalendarController {
    if (CalendarController._instance !== undefined) {
      return CalendarController._instance
    }
    return new CalendarController(ctx, accountClient)
  }

  async startAll (): Promise<void> {
    try {
      const integrations = await getIntegrations(this.accountClient)
      this.ctx.info('Start integrations', { count: integrations.length })

      const groups = new Map<WorkspaceUuid, Integration[]>()
      for (const int of integrations) {
        if (int.workspaceUuid === null) continue
        const group = groups.get(int.workspaceUuid)
        if (group === undefined) {
          groups.set(int.workspaceUuid, [int])
        } else {
          group.push(int)
          groups.set(int.workspaceUuid, group)
        }
      }
      void this.runAll(groups)
    } catch (err: any) {
      this.ctx.error('Failed to start existing integrations', err)
    }
  }

  // Periodic safety-net sync: re-runs startAll() on an interval to catch events
  // missed when Google push notifications fail to reach the webhook. The
  // per-user mutex in IncomingSyncManager prevents overlap with push-driven syncs.
  startPeriodicSync (): void {
    if (config.PeriodicSyncInterval <= 0) {
      this.ctx.info('Periodic sync disabled (PERIODIC_SYNC_INTERVAL=0)')
      return
    }
    const intervalMs = config.PeriodicSyncInterval * 60 * 1000
    this.ctx.info('Periodic sync enabled', { intervalMinutes: config.PeriodicSyncInterval })
    this.periodicSyncTimer = setInterval(() => {
      void this.runPeriodicSync()
    }, intervalMs)
  }

  stopPeriodicSync (): void {
    if (this.periodicSyncTimer !== undefined) {
      clearInterval(this.periodicSyncTimer)
      this.periodicSyncTimer = undefined
    }
  }

  private async runPeriodicSync (): Promise<void> {
    if (this.periodicSyncRunning) {
      this.ctx.info('Periodic sync skipped — previous run still in progress')
      return
    }
    this.periodicSyncRunning = true
    const started = Date.now()
    try {
      this.ctx.info('Periodic sync started')
      await this.startAll()
      this.ctx.info('Periodic sync finished', { durationMs: Date.now() - started })
    } catch (err: any) {
      this.ctx.error('Periodic sync error', { err: err?.message ?? String(err) })
    } finally {
      this.periodicSyncRunning = false
    }
  }

  // Triggered by the "refresh" button no Planner. Faz full reconciliation
  // bidirecional (Google ↔ Huly) só das integrações do usuário autenticado.
  // Diferente do sync incremental, busca a lista COMPLETA dos dois lados e
  // reconcilia por eventId — pega criações/atualizações/inserções que
  // escaparam do push notification ou do trigger.
  async forceSyncUser (
    userToken: string,
    workspace: WorkspaceUuid
  ): Promise<{
    integrations: number
    calendars: number
    created: number
    updated: number
    pushedToGoogle: number
    errors: number
    durationMs: number
  }> {
    const started = Date.now()
    const userAccountClient = getAccountClient(userToken)
    const socialIds = await userAccountClient.getSocialIds(true)
    const ids = new Set(socialIds.map((s) => s._id))

    const allTokens = await getWorkspaceTokens(this.accountClient, workspace)
    const userTokens = allTokens.filter((t) => ids.has(t.socialId))

    this.ctx.info('Force reconcile user', {
      workspace,
      integrations: userTokens.length
    })

    let calendars = 0
    let created = 0
    let updated = 0
    let pushedToGoogle = 0
    let errors = 0

    for (const t of userTokens) {
      const parsedToken = JSON.parse(t.secret)
      try {
        // Why: timeout de 90s — reconcile pode demorar mais que sync incremental
        // (lista completa de eventos no Google + comparações). Nginx default é
        // 60s; o usuário fica com 504 mas o trabalho termina no background.
        // Para calendar com 1000+ eventos pode passar disso.
        const result = await Promise.race([
          IncomingSyncManager.reconcile(this.ctx, this.accountClient, parsedToken, parsedToken.email),
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              reject(new Error('Reconcile timeout after 90s'))
            }, 90_000)
          )
        ])
        calendars += result.calendars
        created += result.created
        updated += result.updated
        pushedToGoogle += result.pushedToGoogle
      } catch (err: any) {
        errors++
        this.ctx.error('Force reconcile — error', {
          email: t.key,
          err: err?.message ?? String(err)
        })
      }
    }

    const result = {
      integrations: userTokens.length,
      calendars,
      created,
      updated,
      pushedToGoogle,
      errors,
      durationMs: Date.now() - started
    }
    this.ctx.info('Force reconcile user finished', { workspace, ...result })
    return result
  }

  private async runAll (groups: Map<WorkspaceUuid, Integration[]>): Promise<void> {
    const ids = [...groups.keys()]
    if (ids.length === 0) return
    const limiter = new RateLimiter(config.InitLimit)
    const infos = await this.accountClient.getWorkspacesInfo(ids)
    const outdatedWorkspaces = new Set<WorkspaceUuid>()
    for (let index = 0; index < infos.length; index++) {
      const info = infos[index]
      const integrations = groups.get(info.uuid) ?? []
      const { shouldStart, needRecheck } = await this.checkWorkspace(info, integrations)

      if (shouldStart) {
        await limiter.add(async () => {
          try {
            this.ctx.info('start workspace', { workspace: info.uuid })
            await WorkspaceClient.run(this.ctx, this.accountClient, info.uuid)
          } catch (err) {
            this.ctx.error('Failed to start workspace', { workspace: info.uuid, error: err })
          }
        })
      }

      if (needRecheck) {
        outdatedWorkspaces.add(info.uuid)
      }

      if (index % 10 === 0) {
        this.ctx.info('starting progress', { value: index + 1, total: infos.length })
      }
    }
    await limiter.waitProcessing()
    this.ctx.info('Started all workspaces', { count: infos.length })

    if (outdatedWorkspaces.size > 0) {
      this.ctx.info('Found outdated workspaces for future recheck', { count: outdatedWorkspaces.size })
      // Schedule recheck for outdated workspaces
      const outdatedGroups = new Map<WorkspaceUuid, Integration[]>()
      for (const workspaceId of outdatedWorkspaces) {
        const integrations = groups.get(workspaceId)
        if (integrations !== undefined) {
          outdatedGroups.set(workspaceId, integrations)
        }
      }
      void this.recheckOutdatedWorkspaces(outdatedGroups)
    }
  }

  private async checkWorkspace (
    info: WorkspaceInfoWithStatus,
    integrations: Integration[]
  ): Promise<WorkspaceStateInfo> {
    if (isDeletingMode(info.mode)) {
      if (integrations !== undefined) {
        for (const int of integrations) {
          await this.accountClient.deleteIntegration(int)
        }
      }
      return { shouldStart: false, needRecheck: false }
    }
    if (!isActiveMode(info.mode)) {
      this.ctx.info('workspace is not active', { workspaceUuid: info.uuid })
      return { shouldStart: false, needRecheck: false }
    }
    const lastVisit = (Date.now() - (info.lastVisit ?? 0)) / (3600 * 24 * 1000) // In days

    if (lastVisit > config.WorkspaceInactivityInterval) {
      this.ctx.info('workspace is outdated, needs recheck', {
        workspaceUuid: info.uuid,
        lastVisitDays: lastVisit.toFixed(1)
      })
      return { shouldStart: false, needRecheck: true }
    }
    return { shouldStart: true, needRecheck: false }
  }

  // TODO: Subscribe to workspace queue istead of using setTimeout
  async recheckOutdatedWorkspaces (outdatedGroups: Map<WorkspaceUuid, Integration[]>): Promise<void> {
    try {
      await new Promise<void>((resolve) => {
        setTimeout(
          () => {
            resolve()
          },
          10 * 60 * 1000
        ) // Wait 10 minutes
      })

      const ids = [...outdatedGroups.keys()]
      const limiter = new RateLimiter(config.InitLimit)
      const infos = await this.accountClient.getWorkspacesInfo(ids)
      const stillOutdatedGroups = new Map<WorkspaceUuid, Integration[]>()

      for (let index = 0; index < infos.length; index++) {
        const info = infos[index]
        const integrations = outdatedGroups.get(info.uuid) ?? []
        const { shouldStart, needRecheck } = await this.checkWorkspace(info, integrations)

        if (shouldStart) {
          await limiter.add(async () => {
            try {
              this.ctx.info('restarting previously outdated workspace', { workspace: info.uuid })
              await WorkspaceClient.run(this.ctx, this.accountClient, info.uuid)
            } catch (err) {
              this.ctx.error('Failed to restart workspace', { workspace: info.uuid, error: err })
            }
          })
        } else if (needRecheck) {
          // Keep this workspace for future recheck
          stillOutdatedGroups.set(info.uuid, integrations)
        }
      }

      await limiter.waitProcessing()

      if (stillOutdatedGroups.size > 0) {
        this.ctx.info('Still outdated workspaces, scheduling next recheck', { count: stillOutdatedGroups.size })
        void this.recheckOutdatedWorkspaces(stillOutdatedGroups)
      }
    } catch (err: any) {
      this.ctx.error('Failed to recheck outdated workspaces', { error: err })
    }
  }
}
