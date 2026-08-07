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

//
// F12 — refresh periódico do "Nome do cliente" a partir da 3F Core.
//
// O `clientName` gravado na issue é um SNAPSHOT denormalizado (existe pra a
// exibição funcionar com a Core offline). Se o `common_name` do cliente mudar
// no cadastro da Core, as issues já vinculadas continuam com o nome antigo — o
// vínculo (`clientCoreId`) segue certo, só o rótulo fica velho. Este job varre,
// N vezes por dia, as issues COM `clientCoreId` e atualiza o `clientName` onde
// ele divergiu do `common_name ?? name` atual da Core.
//
// Agendador in-process (setTimeout): calcula o próximo horário configurado
// (ex.: 12:00 e 20:00 America/Sao_Paulo), roda e reagenda. Não usa a máquina de
// TimeMachine/Kafka do digest — é um scan idempotente e stateless, e um eventual
// run perdido (worker fora no horário) é recuperado no próximo slot.
//
// A lista de clientes vem do proxy `/api/v1/clients` do account (a API Key da
// Core fica lá; o worker só assina um token de sistema) — mesma leitura enxuta,
// sem PII, usada pelo front.
//

import { getClient as getAccountClient } from '@hcengineering/account-client'
import { createRestTxOperations } from '@hcengineering/api-client'
import {
  type MeasureMetricsContext,
  systemAccountUuid,
  type TxOperations,
  type WorkspaceUuid
} from '@hcengineering/core'
import { generateToken } from '@hcengineering/server-token'
import tracker, { type Issue } from '@hcengineering/tracker'
import type { TimeMachineDB } from './db'
import config from './config'

const SERVICE_NAME = 'client-refresh-worker'
// Pausa entre gravações pra não martelar o transactor num run com muitas divergências.
const WRITE_THROTTLE_MS = 80

// ---------- Timezone helpers ----------
// (cópias das mesmas funções puras do dailyDigest.ts — mantidas locais de
// propósito pra este módulo ser 100% aditivo e não tocar no digest.)

// Resolve um horário de parede (Y/M/D h:m) numa timezone IANA para epoch UTC (ms).
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
}

function dateInTz (instant: Date, tz: string): TzDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant)
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

// ---------- Schedule ----------

interface Hm {
  h: number
  m: number
}

export function parseTimes (spec: string): Hm[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      const [hh, mm] = s.split(':')
      return { h: Number(hh), m: Number(mm ?? '0') }
    })
    .filter((t) => Number.isInteger(t.h) && t.h >= 0 && t.h < 24 && Number.isInteger(t.m) && t.m >= 0 && t.m < 60)
}

// Próximo instante (UTC ms) dentre os horários configurados que seja > fromMs.
// Olha hoje e amanhã na timezone dada (Date.UTC normaliza o overflow de dia).
export function computeNextRunMs (fromMs: number, times: Hm[], tz: string): number {
  const now = dateInTz(new Date(fromMs), tz)
  let best = Number.POSITIVE_INFINITY
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const t of times) {
      const candidate = tzWallclockToUtcMs(now.year, now.month, now.day + dayOffset, t.h, t.m, tz)
      if (candidate > fromMs && candidate < best) best = candidate
    }
  }
  return best
}

// ---------- Core clients (via proxy do account) ----------

// id da Core → nome canônico (common_name ?? name). Só clientes ativos (o proxy
// já filtra is_active). Um único fetch por run — a lista é global. Recebe um
// workspace só pra assinar o token (o proxy valida a assinatura; a lista não é
// escopada por workspace).
async function fetchCoreClientsById (ctx: MeasureMetricsContext, tokenWorkspace: WorkspaceUuid): Promise<Map<number, string>> {
  const token = generateToken(systemAccountUuid, tokenWorkspace, { service: SERVICE_NAME }, config.Secret)
  const url = `${config.AccountsUrl.replace(/\/$/, '')}/api/v1/clients`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Error(`clients proxy → HTTP ${res.status} ${res.statusText}`)
  }
  const body: any = await res.json()
  const data: any[] = Array.isArray(body?.data) ? body.data : []
  const byId = new Map<number, string>()
  for (const c of data) {
    if (typeof c?.id !== 'number') continue
    const common = typeof c.common_name === 'string' ? c.common_name.trim() : ''
    const canonical = common !== '' ? common : typeof c.name === 'string' ? c.name.trim() : ''
    if (canonical !== '') byId.set(c.id, canonical)
  }
  return byId
}

