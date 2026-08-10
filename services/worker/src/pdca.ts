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
  retryCount?: number
  // Advancement watermark: the value of pdcaNextCycleDate at the moment this
  // event was scheduled. If the issue's actual pdcaNextCycleDate has moved
  // past this value when the event fires, the cycle was already processed
  // (e.g. by a redelivered Kafka message) and we must skip.
  expectedNextCycleDate?: number
}

interface TimeMachineMessage {
  type: 'schedule' | 'cancel'
  id: string
  targetDate?: number
  topic?: string
  data?: any
}

const MAX_RETRIES = 3
const RETRY_BACKOFF_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000] // 5min, 30min, 2h

// Jitter determinístico para quebrar a rajada. calculateNextCycleDate joga todo
// ciclo semanal na segunda 00:00 e todo mensal no dia 1 00:00 — então centenas
// disparam no MESMO instante e saturam o transactor (foi o que expôs o crash
// intermitente do api-client). Espalhamos o PRÓXIMO disparo em até
// SCHEDULE_JITTER_MS, com offset ESTÁVEL por issue (mesma issue → mesmo offset),
// para o watermark de dedup continuar batendo em reentregas do Kafka.
// Obs.: só afeta agendamentos calculados AQUI no worker (próximos ciclos). Os
// disparos já agendados (ex.: a rajada de 01/09 marcada pelo backfill) continuam
// em 00:00 — para aqueles a rede de segurança é o retry (isTransientError acima).
const SCHEDULE_JITTER_MS = 4 * 60 * 60 * 1000 // 4h → 00:00–04:00 (ainda de madrugada)
function scheduleJitter (issueId: string): number {
  let h = 0
  for (let i = 0; i < issueId.length; i++) h = (h * 31 + issueId.charCodeAt(i)) | 0
  return Math.abs(h) % SCHEDULE_JITTER_MS
}

// No boot, um instante de disparo com >= este nº de issues é tratado como "rajada"
// e espalhado (des-herd retroativo dos agendamentos JÁ existentes, ex.: 01/09).
const BOOTSTRAP_DEHERD_THRESHOLD = 20

function isTransientError (err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase()
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    // Sob rajada (todos os semanais caem seg. 00:00 e os mensais no dia 1), o
    // api-client do worker às vezes recebe uma resposta degradada do transactor e
    // estoura "Cannot read properties of null (reading '#<Object>')". É intermitente
    // (a MESMA issue ora falha ora passa) → tratar como transitório: o retry com
    // backoff (5min/30min/2h) cai depois do pico, quando o transactor já vazou a fila.
    msg.includes('cannot read properties of null')
  )
}

function calculateNextCycleDate (frequency: PdcaFrequency, from: number, customWeekdays?: number[]): number {
  const date = new Date(from)
  if (frequency === 'daily') {
    date.setDate(date.getDate() + 1)
    date.setHours(0, 0, 0, 0)
  } else if (frequency === 'weekly') {
    const daysUntilMonday = ((8 - date.getDay()) % 7) || 7
    date.setDate(date.getDate() + daysUntilMonday)
    date.setHours(0, 0, 0, 0)
  } else if (frequency === 'biweekly') {
    date.setDate(date.getDate() + 14)
    date.setHours(0, 0, 0, 0)
  } else if (frequency === 'quarterly') {
    date.setMonth(date.getMonth() + 3, 1)
    date.setHours(0, 0, 0, 0)
  } else if (frequency === 'custom') {
    if (customWeekdays != null && customWeekdays.length > 0) {
      const sorted = [...customWeekdays].sort((a, b) => a - b)
      const currentDow = date.getDay()
      const nextDow = sorted.find((d) => d > currentDow)
      const daysAhead = nextDow !== undefined ? nextDow - currentDow : 7 - currentDow + sorted[0]
      date.setDate(date.getDate() + daysAhead)
      date.setHours(0, 0, 0, 0)
    } else {
      date.setDate(date.getDate() + 7)
      date.setHours(0, 0, 0, 0)
    }
  } else {
    date.setMonth(date.getMonth() + 1, 1)
    date.setHours(0, 0, 0, 0)
  }
  return date.getTime()
}

