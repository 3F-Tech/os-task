//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { getClient as getAccountClient } from '@hcengineering/account-client'
import { createRestTxOperations } from '@hcengineering/api-client'
import { MeasureMetricsContext, systemAccountUuid, TxOperations, type Class, type Doc, type Markup, type Ref, type WorkspaceUuid } from '@hcengineering/core'
import { getPlatformQueue } from '@hcengineering/kafka'
import { generateToken } from '@hcengineering/server-token'
import { QueueTopic } from '@hcengineering/server-core'
import type { Issue, IssueStatus, PdcaFrequency } from '@hcengineering/tracker'
import tracker from '@hcengineering/tracker'
import type { TimeMachineDB } from './db'
import config from './config'

const SERVICE_NAME = 'pdca-worker'

export interface PdcaCycleEvent {
  issueId: Ref<Issue>
  workspaceId: WorkspaceUuid
}

interface TimeMachineMessage {
  type: 'schedule' | 'cancel'
  id: string
  targetDate?: number
  topic?: string
  data?: any
}

function calculateNextCycleDate (frequency: PdcaFrequency, from: number): number {
  const date = new Date(from)
  if (frequency === 'weekly') {
    const daysUntilMonday = ((8 - date.getDay()) % 7) || 7
    date.setDate(date.getDate() + daysUntilMonday)
    date.setHours(0, 0, 0, 0)
  } else if (frequency === 'biweekly') {
    date.setDate(date.getDate() + 14)
    date.setHours(0, 0, 0, 0)
  } else {
    date.setMonth(date.getMonth() + 1, 1)
    date.setHours(0, 0, 0, 0)
  }
  return date.getTime()
}

function calculateDueDate (frequency: PdcaFrequency, dueDays: number[] | undefined): number | null {
  if (dueDays == null || dueDays.length === 0) return null
  const now = new Date()

  if (frequency === 'weekly') {
    const targetWeekday = dueDays[0] // 0=Sun, 1=Mon, ..., 6=Sat
    const currentDay = now.getDay()
    let daysUntil = (targetWeekday - currentDay + 7) % 7
    if (daysUntil === 0) daysUntil = 7
    const due = new Date(now)
    due.setDate(now.getDate() + daysUntil)
    due.setHours(23, 59, 0, 0)
    return due.getTime()
  }

  if (frequency === 'monthly') {
    const targetDay = dueDays[0]
    const due = new Date(now.getFullYear(), now.getMonth(), targetDay, 23, 59, 0, 0)
    if (due.getTime() <= now.getTime()) {
      due.setMonth(due.getMonth() + 1)
    }
    return due.getTime()
  }

  if (frequency === 'biweekly') {
    const sorted = [...dueDays].sort((a, b) => a - b)
    const todayDay = now.getDate()
    const nextDay = sorted.find((d) => d > todayDay)
    if (nextDay != null) {
      const due = new Date(now.getFullYear(), now.getMonth(), nextDay, 23, 59, 0, 0)
      return due.getTime()
    }
    // wrap to next month, first of the sorted days
    const due = new Date(now.getFullYear(), now.getMonth() + 1, sorted[0], 23, 59, 0, 0)
    return due.getTime()
  }

  return null
}

// Stable class ID — avoids pulling @hcengineering/chunter (UI deps) into the worker
const CHAT_MESSAGE_CLASS = 'chunter:class:ChatMessage' as unknown as Ref<Class<Doc>>

function formatHours (hours: number): string {
  if (hours <= 0) return '0h'
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function formatTs (ts: number | null | undefined): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleDateString('pt-BR')
}

function buildMarkup (lines: string[]): Markup {
  const content = lines.map((text) => ({
    type: 'paragraph',
    content: text !== '' ? [{ type: 'text', text }] : []
  }))
  return JSON.stringify({ type: 'doc', content }) as Markup
}

