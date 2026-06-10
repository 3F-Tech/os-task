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
import contact, { type Person, type SocialIdentity } from '@hcengineering/contact'
import {
  MeasureMetricsContext,
  SocialIdType,
  systemAccountUuid,
  TxOperations,
  type Ref,
  type WorkspaceUuid
} from '@hcengineering/core'
import { getPlatformQueue } from '@hcengineering/kafka'
import { QueueTopic } from '@hcengineering/server-core'
import { generateToken } from '@hcengineering/server-token'
import task from '@hcengineering/task'
import time, { type ToDo } from '@hcengineering/time'
import tracker, { type Issue, type IssueStatus } from '@hcengineering/tracker'
import type { TimeMachineDB } from './db'
import config from './config'

const SERVICE_NAME = 'daily-digest-worker'
const SCHEDULE_ID = 'daily_digest'

export interface DailyDigestEvent {
  workspaceId: WorkspaceUuid
  retryCount?: number
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
const MAX_ITEMS_PER_SECTION = 10

function isTransientError (err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase()
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network')
  )
}

// ---------- Timezone helpers ----------

// Resolve a wall-clock time (Y/M/D h:m) in a given IANA timezone to a UTC epoch (ms).
// Uses Intl.DateTimeFormat so it works for any timezone, including ones with DST.
function tzWallclockToUtcMs (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(guess))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  const tzDisplayMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), 0)
  const offsetMs = tzDisplayMs - guess
  return guess - offsetMs
}

interface TzDate {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function dateInTz (instant: Date, tz: string): TzDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant)
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

function isWeekendDate (year: number, month: number, day: number): boolean {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return dow === 0 || dow === 6 // Sun or Sat
}

export function calculateNextDigestDate (fromMs: number): number {
  const tz = config.DigestTimezone
  const hour = config.DigestHour
  const minute = config.DigestMinute
  const now = dateInTz(new Date(fromMs), tz)
  let day = now.day
  let candidate = tzWallclockToUtcMs(now.year, now.month, day, hour, minute, tz)
  if (candidate <= fromMs) {
    day += 1
    candidate = tzWallclockToUtcMs(now.year, now.month, day, hour, minute, tz)
  }
  if (config.DigestSkipWeekend) {
    // Bump forward until the candidate lands on a weekday in the tz.
    for (let safety = 0; safety < 7; safety++) {
      const local = dateInTz(new Date(candidate), tz)
      if (!isWeekendDate(local.year, local.month, local.day)) break
      day += 1
      candidate = tzWallclockToUtcMs(now.year, now.month, day, hour, minute, tz)
    }
  }
  return candidate
}

export function startOfTodayMs (nowMs: number): number {
  const tz = config.DigestTimezone
  const now = dateInTz(new Date(nowMs), tz)
  return tzWallclockToUtcMs(now.year, now.month, now.day, 0, 0, tz)
}

export function endOfTodayMs (nowMs: number): number {
  return startOfTodayMs(nowMs) + 24 * 60 * 60 * 1000 - 1
}

// ---------- Workspace client ----------

interface WorkspaceConnection {
  client: TxOperations
  workspaceUrl: string
}

async function createWorkspaceConnection (workspaceUuid: WorkspaceUuid): Promise<WorkspaceConnection> {
  const token = generateToken(systemAccountUuid, workspaceUuid, { service: SERVICE_NAME })
  const accountClient = getAccountClient(config.AccountsUrl, token)
  const wsInfo = await accountClient.getLoginInfoByToken()
  if (wsInfo == null || !('endpoint' in wsInfo)) {
    throw new Error(`Could not get workspace info for ${workspaceUuid}`)
  }
  const endpoint = config.TransactorUrl ?? wsInfo.endpoint
  const transactorUrl = endpoint.replace('ws://', 'http://').replace('wss://', 'https://')
  const client = await createRestTxOperations(transactorUrl, wsInfo.workspace, wsInfo.token, true)
  return { client, workspaceUrl: (wsInfo as any).workspaceUrl ?? wsInfo.workspace }
}

// ---------- Email lookup ----------

async function resolveAssigneeEmail (client: TxOperations, personRef: Ref<Person>): Promise<string | undefined> {
  const socialIds = await client.findAll(contact.class.SocialIdentity, {
    attachedTo: personRef,
    type: SocialIdType.EMAIL
  })
  const candidates = socialIds.filter((s: SocialIdentity) => s.isDeleted !== true && s.value !== '')
  if (candidates.length === 0) return undefined
  // Prefer verified ones if available
  const verified = candidates.find((s: SocialIdentity) => (s.verifiedOn ?? 0) > 0)
  return (verified ?? candidates[0]).value
}