function calculateDueDate (
  frequency: PdcaFrequency,
  dueDays: number[] | undefined,
  customWeekdays?: number[]
): number | null {
  const now = new Date()

  if (frequency === 'daily') {
    const due = new Date(now)
    due.setHours(23, 59, 0, 0)
    return due.getTime()
  }

  if (frequency === 'custom') {
    if (customWeekdays == null || customWeekdays.length === 0) return null
    const sorted = [...customWeekdays].sort((a, b) => a - b)
    const currentDow = now.getDay()
    const nextDow = sorted.find((d) => d > currentDow)
    const daysAhead = nextDow !== undefined ? nextDow - currentDow : 7 - currentDow + sorted[0]
    const due = new Date(now)
    due.setDate(now.getDate() + daysAhead)
    due.setHours(23, 59, 0, 0)
    return due.getTime()
  }

  if (dueDays == null || dueDays.length === 0) return null

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
  // Assina com config.Secret explicitamente. Sem o 4º arg, generateToken cai em
  // getMetadata(serverToken.metadata.Secret) — que o worker nunca seta — e usa o
  // default 'secret'. Batia por acaso em prod até o SERVER_SECRET ser rotacionado
  // (2026-07-09); depois o account passou a rejeitar todo token (Unauthorized) e
  // nenhum ciclo PDCA reiniciava.
  const token = generateToken(systemAccountUuid, workspaceUuid, { service: SERVICE_NAME }, config.Secret)
  const accountClient = getAccountClient(config.AccountsUrl, token)
  const wsInfo = await accountClient.getLoginInfoByToken()
  if (wsInfo == null || !('endpoint' in wsInfo)) {
    throw new Error(`Could not get workspace info for ${workspaceUuid}`)
  }
  const endpoint = config.TransactorUrl ?? wsInfo.endpoint
  const transactorUrl = endpoint.replace('ws://', 'http://').replace('wss://', 'https://')
  return await createRestTxOperations(transactorUrl, wsInfo.workspace, wsInfo.token, true)
}