async function addCycleComment (
  client: TxOperations,
  issue: Issue,
  statusName: string,
  reportedTime: number,
  dueDate: number | null | undefined,
  completedDate: number | null | undefined
): Promise<void> {
  const markup = buildMarkup([
    '🔄 Ciclo PDCA reiniciado',
    `Status anterior: ${statusName}`,
    `Tempo registrado: ${formatHours(reportedTime)}`,
    `Vencimento anterior: ${formatTs(dueDate)}`,
    `Data de conclusão: ${formatTs(completedDate)}`
  ])
  await client.addCollection(
    CHAT_MESSAGE_CLASS as any,
    issue.space,
    issue._id,
    issue._class,
    'comments',
    { message: markup } as any
  )
}

async function createWorkspaceClient (workspaceUuid: WorkspaceUuid): Promise<TxOperations> {
  const token = generateToken(systemAccountUuid, workspaceUuid, { service: SERVICE_NAME })
  const accountClient = getAccountClient(config.AccountsUrl, token)
  const wsInfo = await accountClient.getLoginInfoByToken()
  if (wsInfo == null || !('endpoint' in wsInfo)) {
    throw new Error(`Could not get workspace info for ${workspaceUuid}`)
  }
  const transactorUrl = wsInfo.endpoint.replace('ws://', 'http://').replace('wss://', 'https://')
  return await createRestTxOperations(transactorUrl, wsInfo.workspace, wsInfo.token, true)
}

export async function processPdcaCycleEvent (
  ctx: MeasureMetricsContext,
  event: PdcaCycleEvent
): Promise<void> {
  const { issueId, workspaceId } = event
  let client: TxOperations | undefined

  try {
    client = await createWorkspaceClient(workspaceId)
    const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

    if (issue == null) {
      ctx.warn('PDCA cycle: issue not found', { issueId, workspaceId })
      return
    }

    const isActive = (issue as any).pdcaCycleActive === true
    const frequency = (issue as any).pdcaCycleFrequency as PdcaFrequency | undefined
    const resetStatus = (issue as any).pdcaCycleResetStatus as Ref<IssueStatus> | undefined
    const dueDays = (issue as any).pdcaCycleDueDays as number[] | undefined
    const shouldDuplicate = (issue as any).pdcaCycleDuplicate === true

    if (!isActive || frequency == null || resetStatus == null) {
      ctx.info('PDCA cycle: skipping — cycle not fully configured or inactive', { issueId })
      return
    }

    const dueDate = calculateDueDate(frequency, dueDays)
    const nextDate = calculateNextCycleDate(frequency, Date.now())
    ctx.info('PDCA cycle: calculated dates', { issueId, frequency, dueDays, dueDate, nextDate })

    // Capture snapshot before any mutation
    const prevStatusDoc = await client.findOne(tracker.class.IssueStatus, { _id: issue.status })
    const prevStatusName = prevStatusDoc?.name ?? '—'
    const prevReportedTime = issue.reportedTime ?? 0
    const prevDueDate = issue.dueDate
    const prevCompletedDate = issue.completedDate

    let scheduleIssueId: Ref<Issue> = issueId

    if (shouldDuplicate) {
      // Create new issue as copy; the cycle continues on the new issue
      const wonStatuses = await client.findAll(tracker.class.IssueStatus, {})
      const wonStatus = wonStatuses.find((s: any) => s.category === 'task:category:Won')

      const newIssueData: Record<string, any> = {
        title: issue.title,
        status: resetStatus,
        kind: issue.kind,
        assignee: issue.assignee,
        priority: issue.priority,
        component: issue.component,
        milestone: issue.milestone,
        estimation: issue.estimation,
        reportedTime: 0,
        startDate: Date.now(),
        dueDate: dueDate ?? null,
        pdcaCycleActive: true,
        pdcaCycleFrequency: frequency,
        pdcaCycleResetStatus: resetStatus,
        pdcaCycleDueDays: dueDays,
        pdcaCycleDuplicate: true,
        pdcaNextCycleDate: nextDate,
        clientName: (issue as any).clientName,
        clientStage: (issue as any).clientStage
      }

      const newId = await client.addCollection(
        tracker.class.Issue,
        issue.space,
        issue.attachedTo ?? issue.space,
        (issue.attachedToClass ?? tracker.class.Project) as any,
        'issues',
        newIssueData as any
      )
      scheduleIssueId = newId as Ref<Issue>
      ctx.info('PDCA cycle: new issue created as duplicate', { issueId, newIssueId: newId })

      // Mark original as done and deactivate its PDCA
      if (wonStatus != null) {
        await client.update(issue, { status: wonStatus._id, pdcaCycleActive: false } as any)
      }
      ctx.info('PDCA cycle: original issue marked as done', { issueId })
      try {
        await addCycleComment(client, issue, prevStatusName, prevReportedTime, prevDueDate, prevCompletedDate)
      } catch (commentErr: any) {
        ctx.warn('PDCA cycle: failed to add snapshot comment', { issueId, err: commentErr.message })
      }
    } else {
      // Standard mode: reset status, spent time, dates
      const update: Record<string, any> = {
        status: resetStatus,
        reportedTime: 0,
        startDate: Date.now(),
        pdcaNextCycleDate: nextDate
      }
      if (dueDate != null) update.dueDate = dueDate
      await client.update(issue, update as any)
      await client.update(issue, { completedDate: null } as any)
      ctx.info('PDCA cycle: status reset', { issueId, resetStatus })
      try {
        await addCycleComment(client, issue, prevStatusName, prevReportedTime, prevDueDate, prevCompletedDate)
      } catch (commentErr: any) {
        ctx.warn('PDCA cycle: failed to add snapshot comment', { issueId, err: commentErr.message })
      }
    }

    const queue = getPlatformQueue(SERVICE_NAME, config.QueueRegion)
    const producer = queue.getProducer<TimeMachineMessage>(ctx, QueueTopic.TimeMachine)
    await producer.send(ctx, workspaceId, [{
      type: 'schedule',
      id: `pdca_${scheduleIssueId}`,
      targetDate: nextDate,
      topic: QueueTopic.PdcaCycle,
      data: { issueId: scheduleIssueId, workspaceId }
    }])
  } catch (err: any) {
    ctx.error('PDCA cycle processing error', { issueId, workspaceId, err: err.message })
  } finally {
    if (client != null) {
      await client.close()
    }
  }
}