// ---------- HTML / text rendering ----------

function escapeHtml (s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDateBr (ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: config.DigestTimezone }).format(
    new Date(ms)
  )
}

function issueUrl (workspaceUrl: string, identifier: string): string {
  const base = config.FrontUrl.replace(/\/$/, '')
  return `${base}/workbench/${workspaceUrl}/tracker/${encodeURIComponent(identifier)}`
}

function renderIssueListHtml (items: Issue[], total: number, workspaceUrl: string, showDate: boolean): string {
  if (total === 0) return '<p style="color:#666;font-size:14px;">Nenhuma tarefa.</p>'
  const lis = items
    .map((it) => {
      const due = showDate && it.dueDate != null ? ` <span style="color:#999;">(${formatDateBr(it.dueDate)})</span>` : ''
      const ident = it.identifier ?? ''
      return `<li style="margin:6px 0;"><a href="${issueUrl(workspaceUrl, ident)}" style="color:#2563eb;text-decoration:none;font-weight:600;">${escapeHtml(ident)}</a> — ${escapeHtml(it.title ?? '')}${due}</li>`
    })
    .join('')
  const extra = total > items.length
    ? `<li style="margin:6px 0;color:#999;list-style:none;">…e mais ${total - items.length}</li>`
    : ''
  return `<ul style="padding-left:18px;margin:8px 0;">${lis}${extra}</ul>`
}

function renderIssueListText (items: Issue[], total: number, workspaceUrl: string, showDate: boolean): string {
  if (total === 0) return '  (nenhuma)\n'
  const lines = items
    .map((it) => {
      const due = showDate && it.dueDate != null ? ` (${formatDateBr(it.dueDate)})` : ''
      return `  - [${it.identifier ?? ''}] ${it.title ?? ''}${due}\n    ${issueUrl(workspaceUrl, it.identifier ?? '')}`
    })
    .join('\n')
  const extra = total > items.length ? `\n  …e mais ${total - items.length}` : ''
  return lines + extra
}

interface DigestBuckets {
  today: Issue[]
  overdue: Issue[]
  upcoming: Issue[]
  unplanned: Issue[]
  totalToday: number
  totalOverdue: number
  totalUpcoming: number
  totalUnplanned: number
}

function sectionHtml (
  emoji: string,
  title: string,
  total: number,
  items: Issue[],
  workspaceUrl: string,
  showDate: boolean,
  color: string
): string {
  if (total === 0) return ''
  return `<h3 style="margin:24px 0 4px 0;color:${color};">${emoji} ${title} (${total})</h3>${renderIssueListHtml(items, total, workspaceUrl, showDate)}`
}

function sectionText (
  emoji: string,
  title: string,
  total: number,
  items: Issue[],
  workspaceUrl: string,
  showDate: boolean
): string {
  if (total === 0) return ''
  return `\n${emoji} ${title} (${total})\n${renderIssueListText(items, total, workspaceUrl, showDate)}\n`
}

