//
// Copyright © 2026 Hardcore Engineering Inc.
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

// Diagnóstico das chamadas do calendar ao transactor.
//
// Why: em 25/11/2026 uma findAll trivial do calendar (ExternalCalendar por _id)
// ficou presa 4h28 no transactor e a fila do workspace parou atrás dela. Do lado
// do transactor só se vê "request hang found"; não dá para saber qual sync, de
// qual usuário, nem o que o calendar fez antes. Aqui cada findAll/tx do client
// compartilhado é cronometrada e etiquetada com o contexto do sync que a chamou:
//  - "Slow transactor op": operação que terminou acima de SLOW_OP_MS;
//  - "Transactor ops in flight": a cada minuto, as operações ainda pendentes há
//    mais de STUCK_OP_MS, as mais antigas primeiro.
// Procurar no log: docker logs dev-calendar-1 | grep -E "Slow transactor op|ops in flight"

import { type Client, type MeasureContext, type Tx } from '@hcengineering/core'
import { AsyncLocalStorage } from 'async_hooks'

const SLOW_OP_MS = 5_000
const STUCK_OP_MS = 30_000
const WATCHDOG_INTERVAL_MS = 60_000
const MAX_DETAIL = 300
const MAX_REPORTED = 10

type OpContext = Record<string, string | number | undefined>

interface InFlightOp {
  op: string
  _class: string
  detail: string
  workspace: string
  context: OpContext
  startedAt: number
}

const opContext = new AsyncLocalStorage<OpContext>()
const inFlight = new Map<number, InFlightOp>()
let nextOpId = 0
let logCtx: MeasureContext | undefined
let watchdog: NodeJS.Timeout | undefined

// Etiqueta as chamadas feitas dentro de fn (ex.: { phase: 'incoming', email }).
// Contextos aninhados se somam; o mais interno vence em chave repetida.
export async function withOpContext<T> (context: OpContext, fn: () => Promise<T>): Promise<T> {
  const parent = opContext.getStore() ?? {}
  return await opContext.run({ ...parent, ...context }, fn)
}

function truncate (value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? ''
  } catch {
    text = String(value)
  }
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text
}

function describeTx (tx: Tx): { _class: string, detail: string } {
  const t: any = tx
  return {
    _class: String(t.objectClass ?? t._class),
    detail: truncate({
      tx: t._class,
      objectId: t.objectId,
      operations: t.operations !== undefined ? Object.keys(t.operations) : undefined
    })
  }
}

function log (level: 'warn' | 'error', message: string, data: Record<string, any>): void {
  if (logCtx !== undefined) {
    logCtx[level](message, data)
  } else {
    console[level](JSON.stringify({ level, message, ...data }))
  }
}

async function track<T> (
  workspace: string,
  op: string,
  _class: string,
  detail: string,
  fn: () => Promise<T>
): Promise<T> {
  const id = nextOpId++
  const startedAt = Date.now()
  const context = opContext.getStore() ?? {}
  inFlight.set(id, { op, _class, detail, workspace, context, startedAt })
  let failed: string | undefined
  try {
    return await fn()
  } catch (err: any) {
    failed = String(err?.message ?? err)
    throw err
  } finally {
    inFlight.delete(id)
    const durationMs = Date.now() - startedAt
    if (durationMs >= SLOW_OP_MS) {
      log('warn', 'Slow transactor op', {
        op,
        _class,
        detail,
        workspace,
        durationMs,
        failed,
        inFlight: inFlight.size,
        ...context
      })
    }
  }
}

// Envolve findAll e tx do client (findOne passa por findAll). Chamado uma vez por
// client criado em client.ts.
export function instrumentClient (client: Client, workspace: string): Client {
  const c: any = client
  if (c.__opMonitor === true) return client
  c.__opMonitor = true
  const findAll: (...args: any[]) => Promise<any> = c.findAll.bind(client)
  c.findAll = async (_class: any, query: any, options?: any) =>
    await track(workspace, 'findAll', String(_class), truncate({ query, options }), async () => await findAll(_class, query, options))
  const tx: (t: Tx) => Promise<any> = c.tx.bind(client)
  c.tx = async (t: Tx) => {
    const { _class, detail } = describeTx(t)
    return await track(workspace, 'tx', _class, detail, async () => await tx(t))
  }
  return client
}

export function startOpWatchdog (ctx: MeasureContext): void {
  logCtx = ctx
  if (watchdog !== undefined) return
  watchdog = setInterval(() => {
    const now = Date.now()
    const stuck = [...inFlight.values()].filter((o) => now - o.startedAt >= STUCK_OP_MS)
    if (stuck.length === 0) return
    stuck.sort((a, b) => a.startedAt - b.startedAt)
    const byKind: Record<string, number> = {}
    for (const o of stuck) {
      const key = `${o.op} ${o._class}`
      byKind[key] = (byKind[key] ?? 0) + 1
    }
    log('warn', 'Transactor ops in flight', {
      stuck: stuck.length,
      total: inFlight.size,
      byKind,
      oldest: stuck.slice(0, MAX_REPORTED).map((o) => ({
        ageSec: Math.round((now - o.startedAt) / 1000),
        startedAt: new Date(o.startedAt).toISOString(),
        op: o.op,
        _class: o._class,
        detail: o.detail,
        workspace: o.workspace,
        ...o.context
      }))
    })
  }, WATCHDOG_INTERVAL_MS)
  watchdog.unref()
}