export function startPdcaConsumer (ctx: MeasureMetricsContext): void {
  const queue = getPlatformQueue(SERVICE_NAME, config.QueueRegion)
  queue.createConsumer<PdcaCycleEvent>(
    ctx,
    QueueTopic.PdcaCycle,
    'pdca-worker-group',
    async (ctx, msg) => {
      await processPdcaCycleEvent(ctx as MeasureMetricsContext, msg.value)
    }
  )
}

export async function bootstrapPdcaSchedules (ctx: MeasureMetricsContext, db: TimeMachineDB): Promise<void> {
  let workspaceIds: WorkspaceUuid[]
  try {
    workspaceIds = await db.getActiveWorkspaces()
  } catch (err: any) {
    ctx.warn('PDCA bootstrap: failed to list workspaces', { err: err.message })
    return
  }

  for (const workspaceId of workspaceIds) {
    let client: TxOperations | undefined
    try {
      client = await createWorkspaceClient(workspaceId)
      const issues = await client.findAll(tracker.class.Issue, { pdcaCycleActive: true } as any)

      for (const issue of issues) {
        const frequency = (issue as any).pdcaCycleFrequency as PdcaFrequency | undefined
        const resetStatus = (issue as any).pdcaCycleResetStatus
        if (frequency == null || resetStatus == null) continue

        const existingDate = (issue as any).pdcaNextCycleDate as number | undefined
        const targetDate = existingDate ?? calculateNextCycleDate(frequency, Date.now())

        if (existingDate == null) {
          await client.update(issue, { pdcaNextCycleDate: targetDate } as any)
        }

        await db.upsertEvent({
          id: `pdca_${issue._id}`,
          workspace: workspaceId,
          target_date: targetDate,
          topic: QueueTopic.PdcaCycle,
          data: { issueId: issue._id, workspaceId }
        })

        ctx.info('PDCA bootstrap: scheduled', { issueId: issue._id, targetDate: new Date(targetDate).toISOString(), workspace: workspaceId })
      }
    } catch (err: any) {
      ctx.warn('PDCA bootstrap: error for workspace', { workspace: workspaceId, err: err.message })
    } finally {
      await client?.close()
    }
  }
}