function buildDigest (b: DigestBuckets, workspaceUrl: string): { subject: string, html: string, text: string } {
  const parts: string[] = []
  if (b.totalToday > 0) parts.push(`${b.totalToday} para hoje`)
  if (b.totalOverdue > 0) parts.push(`${b.totalOverdue} em atraso`)
  if (b.totalUpcoming > 0) parts.push(`${b.totalUpcoming} próximas`)
  if (b.totalUnplanned > 0) parts.push(`${b.totalUnplanned} sem agenda`)
  const subject = parts.length > 0 ? `Suas tarefas — ${parts.join(', ')}` : 'Suas tarefas — nada para hoje'

  const todayHtml = sectionHtml('📅', 'Para hoje', b.totalToday, b.today, workspaceUrl, false, '#111')
  const overdueHtml = sectionHtml('⏰', 'Em atraso', b.totalOverdue, b.overdue, workspaceUrl, true, '#b91c1c')
  const upcomingHtml = sectionHtml('📆', 'Próximas do prazo', b.totalUpcoming, b.upcoming, workspaceUrl, true, '#0369a1')
  const unplannedHtml = sectionHtml('📋', 'Sem agenda no calendário', b.totalUnplanned, b.unplanned, workspaceUrl, true, '#6b7280')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;line-height:1.5;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <h2 style="margin:0 0 8px 0;">Bom dia! 👋</h2>
    <p style="margin:0 0 24px 0;color:#444;">Aqui está o resumo das suas tarefas no 3F Tasks.</p>
    ${todayHtml}
    ${overdueHtml}
    ${upcomingHtml}
    ${unplannedHtml}
    <p style="margin-top:32px;color:#999;font-size:12px;">Email automático enviado pelo 3F Tasks. Para deixar de recebê-lo, fale com o admin do workspace.</p>
  </div>
</body></html>`

  const todayText = sectionText('📅', 'Para hoje', b.totalToday, b.today, workspaceUrl, false)
  const overdueText = sectionText('⏰', 'Em atraso', b.totalOverdue, b.overdue, workspaceUrl, true)
  const upcomingText = sectionText('📆', 'Próximas do prazo', b.totalUpcoming, b.upcoming, workspaceUrl, true)
  const unplannedText = sectionText('📋', 'Sem agenda no calendário', b.totalUnplanned, b.unplanned, workspaceUrl, true)
  const text = `Bom dia!\n\nResumo das suas tarefas no 3F Tasks.\n${todayText}${overdueText}${upcomingText}${unplannedText}\n— 3F Tasks`
  return { subject, html, text }
}

// ---------- Mail service ----------

async function sendDigestEmail (
  ctx: MeasureMetricsContext,
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<void> {
  const body: Record<string, any> = { to, subject, text, html }
  if (config.MailSource !== undefined && config.MailSource !== '') body.from = config.MailSource
  if (config.MailApiKey !== undefined && config.MailApiKey !== '') body.apiKey = config.MailApiKey
  const url = `${config.MailUrl.replace(/\/$/, '')}/send`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`mail service returned ${res.status}: ${errText}`)
  }
}

// ---------- Core processing ----------

async function rescheduleNextDigest (
  ctx: MeasureMetricsContext,
  workspaceId: WorkspaceUuid
): Promise<void> {
  const nextDate = calculateNextDigestDate(Date.now())
  try {
    const queue = getPlatformQueue(SERVICE_NAME, config.QueueRegion)
    const producer = queue.getProducer<TimeMachineMessage>(ctx, QueueTopic.TimeMachine)
    await producer.send(ctx, workspaceId, [
      {
        type: 'schedule',
        id: SCHEDULE_ID,
        targetDate: nextDate,
        topic: QueueTopic.DailyDigest,
        data: { workspaceId }
      }
    ])
    ctx.info('daily-digest: next run scheduled', {
      workspaceId,
      nextDate: new Date(nextDate).toISOString()
    })
  } catch (err: any) {
    ctx.error('daily-digest: failed to schedule next run', { workspaceId, err: err?.message ?? String(err) })
  }
}

async function rescheduleForRetry (
  ctx: MeasureMetricsContext,
  event: DailyDigestEvent,
  err: any
): Promise<void> {
  const retryCount = event.retryCount ?? 0
  if (retryCount >= MAX_RETRIES) {
    ctx.error('daily-digest: giving up after retries', {
      workspaceId: event.workspaceId,
      retryCount,
      err: err?.message ?? String(err)
    })
    return
  }
  const delayMs = RETRY_BACKOFF_MS[retryCount] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
  const targetDate = Date.now() + delayMs
  ctx.warn('daily-digest: rescheduling after transient error', {
    workspaceId: event.workspaceId,
    retryCount: retryCount + 1,
    delayMs,
    err: err?.message ?? String(err)
  })
  try {
    const queue = getPlatformQueue(SERVICE_NAME, config.QueueRegion)
    const producer = queue.getProducer<TimeMachineMessage>(ctx, QueueTopic.TimeMachine)
    await producer.send(ctx, event.workspaceId, [
      {
        type: 'schedule',
        id: `${SCHEDULE_ID}_retry_${retryCount + 1}`,
        targetDate,
        topic: QueueTopic.DailyDigest,
        data: { workspaceId: event.workspaceId, retryCount: retryCount + 1 }
      }
    ])
  } catch (rescheduleErr: any) {
    ctx.error('daily-digest: failed to reschedule retry', {
      workspaceId: event.workspaceId,
      err: rescheduleErr?.message ?? String(rescheduleErr)
    })
  }
}

export async function processDailyDigestEvent (
  ctx: MeasureMetricsContext,
  event: DailyDigestEvent
): Promise<void> {
  const { workspaceId } = event
  let connection: WorkspaceConnection | undefined
  let isRetry = (event.retryCount ?? 0) > 0

  try {
    connection = await createWorkspaceConnection(workspaceId)
    const { client, workspaceUrl } = connection

    const nowMs = Date.now()
    const startMs = startOfTodayMs(nowMs)
    const endMs = endOfTodayMs(nowMs)
    const upcomingEndMs = startMs + (1 + config.DigestUpcomingDays) * 24 * 60 * 60 * 1000

    // Fetch all issues first (no IssueStatus pre-query — some workspaces have
    // malformed status docs that crash findAll(IssueStatus, {})).
    ctx.info('daily-digest: loading issues', { workspaceId })
    const allIssues = await client.findAll(tracker.class.Issue, {})
    const assignedIssues = allIssues.filter(
      (i) => i != null && i.assignee != null && (i.assignee as any) !== ''
    )

    if (assignedIssues.length === 0) {
      ctx.info('daily-digest: no assigned issues in workspace', { workspaceId })
      return
    }

    // IssueStatus is a model-domain doc (DOMAIN_MODEL): the full model loaded
    // at connection time already contains every status, including the ones
    // whose REST serialization is broken in prod (findAll/findOne crash while
    // parsing them, which made closed issues leak into the digest as open).
    // Classify closed statuses from the local model — no server query at all.
    const referencedStatusIds = Array.from(
      new Set(assignedIssues.map((i) => i.status).filter((s): s is Ref<IssueStatus> => s != null))
    )
    const modelStatuses = client.getModel().findAllSync(tracker.class.IssueStatus, {})
    const knownStatusIds = new Set<Ref<IssueStatus>>(modelStatuses.map((s) => s._id))
    const closedStatusIds = new Set<Ref<IssueStatus>>(
      modelStatuses
        .filter((s) => s.category === task.statusCategory.Won || s.category === task.statusCategory.Lost)
        .map((s) => s._id)
    )
    ctx.info('daily-digest: statuses resolved from local model', {
      workspaceId,
      issueCount: assignedIssues.length,
      referencedCount: referencedStatusIds.length,
      modelStatusCount: modelStatuses.length,
      closedCount: closedStatusIds.size
    })
    const unknownStatusIds = referencedStatusIds.filter((id) => !knownStatusIds.has(id))
    if (unknownStatusIds.length > 0) {
      ctx.warn('daily-digest: issues reference statuses missing from model, treating as open', {
        workspaceId,
        missing: unknownStatusIds.length
      })
    }

    // Keep only open assigned issues
    const issues = assignedIssues.filter((i) => i.status != null && !closedStatusIds.has(i.status))

    if (issues.length === 0) {
      ctx.info('daily-digest: no relevant issues in workspace', { workspaceId })
      return
    }

    // Find which issues have at least one scheduled ToDo (workslots > 0)
    const issueIds = issues.map((i) => i._id).filter((id): id is Ref<Issue> => id != null)
    ctx.info('daily-digest: loading todos', { workspaceId, issueCount: issueIds.length })
    const todos =
      issueIds.length === 0
        ? []
        : await client.findAll(time.class.ToDo, {
            attachedTo: { $in: issueIds },
            attachedToClass: tracker.class.Issue
          })
    const scheduledIssueIds = new Set<Ref<Issue>>()
    for (const t of todos as ToDo[]) {
      if ((t.workslots ?? 0) > 0 && t.doneOn == null) {
        scheduledIssueIds.add(t.attachedTo as Ref<Issue>)
      }
    }

    // Bucket each issue per assignee (priority: today > overdue > upcoming > unplanned)
    const empty = (): { today: Issue[], overdue: Issue[], upcoming: Issue[], unplanned: Issue[] } => ({
      today: [],
      overdue: [],
      upcoming: [],
      unplanned: []
    })
    const byAssignee = new Map<Ref<Person>, ReturnType<typeof empty>>()
    for (const issue of issues) {
      if (issue.assignee == null) continue
      const bucket = byAssignee.get(issue.assignee) ?? empty()
      const due = issue.dueDate ?? null
      if (due != null && due > 0 && due >= startMs && due <= endMs) {
        bucket.today.push(issue)
      } else if (due != null && due > 0 && due < startMs) {
        bucket.overdue.push(issue)
      } else if (due != null && due > 0 && due > endMs && due <= upcomingEndMs) {
        bucket.upcoming.push(issue)
      } else if (!scheduledIssueIds.has(issue._id)) {
        bucket.unplanned.push(issue)
      }
      byAssignee.set(issue.assignee, bucket)
    }

    if (byAssignee.size === 0) {
      ctx.info('daily-digest: no issues with assignee', { workspaceId })
      return
    }

    const sortByDue = (a: Issue, b: Issue): number => (a.dueDate ?? 0) - (b.dueDate ?? 0)
    const sortById = (a: Issue, b: Issue): number => (a.identifier ?? '').localeCompare(b.identifier ?? '')

    let sent = 0
    let skippedNoEmail = 0
    let failed = 0
    for (const [assignee, bucket] of byAssignee.entries()) {
      const hasAny =
        bucket.today.length > 0 || bucket.overdue.length > 0 || bucket.upcoming.length > 0 || bucket.unplanned.length > 0
      if (!hasAny) continue
      try {
        const email = await resolveAssigneeEmail(client, assignee)
        if (email == null) {
          ctx.info('daily-digest: assignee has no email, skipping', { assignee, workspaceId })
          skippedNoEmail++
          continue
        }
        bucket.today.sort(sortById)
        bucket.overdue.sort(sortByDue)
        bucket.upcoming.sort(sortByDue)
        bucket.unplanned.sort(sortById)
        const buckets: DigestBuckets = {
          today: bucket.today.slice(0, MAX_ITEMS_PER_SECTION),
          overdue: bucket.overdue.slice(0, MAX_ITEMS_PER_SECTION),
          upcoming: bucket.upcoming.slice(0, MAX_ITEMS_PER_SECTION),
          unplanned: bucket.unplanned.slice(0, MAX_ITEMS_PER_SECTION),
          totalToday: bucket.today.length,
          totalOverdue: bucket.overdue.length,
          totalUpcoming: bucket.upcoming.length,
          totalUnplanned: bucket.unplanned.length
        }
        const { subject, html, text } = buildDigest(buckets, workspaceUrl)
        await sendDigestEmail(ctx, email, subject, text, html)
        sent++
        ctx.info('daily-digest: sent', {
          workspaceId,
          email,
          today: buckets.totalToday,
          overdue: buckets.totalOverdue,
          upcoming: buckets.totalUpcoming,
          unplanned: buckets.totalUnplanned
        })
      } catch (err: any) {
        failed++
        ctx.error('daily-digest: failed to send digest for assignee', {
          workspaceId,
          assignee,
          err: err?.message ?? String(err)
        })
      }
    }

    ctx.info('daily-digest: workspace complete', { workspaceId, sent, skippedNoEmail, failed })
  } catch (err: any) {
    ctx.error('daily-digest: processing error', {
      workspaceId,
      err: err?.message ?? String(err),
      cause: err?.cause?.message ?? err?.cause?.code ?? String(err?.cause ?? ''),
      stack: err?.stack
    })
    if (isTransientError(err)) {
      await rescheduleForRetry(ctx, event, err)
      return
    }
  } finally {
    if (connection?.client != null) {
      try {
        await connection.client.close()
      } catch {}
    }
    // Always schedule the next daily run (not for retries — those reuse the original schedule).
    if (!isRetry) {
      await rescheduleNextDigest(ctx, workspaceId)
    }
  }
}

export function startDailyDigestConsumer (ctx: MeasureMetricsContext): void {
  const queue = getPlatformQueue(SERVICE_NAME, config.QueueRegion)
  queue.createConsumer<DailyDigestEvent>(
    ctx,
    QueueTopic.DailyDigest,
    'daily-digest-worker-group',
    async (ctx, msg) => {
      await processDailyDigestEvent(ctx as MeasureMetricsContext, msg.value)
    }
  )
}

export async function bootstrapDailyDigestSchedule (
  ctx: MeasureMetricsContext,
  db: TimeMachineDB
): Promise<void> {
  let workspaceIds: WorkspaceUuid[]
  try {
    workspaceIds = await db.getActiveWorkspaces()
  } catch (err: any) {
    ctx.warn('daily-digest bootstrap: failed to list workspaces', { err: err.message })
    return
  }

  const targetDate = calculateNextDigestDate(Date.now())
  for (const workspaceId of workspaceIds) {
    try {
      await db.upsertEvent({
        id: SCHEDULE_ID,
        workspace: workspaceId,
        target_date: targetDate,
        topic: QueueTopic.DailyDigest,
        data: { workspaceId }
      })
      ctx.info('daily-digest bootstrap: scheduled', {
        workspace: workspaceId,
        targetDate: new Date(targetDate).toISOString()
      })
    } catch (err: any) {
      ctx.warn('daily-digest bootstrap: error for workspace', {
        workspace: workspaceId,
        err: err?.message ?? String(err)
      })
    }
  }
}