async function rescheduleForRetry (
  ctx: MeasureMetricsContext,
  event: PdcaCycleEvent,
  err: any
): Promise<void> {
  const retryCount = event.retryCount ?? 0
  if (retryCount >= MAX_RETRIES) {
    ctx.error('PDCA cycle: giving up after retries', {
      issueId: event.issueId,
      workspaceId: event.workspaceId,
      retryCount,
      err: err?.message ?? String(err)
    })
    return
  }
  const delayMs = RETRY_BACKOFF_MS[retryCount] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
  const targetDate = Date.now() + delayMs
  ctx.warn('PDCA cycle: rescheduling after transient error', {
    issueId: event.issueId,
    workspaceId: event.workspaceId,
    retryCount: retryCount + 1,
    delayMs,
    err: err?.message ?? String(err)
  })
  try {
    const queue = getPlatformQueue(SERVICE_NAME, config.QueueRegion)
    const producer = queue.getProducer<TimeMachineMessage>(ctx, QueueTopic.TimeMachine)
    await producer.send(ctx, event.workspaceId, [{
      type: 'schedule',
      id: `pdca_${event.issueId}`,
      targetDate,
      topic: QueueTopic.PdcaCycle,
      data: { issueId: event.issueId, workspaceId: event.workspaceId, retryCount: retryCount + 1 }
    }])
  } catch (rescheduleErr: any) {
    ctx.error('PDCA cycle: failed to reschedule retry', {
      issueId: event.issueId,
      err: rescheduleErr?.message ?? String(rescheduleErr)
    })
  }
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
    const customWeekdays = (issue as any).pdcaCycleCustomWeekdays as number[] | undefined
    const shouldDuplicate = (issue as any).pdcaCycleDuplicate === true
    const resetSubIssues = (issue as any).pdcaCycleResetSubIssues === true
    const currentNextDate = (issue as any).pdcaNextCycleDate as number | undefined

    if (!isActive || frequency == null || resetStatus == null) {
      ctx.info('PDCA cycle: skipping — cycle not fully configured or inactive', { issueId })
      return
    }

    if (frequency === 'custom' && (customWeekdays == null || customWeekdays.length === 0)) {
      ctx.info('PDCA cycle: skipping — custom frequency without weekdays', { issueId })
      return
    }

    // Idempotency guard: if this event was scheduled with a specific watermark
    // and the issue's pdcaNextCycleDate has already moved past that watermark,
    // the cycle was already processed (typically by a redelivered Kafka msg).
    if (
      event.expectedNextCycleDate != null &&
      currentNextDate != null &&
      currentNextDate > event.expectedNextCycleDate
    ) {
      ctx.info('PDCA cycle: skipping — cycle already advanced (dedup)', {
        issueId,
        expected: event.expectedNextCycleDate,
        actual: currentNextDate
      })
      return
    }

    const dueDate = calculateDueDate(frequency, dueDays, customWeekdays)
    const nextDate = calculateNextCycleDate(frequency, Date.now(), customWeekdays) + scheduleJitter(String(issueId))
    ctx.info('PDCA cycle: calculated dates', { issueId, frequency, dueDays, customWeekdays, dueDate, nextDate })

    // Advance the watermark FIRST. Any concurrent re-delivery of this same
    // event will read this updated pdcaNextCycleDate and skip on the
    // idempotency guard above. Race window is now bounded to a single
    // findOne+update round-trip.
    await client.update(issue, { pdcaNextCycleDate: nextDate } as any)

    // Capture snapshot before any mutation
    const prevStatusDoc = await client.findOne(tracker.class.IssueStatus, { _id: issue.status })
    const prevStatusName = prevStatusDoc?.name ?? '—'
    const prevReportedTime = issue.reportedTime ?? 0
    const prevDueDate = issue.dueDate
    const prevCompletedDate = issue.completedDate

    let scheduleIssueId: Ref<Issue> = issueId

    if (shouldDuplicate) {
      // Deactivate ORIGINAL first and mark as done, so any concurrent
      // redelivery of this event reads pdcaCycleActive=false and skips.
      // Without this the storm could create N copies before any deactivation
      // propagates (the bug that produced 355 ghost Diario issues).
      const allStatuses = await client.findAll(tracker.class.IssueStatus, {})
      // NB: correct category id is "task:statusCategory:Won" — earlier we had
      // "task:category:Won" (typo) so wonStatus was always undefined and the
      // deactivation block was silently skipped.
      const wonStatus = allStatuses.find((s: any) => s.category === 'task:statusCategory:Won')
      if (wonStatus != null) {
        await client.update(issue, { status: wonStatus._id, pdcaCycleActive: false } as any)
        ctx.info('PDCA cycle: original deactivated and marked as done', { issueId, wonStatus: wonStatus._id })
      } else {
        // Fallback: at least deactivate so the cycle doesn't keep firing
        await client.update(issue, { pdcaCycleActive: false } as any)
        ctx.warn('PDCA cycle: no Won category status found — deactivated without status change', { issueId })
      }

      // Bump project sequence to get a unique number + identifier for the new issue.
      // Without this the duplicated issue has no identifier and shows up as a
      // "ghost task" in the UI.
      const project = await client.findOne(tracker.class.Project, { _id: issue.space })
      if (project == null) {
        throw new Error(`PDCA duplicate: project not found for space ${String(issue.space)}`)
      }
      const inc = await client.update(project, { $inc: { sequence: 1 } } as any, true)
      const number = ((inc as any)?.object?.sequence) ?? ((project.sequence ?? 0) + 1)
      const newIdentifier = `${project.identifier}-${number}`

      const newIssueData: Record<string, any> = {
        title: issue.title,
        number,
        identifier: newIdentifier,
        rank: '0|hzzzzz:',
        status: resetStatus,
        kind: issue.kind,
        assignee: issue.assignee != null ? [...issue.assignee] : null,
        priority: issue.priority,
        component: issue.component,
        milestone: issue.milestone,
        estimation: issue.estimation,
        // Canonical collection fields — a missing `parents` makes the time-report
        // trigger throw and drop the reportedTime increment on the new issue.
        parents: [],
        childInfo: [],
        comments: 0,
        subIssues: 0,
        reports: 0,
        relations: [],
        reportedTime: 0,
        remainingTime: 0,
        startDate: Date.now(),
        dueDate: dueDate ?? null,
        completedDate: null,
        pdcaCycleActive: true,
        pdcaCycleFrequency: frequency,
        pdcaCycleResetStatus: resetStatus,
        pdcaCycleDueDays: dueDays,
        pdcaCycleCustomWeekdays: customWeekdays,
        pdcaCycleDuplicate: true,
        pdcaCycleResetSubIssues: resetSubIssues,
        pdcaNextCycleDate: nextDate,
        clientName: (issue as any).clientName,
        // F12: leva o vínculo com a Core junto, senão a tarefa recriada nasce
        // "pendente" (com nome, sem id) a cada ciclo.
        clientCoreId: (issue as any).clientCoreId,
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
      ctx.info('PDCA cycle: new issue created as duplicate', { issueId, newIssueId: newId, identifier: newIdentifier, number })

      // When enabled, recreate the original's DIRECT sub-issues under the new
      // duplicated issue, each reset to the parent's reset status with fresh
      // spent time / dates. The originals remain attached to the now-Won issue
      // as historical record.
      if (resetSubIssues) {
        try {
          const children = await client.findAll(tracker.class.Issue, { attachedTo: issueId } as any)
          for (const child of children) {
            const childInc = await client.update(project, { $inc: { sequence: 1 } } as any, true)
            const childNumber = ((childInc as any)?.object?.sequence) ?? ((project.sequence ?? 0) + 1)
            const childIdentifier = `${project.identifier}-${childNumber}`
            await client.addCollection(
              tracker.class.Issue,
              issue.space,
              newId,
              tracker.class.Issue,
              'subIssues',
              {
                title: child.title,
                description: null,
                number: childNumber,
                identifier: childIdentifier,
                rank: child.rank ?? '0|hzzzzz:',
                status: resetStatus,
                priority: child.priority,
                assignee: child.assignee != null ? [...child.assignee] : null,
                component: child.component,
                milestone: child.milestone,
                estimation: child.estimation,
                kind: child.kind,
                // Re-link the recreated sub-issue to the new duplicated parent so it
                // shows in its breadcrumb and contributes to its estimation rollup.
                parents: [
                  {
                    parentId: newId as Ref<Issue>,
                    parentTitle: issue.title,
                    space: issue.space,
                    identifier: newIdentifier
                  }
                ],
                comments: 0,
                subIssues: 0,
                reportedTime: 0,
                remainingTime: 0,
                reports: 0,
                childInfo: [],
                relations: [],
                startDate: Date.now(),
                dueDate: null,
                completedDate: null,
                clientName: (child as any).clientName,
                // F12: preserva o vínculo com a Core na sub-issue recriada também.
                clientCoreId: (child as any).clientCoreId,
                clientStage: (child as any).clientStage
              } as any
            )
          }
          ctx.info('PDCA cycle: sub-issues duplicated under new issue', { issueId, newIssueId: newId, count: children.length })
        } catch (subErr: any) {
          ctx.warn('PDCA cycle: failed to duplicate sub-issues', { issueId, err: subErr?.message ?? String(subErr) })
        }
      }

      try {
        await addCycleComment(client, issue, prevStatusName, prevReportedTime, prevDueDate, prevCompletedDate)
      } catch (commentErr: any) {
        ctx.warn('PDCA cycle: failed to add snapshot comment', { issueId, err: commentErr.message })
      }
    } else {
      // Standard mode: reset status, spent time, dates
      // (pdcaNextCycleDate already advanced above as the idempotency watermark)
      const update: Record<string, any> = {
        status: resetStatus,
        reportedTime: 0,
        startDate: Date.now()
      }
      if (dueDate != null) update.dueDate = dueDate
      await client.update(issue, update as any)
      await client.update(issue, { completedDate: null } as any)
      ctx.info('PDCA cycle: status reset', { issueId, resetStatus })

      // When enabled, reset the DIRECT sub-issues in place the same way as the
      // parent: status -> reset status, spent time zeroed, start date refreshed,
      // completion cleared. The sub-issue's own dueDate is left untouched (it is
      // not recalculated from the parent's frequency).
      if (resetSubIssues) {
        try {
          const children = await client.findAll(tracker.class.Issue, { attachedTo: issueId } as any)
          for (const child of children) {
            await client.update(child, {
              status: resetStatus,
              reportedTime: 0,
              startDate: Date.now()
            } as any)
            await client.update(child, { completedDate: null } as any)
          }
          ctx.info('PDCA cycle: sub-issues status reset', { issueId, count: children.length })
        } catch (subErr: any) {
          ctx.warn('PDCA cycle: failed to reset sub-issues', { issueId, err: subErr?.message ?? String(subErr) })
        }
      }

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
      // Carry the watermark so the next firing can dedup against
      // issue.pdcaNextCycleDate (which we just set to nextDate above).
      data: { issueId: scheduleIssueId, workspaceId, expectedNextCycleDate: nextDate }
    }])
  } catch (err: any) {
    ctx.error('PDCA cycle processing error', {
      issueId,
      workspaceId,
      err: err?.message ?? String(err),
      cause: err?.cause?.message ?? err?.cause?.code ?? String(err?.cause ?? '')
    })
    if (isTransientError(err)) {
      await rescheduleForRetry(ctx, event, err)
    }
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

      // De-herd retroativo: conta quantas issues já estão agendadas para o MESMO
      // instante. Clusters grandes (ex.: 1201 mensais em 01/09 00:00, semanais na
      // segunda) saturam o transactor no disparo → espalhamos dentro da janela.
      const clusterCount = new Map<number, number>()
      for (const issue of issues) {
        const d = (issue as any).pdcaNextCycleDate as number | undefined
        if (d != null) clusterCount.set(d, (clusterCount.get(d) ?? 0) + 1)
      }
      let deHerded = 0

      for (const issue of issues) {
        const frequency = (issue as any).pdcaCycleFrequency as PdcaFrequency | undefined
        const resetStatus = (issue as any).pdcaCycleResetStatus
        const customWeekdays = (issue as any).pdcaCycleCustomWeekdays as number[] | undefined
        if (frequency == null || resetStatus == null) continue
        if (frequency === 'custom' && (customWeekdays == null || customWeekdays.length === 0)) continue

        const existingDate = (issue as any).pdcaNextCycleDate as number | undefined
        let targetDate = existingDate ?? (calculateNextCycleDate(frequency, Date.now(), customWeekdays) + scheduleJitter(String(issue._id)))
        let rewrite = existingDate == null

        // Instante lotado → espalha por offset estável da issue. Idempotente: depois
        // de espalhar, cada instante fica com 1 issue, então num próximo boot não re-mexe.
        if (existingDate != null && (clusterCount.get(existingDate) ?? 0) >= BOOTSTRAP_DEHERD_THRESHOLD) {
          const spread = existingDate + scheduleJitter(String(issue._id))
          if (spread !== existingDate) {
            targetDate = spread
            rewrite = true
            deHerded++
          }
        }

        if (rewrite) {
          await client.update(issue, { pdcaNextCycleDate: targetDate } as any)
        }

        await db.upsertEvent({
          id: `pdca_${issue._id}`,
          workspace: workspaceId,
          target_date: targetDate,
          topic: QueueTopic.PdcaCycle,
          data: { issueId: issue._id, workspaceId, expectedNextCycleDate: targetDate }
        })
      }
      if (deHerded > 0) {
        ctx.info('PDCA bootstrap: de-herded clustered schedules', { workspace: workspaceId, deHerded })
      }
      ctx.info('PDCA bootstrap: scheduled', { workspace: workspaceId, count: issues.length })
    } catch (err: any) {
      ctx.warn('PDCA bootstrap: error for workspace', {
        workspace: workspaceId,
        err: err?.message ?? String(err),
        cause: err?.cause?.message ?? err?.cause?.code ?? String(err?.cause ?? ''),
        stack: err?.stack
      })
    } finally {
      await client?.close()
    }
  }
}