// ---------- Workspace connection (mesmo padrão do digest/PDCA) ----------

async function connectWorkspace (workspaceUuid: WorkspaceUuid): Promise<TxOperations> {
  // Assina com config.Secret explicitamente — sem isso generateToken cai no
  // default 'secret' e o account rejeita (Unauthorized). Ver pdca.ts.
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

// ---------- Refresh ----------

async function refreshWorkspace (
  ctx: MeasureMetricsContext,
  workspaceUuid: WorkspaceUuid,
  byId: Map<number, string>
): Promise<{ scanned: number, updated: number }> {
  const client = await connectWorkspace(workspaceUuid)
  let scanned = 0
  let updated = 0
  try {
    const issues = await client.findAll(tracker.class.Issue, {})
    for (const issue of issues) {
      const coreId = (issue as any).clientCoreId
      if (typeof coreId !== 'number') continue
      scanned++
      const canonical = byId.get(coreId)
      // Cliente não veio na lista (inativo/removido na Core) → mantém o snapshot.
      if (canonical == null) continue
      const current = ((issue as Issue).clientName ?? '').trim()
      if (canonical !== current) {
        await client.updateDoc(tracker.class.Issue, (issue as Issue).space, issue._id, { clientName: canonical } as any)
        updated++
        await new Promise((r) => setTimeout(r, WRITE_THROTTLE_MS))
      }
    }
    return { scanned, updated }
  } finally {
    try {
      await client.close()
    } catch {}
  }
}

// Roda o refresh para todos os workspaces ativos. Exportada pra permitir um
// disparo manual/teste, além do agendador.
export async function refreshAllWorkspaces (ctx: MeasureMetricsContext, db: TimeMachineDB): Promise<void> {
  let workspaceIds: WorkspaceUuid[]
  try {
    workspaceIds = await db.getActiveWorkspaces()
  } catch (err: any) {
    ctx.warn('client-refresh: failed to list workspaces', { err: err?.message ?? String(err) })
    return
  }
  if (workspaceIds.length === 0) return

  let byId: Map<number, string>
  try {
    byId = await fetchCoreClientsById(ctx, workspaceIds[0])
  } catch (err: any) {
    // Core/account fora → não dá pra saber o nome atual; pula o run (o snapshot
    // atual continua válido). Próximo slot tenta de novo.
    ctx.error('client-refresh: failed to fetch Core clients, skipping run', { err: err?.message ?? String(err) })
    return
  }
  if (byId.size === 0) {
    ctx.warn('client-refresh: Core returned 0 clients, skipping run')
    return
  }

  ctx.info('client-refresh: starting', { workspaces: workspaceIds.length, coreClients: byId.size })
  let totalScanned = 0
  let totalUpdated = 0
  for (const ws of workspaceIds) {
    try {
      const { scanned, updated } = await refreshWorkspace(ctx, ws, byId)
      totalScanned += scanned
      totalUpdated += updated
      if (updated > 0) {
        ctx.info('client-refresh: workspace updated', { workspace: ws, scanned, updated })
      }
    } catch (err: any) {
      ctx.error('client-refresh: workspace error', { workspace: ws, err: err?.message ?? String(err) })
    }
  }
  ctx.info('client-refresh: complete', { totalScanned, totalUpdated })
}

// ---------- Scheduler (in-process) ----------

export function startClientRefreshSchedule (ctx: MeasureMetricsContext, db: TimeMachineDB): void {
  if (!config.ClientRefreshEnabled) {
    ctx.info('client-refresh: disabled (CLIENT_REFRESH_ENABLED=false)')
    return
  }
  const times = parseTimes(config.ClientRefreshTimes)
  if (times.length === 0) {
    ctx.warn('client-refresh: no valid times, scheduler disabled', { spec: config.ClientRefreshTimes })
    return
  }
  const tz = config.ClientRefreshTimezone

  const arm = (): void => {
    const next = computeNextRunMs(Date.now(), times, tz)
    const delay = Math.max(1000, next - Date.now())
    ctx.info('client-refresh: next run scheduled', { next: new Date(next).toISOString(), tz })
    setTimeout(() => {
      void (async () => {
        try {
          await refreshAllWorkspaces(ctx, db)
        } catch (err: any) {
          ctx.error('client-refresh: run failed', { err: err?.message ?? String(err) })
        } finally {
          arm()
        }
      })()
    }, delay)
  }

  arm()
}
