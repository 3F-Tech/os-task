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
// F04 — Limpeza do replay de ciclos PDCA órfãos (incidente de 2026-10-16).
//
// O que houve: ciclos que falharam (IssueStatus corrompido → "Cannot read
// properties of null (reading '#<Object>')") desistiram após 3 retries SEM
// reagendar. No reboot da VPS (16/10, 10:44 BRT) o bootstrap do worker
// reexecutou todos de uma vez entre 10:45 e 11:03: 217 duplicações de tarefas
// de meses passados + 401 resets. Ver memory pdca_orphan_replay_on_boot.
//
// O script olha SÓ o que o System gravou na janela do incidente:
//   • CÓPIAS    — issues criadas pelo worker (TxCreateDoc do System com
//                 pdcaCycleDuplicate) e as sub-tarefas recriadas sob elas
//                 → APAGA, sub-tarefas primeiro. Apagar cancela o timer da cópia
//                 (trigger OnPdcaCycleCancel), então não há nova rajada em 01/11.
//   • ORIGINAIS — issues que o worker desativou ({ pdcaCycleActive: false,
//                 status: Won }) → volta o STATUS ao de antes. O PDCA continua
//                 desligado: religar faria a tarefa duplicar de novo.
//   • RESETS    — só RELATÓRIO; reverter depende de decisão das BUs.
//
// O token é POR WORKSPACE e o incidente passou por várias (3F, Bomma, Seed,
// Impulse…): rode uma vez por workspace, cada uma com seu .env (--env).
//
// Travas:
//   • cópia que alguém tocou depois (tx de pessoa, comentário, tempo, anexo,
//     sub-tarefa criada por pessoa) NÃO é apagada — vai para "revisar".
//   • original cujo status alguém mudou depois do incidente fica de fora,
//     salvo --incluir-tocadas (todas) ou --incluir-tocadas-por <socialId,...>.
//   • o status de antes vem do histórico de Tx e é conferido com o "Status
//     anterior" do comentário do worker; se divergir, não mexe.
//   • pdcaNextCycleDate nunca é restaurado: voltar o watermark recria a órfã.
//
// SÓ LEITURA por padrão (dry-run). Use --apply para gravar.
//
// Uso:
//   npx tsx automation/pdca-replay-cleanup.ts                        # dry-run, todos os projetos
//   npx tsx automation/pdca-replay-cleanup.ts --space <projectId>    # dry-run de um projeto
//   npx tsx automation/pdca-replay-cleanup.ts --space <projectId> --apply
//   npx tsx automation/pdca-replay-cleanup.ts --apply [--incluir-tocadas] [--csv plano.csv]
//   npx tsx automation/pdca-replay-cleanup.ts --env automation/.env.bomma   # outra workspace
//   --from / --to <ISO>   janela do incidente (padrão 2026-10-16T13:45:00Z .. 14:05:00Z)
//
// Env (automation/.env ou --env): HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN
//
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

const envFile = arg('--env')
dotenv.config({ path: envFile !== undefined ? path.resolve(envFile) : path.join(__dirname, '.env') })

const SYSTEM = 'core:account:System'
const ISSUE = 'tracker:class:Issue'
const ISSUE_STATUS = 'tracker:class:IssueStatus'
const PROJECT = 'tracker:class:Project'
const CHAT_MESSAGE = 'chunter:class:ChatMessage'
const TX_CREATE = 'core:class:TxCreateDoc'
const TX_UPDATE = 'core:class:TxUpdateDoc'
const CYCLE_MARK = 'Ciclo PDCA reiniciado'

const DEFAULT_FROM = '2026-10-16T13:45:00Z'
const DEFAULT_TO = '2026-10-16T14:05:00Z'
const WRITE_THROTTLE_MS = 80
const IN_BATCH = 200

// POST em vez de GET: as listas de $in passam de centenas de ids e estourariam
// o tamanho de URL do nginx. showArchived: por padrão o servidor esconde tudo que
// está em projeto arquivado (shouldShowArchived), mas o worker cicla essas tarefas.
async function restFind (
  base: string,
  workspace: string,
  token: string,
  _class: string,
  query: Record<string, any> = {},
  options: Record<string, any> = {}
): Promise<any[]> {
  const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/find-all/${workspace}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _class, query, options: { showArchived: true, ...options } })
  })
  if (!res.ok) throw new Error(`find-all ${_class} → HTTP ${res.status} ${res.statusText}`)
  const parsed: any = JSON.parse(await res.text())
  if (parsed?.error != null) throw new Error(`platform error: ${JSON.stringify(parsed.error)}`)
  if (parsed?.dataType === 'TotalArray') return Array.isArray(parsed.value) ? parsed.value : []
  if (Array.isArray(parsed)) return parsed
  return Array.isArray(parsed?.value) ? parsed.value : []
}

function arg (name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const sleep = async (ms: number): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, ms)) }

function norm (s: string | undefined): string {
  return (s ?? '').normalize('NFKC').replace(/﻿/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function fmtBrt (ts: number | null | undefined): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

// O comentário do worker é markup ProseMirror serializado: um parágrafo por linha.
function markupLines (message: unknown): string[] {
  try {
    const doc = JSON.parse(String(message))
    return (doc.content ?? []).map((p: any) => (p.content ?? []).map((t: any) => t.text ?? '').join(''))
  } catch {
    return [String(message)]
  }
}

interface CycleComment { prevStatusName?: string, prevCompleted?: string }

function parseCycleComment (msg: any): CycleComment | undefined {
  const lines = markupLines(msg.message)
  if (!lines.some((l) => l.includes(CYCLE_MARK))) return undefined
  const get = (prefix: string): string | undefined => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim()
  return { prevStatusName: get('Status anterior:'), prevCompleted: get('Data de conclusão:') }
}

const byTime = (a: any, b: any): number => (a.modifiedOn - b.modifiedOn) || String(a._id).localeCompare(String(b._id))

interface CloneNode { doc: any, depth: number }
interface CloneTree { root: any, nodes: CloneNode[], original?: any, reasons: string[] }
interface OriginalPlan {
  doc: any
  preStatus?: string
  clearCompleted: boolean
  touchedBy?: string
  touchedById?: string
  conflict?: string
  done: boolean
}

async function run (): Promise<void> {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN } = process.env
  if (HUB_API_TOKEN === undefined || HUB_API_TOKEN === '') {
    console.error('❌ HUB_API_TOKEN não configurado (automation/.env)')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const incluirTocadas = process.argv.includes('--incluir-tocadas')
  const tocadasPor = new Set((arg('--incluir-tocadas-por') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''))
  const onlySpace = arg('--space')
  const csvPath = arg('--csv')
  const from = Date.parse(arg('--from') ?? DEFAULT_FROM)
  const to = Date.parse(arg('--to') ?? DEFAULT_TO)
  if (Number.isNaN(from) || Number.isNaN(to) || from >= to) {
    console.error('❌ janela inválida: use --from/--to em ISO, ex. 2026-10-16T13:45:00Z')
    process.exit(1)
  }

  let workspaceId = HUB_WORKSPACE_ID
  if (workspaceId === undefined || workspaceId === '') {
    const payload = JSON.parse(Buffer.from(HUB_API_TOKEN.split('.')[1], 'base64').toString())
    workspaceId = payload.workspace as string
  }
  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332'
  const F = async (c: string, q?: Record<string, any>, o?: Record<string, any>): Promise<any[]> =>
    await restFind(url, workspaceId as string, HUB_API_TOKEN, c, q, o)
  const findIn = async (c: string, field: string, ids: string[], extra: Record<string, any> = {}): Promise<any[]> => {
    const out: any[] = []
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      out.push(...(await F(c, { ...extra, [field]: { $in: ids.slice(i, i + IN_BATCH) } })))
    }
    return out
  }

  // ---------- 1. Estado atual: tudo que mudou desde o início da janela ----------
  const [touched, statuses, projects] = await Promise.all([
    F(ISSUE, { modifiedOn: { $gte: from } }),
    F(ISSUE_STATUS),
    F(PROJECT)
  ])
  const issueById = new Map<string, any>(touched.map((i: any) => [i._id, i]))
  const statusById = new Map<string, any>(statuses.map((s: any) => [s._id, s]))
  const projectById = new Map<string, any>(projects.map((p: any) => [p._id, p]))
  const statusName = (id: string | undefined): string => (id != null ? statusById.get(id)?.name ?? id : '—')

  let spaces = [...new Set(touched.map((i: any) => i.space as string))]
  if (onlySpace !== undefined) spaces = spaces.filter((s) => s === onlySpace)

  // ---------- 2. O que o System gravou na janela, por projeto ----------
  const winCreates: any[] = []
  const winUpdates: any[] = []
  for (const sp of spaces) {
    const q = { objectSpace: sp, modifiedBy: SYSTEM, modifiedOn: { $gte: from, $lte: to } }
    const [c, u] = await Promise.all([F(TX_CREATE, q), F(TX_UPDATE, q)])
    // objectSpace/modifiedBy vêm omitidos (igualdade na query) — repõe o valor conhecido.
    for (const t of c) if (t.objectClass === ISSUE) winCreates.push({ ...t, objectSpace: sp, modifiedBy: SYSTEM })
    for (const t of u) if (t.objectClass === ISSUE) winUpdates.push({ ...t, objectSpace: sp, modifiedBy: SYSTEM })
  }
  if ([...winCreates, ...winUpdates].some((t) => t.objectId == null)) {
    throw new Error('find-all de Tx veio sem objectId — não dá pra agrupar com segurança; abortando')
  }

  const createdIds = new Set<string>(winCreates.map((t) => t.objectId))
  const firstWinTx = new Map<string, number>()
  for (const t of winUpdates) {
    const cur = firstWinTx.get(t.objectId)
    if (cur === undefined || t.modifiedOn < cur) firstWinTx.set(t.objectId, t.modifiedOn)
  }

  // Originais: o worker gravou { pdcaCycleActive: false, status: Won } na janela.
  const deactivation = new Map<string, any>()
  for (const t of winUpdates.sort(byTime)) {
    if (t.operations?.pdcaCycleActive === false && !createdIds.has(t.objectId) && !deactivation.has(t.objectId)) {
      deactivation.set(t.objectId, t)
    }
  }
  // Resets (só relatório): assinatura do modo reset — { status, reportedTime: 0, startDate }.
  const resetIds = new Set<string>(
    winUpdates
      .filter((t) => t.operations?.reportedTime === 0 && 'startDate' in (t.operations ?? {}))
      .map((t) => t.objectId as string)
      .filter((id) => !createdIds.has(id) && !deactivation.has(id))
  )

  // ---------- 3. Cópias: árvores de issues criadas pelo System ----------
  const createTxById = new Map<string, any>(winCreates.map((t) => [t.objectId, t]))
  const parentOf = (id: string): string | undefined => {
    const t = createTxById.get(id)
    return issueById.get(id)?.attachedTo ?? t?.attachedTo ?? t?.attributes?.attachedTo
  }
  const rootOf = (id: string): { root: string, depth: number } => {
    let cur = id
    let depth = 0
    for (let p = parentOf(cur); p !== undefined && createdIds.has(p); p = parentOf(cur)) {
      cur = p
      depth++
    }
    return { root: cur, depth }
  }

  const trees = new Map<string, CloneTree>()
  let otherCreates = 0
  let alreadyGone = 0
  for (const id of createdIds) {
    const { root, depth } = rootOf(id)
    if (createTxById.get(root)?.attributes?.pdcaCycleDuplicate !== true) {
      if (id === root) otherCreates++
      continue
    }
    const doc = issueById.get(id)
    if (doc === undefined) {
      alreadyGone++
      continue
    }
    const tree = trees.get(root) ?? { root: issueById.get(root), nodes: [], reasons: [] }
    tree.nodes.push({ doc, depth })
    trees.set(root, tree)
  }
  for (const [rootId, tree] of trees) {
    if (tree.root === undefined) {
      tree.reasons.push('tarefa-raiz já não existe')
      tree.root = { _id: rootId, space: tree.nodes[0]?.doc.space }
    }
  }

  // Trava: alguém mexeu na cópia depois de criada?
  const cloneTree = new Map<string, CloneTree>()
  for (const t of trees.values()) for (const n of t.nodes) cloneTree.set(n.doc._id, t)
  const cloneIds = [...cloneTree.keys()]
  for (const sp of [...new Set(cloneIds.map((id) => issueById.get(id)?.space as string))]) {
    const ids = cloneIds.filter((id) => issueById.get(id)?.space === sp)
    for (const t of await findIn(TX_UPDATE, 'objectId', ids, { objectSpace: sp })) {
      if (t.modifiedBy !== SYSTEM) {
        cloneTree.get(t.objectId)?.reasons.push(`alterada por ${String(t.modifiedBy)} em ${fmtBrt(t.modifiedOn)}`)
      }
    }
  }
  for (const ch of await findIn(ISSUE, 'attachedTo', cloneIds)) {
    if (createdIds.has(ch._id)) continue
    // Sub-tarefa criada por pessoa: se apagássemos o pai ela ficaria órfã.
    const parent = ch.attachedTo ?? ch.parents?.[ch.parents.length - 1]?.parentId
    const tree = parent !== undefined ? cloneTree.get(parent) : undefined
    if (tree === undefined) throw new Error(`sub-tarefa ${String(ch.identifier)} sem pai identificável — abortando`)
    tree.reasons.push(`sub-tarefa criada por pessoa: ${String(ch.identifier)}`)
  }
  for (const t of trees.values()) {
    for (const n of t.nodes) {
      const d = n.doc
      if ((d.comments ?? 0) > 0) t.reasons.push(`${String(d.identifier)} tem comentário`)
      if ((d.attachments ?? 0) > 0) t.reasons.push(`${String(d.identifier)} tem anexo`)
      if ((d.reportedTime ?? 0) > 0 || (d.reports ?? 0) > 0) t.reasons.push(`${String(d.identifier)} tem tempo lançado`)
    }
  }

  // ---------- 4. Originais: status de antes (Tx) conferido com o comentário ----------
  const originalIds = [...deactivation.keys()]
  const history = new Map<string, any[]>()
  for (const sp of [...new Set(originalIds.map((id) => deactivation.get(id).objectSpace as string))]) {
    const ids = originalIds.filter((id) => deactivation.get(id).objectSpace === sp)
    const [c, u] = await Promise.all([
      findIn(TX_CREATE, 'objectId', ids, { objectSpace: sp }),
      findIn(TX_UPDATE, 'objectId', ids, { objectSpace: sp })
    ])
    for (const t of [...c, ...u]) {
      if (t.objectId == null) throw new Error('histórico de Tx veio sem objectId — abortando')
      const arr = history.get(t.objectId) ?? []
      arr.push(t)
      history.set(t.objectId, arr)
    }
  }
  const comments = new Map<string, CycleComment>()
  for (const m of await findIn(CHAT_MESSAGE, 'attachedTo', originalIds, { createdOn: { $gte: from, $lte: to } })) {
    const parsed = parseCycleComment(m)
    if (parsed !== undefined && m.attachedTo != null && !comments.has(m.attachedTo)) comments.set(m.attachedTo, parsed)
  }

  const originals: OriginalPlan[] = []
  for (const id of originalIds) {
    const doc = issueById.get(id)
    if (doc === undefined) continue
    const plan: OriginalPlan = { doc, clearCompleted: false, done: false }
    originals.push(plan)
    const firstWin = firstWinTx.get(id) ?? deactivation.get(id).modifiedOn
    const txs = (history.get(id) ?? []).sort(byTime)
    for (const t of txs) {
      if (t.modifiedOn >= firstWin) break
      if (t._class === TX_CREATE && t.attributes?.status != null) plan.preStatus = t.attributes.status
      if (t._class === TX_UPDATE && t.operations?.status != null) plan.preStatus = t.operations.status
    }
    const later = txs.filter((t) => t.modifiedOn > firstWin && t.modifiedBy !== SYSTEM && t.operations?.status != null)
    if (later.length > 0) {
      const last = later[later.length - 1]
      plan.touchedBy = `status → "${statusName(last.operations.status)}" por ${String(last.modifiedBy)} em ${fmtBrt(last.modifiedOn)}`
      plan.touchedById = String(last.modifiedBy)
    }
    const c = comments.get(id)
    if (plan.preStatus === undefined) plan.conflict = 'sem status anterior no histórico de Tx'
    else if (!statusById.has(plan.preStatus)) plan.conflict = `status anterior ${plan.preStatus} não existe mais`
    else if (c === undefined) plan.conflict = 'sem o comentário "Ciclo PDCA reiniciado" para conferir'
    else if (norm(c.prevStatusName) !== norm(statusName(plan.preStatus))) {
      plan.conflict = `histórico diz "${statusName(plan.preStatus)}", comentário diz "${String(c.prevStatusName)}"`
    }
    plan.done = doc.status === plan.preStatus
    // Se não havia data de conclusão, a que existe agora foi carimbada pelo
    // OnAutomaticDates quando o worker pôs o status Won — limpa depois do status.
    const cd = doc.completedDate as number | null | undefined
    plan.clearCompleted = c?.prevCompleted === '—' && cd != null && cd >= from && cd <= to
  }

  // Pareia cópia ↔ original só para o relatório (mesmo projeto e título; o worker
  // desativa a original e cria a cópia logo em seguida, um ciclo por vez).
  const deactByKey = new Map<string, any[]>()
  for (const t of deactivation.values()) {
    const d = issueById.get(t.objectId)
    if (d === undefined) continue
    const key = `${String(t.objectSpace)}|${norm(d.title)}`
    deactByKey.set(key, [...(deactByKey.get(key) ?? []), t])
  }
  for (const [rootId, tree] of trees) {
    const rootTx = createTxById.get(rootId)
    const key = `${String(rootTx?.objectSpace)}|${norm(rootTx?.attributes?.title)}`
    const cands = (deactByKey.get(key) ?? []).filter((t) => t.modifiedOn <= rootTx.modifiedOn).sort(byTime)
    if (cands.length > 0) tree.original = issueById.get(cands[cands.length - 1].objectId)
  }

  // ---------- 5. Plano e relatório ----------
  const allTrees = [...trees.values()]
  const toDelete = allTrees.filter((t) => t.reasons.length === 0)
  const toReview = allTrees.filter((t) => t.reasons.length > 0)
  const origConflict = originals.filter((o) => o.conflict !== undefined)
  const origDone = originals.filter((o) => o.conflict === undefined && o.done)
  const liberada = (o: OriginalPlan): boolean =>
    o.touchedBy === undefined || incluirTocadas || (o.touchedById !== undefined && tocadasPor.has(o.touchedById))
  const origTouched = originals.filter((o) => o.conflict === undefined && !o.done && o.touchedBy !== undefined && !liberada(o))
  const origRestore = originals.filter((o) => o.conflict === undefined && !o.done && liberada(o))
  const subCount = (ts: CloneTree[]): number => ts.reduce((n, t) => n + t.nodes.length - 1, 0)

  console.log(`\n🧹 Limpeza do replay PDCA — janela ${fmtBrt(from)} → ${fmtBrt(to)} (BRT)`)
  console.log(`   modo: ${apply ? '💾 APPLY (grava em produção)' : '🔎 DRY-RUN (não grava)'}${onlySpace !== undefined ? `   projeto: ${onlySpace}` : ''}`)
  console.log(`   workspace: ${String(workspaceId)}`)
  console.log(`   projetos com escrita do System na janela: ${new Set([...winCreates, ...winUpdates].map((t) => t.objectSpace)).size}`)
  console.log('\n   (referência — log do worker em 16/10, somando TODAS as workspaces: 217 duplicações, 401 resets)')
  console.log(`   CÓPIAS a apagar          : ${toDelete.length} tarefas (+ ${subCount(toDelete)} sub-tarefas)`)
  console.log(`   CÓPIAS para revisar      : ${toReview.length} (alguém mexeu depois — NÃO apaga)`)
  console.log(`   ORIGINAIS a restaurar    : ${origRestore.length}${incluirTocadas || tocadasPor.size > 0 ? ' (inclui tocadas liberadas)' : ''}`)
  console.log(`   ORIGINAIS tocadas depois : ${origTouched.length} (fora; use --incluir-tocadas ou --incluir-tocadas-por <socialId>)`)
  console.log(`   ORIGINAIS já restauradas : ${origDone.length}`)
  console.log(`   ORIGINAIS em conflito    : ${origConflict.length} (não mexe)`)
  console.log(`   RESETS (só relatório)    : ${resetIds.size}`)
  if (otherCreates > 0) console.log(`   outras criações do System na janela (ignoradas): ${otherCreates}`)
  if (alreadyGone > 0) console.log(`   cópias que já não existem: ${alreadyGone}`)

  type Col = 'del' | 'rev' | 'rest' | 'touch' | 'conf' | 'resets'
  const perSpace = new Map<string, Record<Col, number>>()
  const bump = (sp: string | undefined, k: Col): void => {
    const key = sp ?? '?'
    const row = perSpace.get(key) ?? { del: 0, rev: 0, rest: 0, touch: 0, conf: 0, resets: 0 }
    row[k]++
    perSpace.set(key, row)
  }
  for (const t of toDelete) bump(t.root.space, 'del')
  for (const t of toReview) bump(t.root.space, 'rev')
  for (const o of origRestore) bump(o.doc.space, 'rest')
  for (const o of origTouched) bump(o.doc.space, 'touch')
  for (const o of origConflict) bump(o.doc.space, 'conf')
  for (const id of resetIds) bump(issueById.get(id)?.space, 'resets')
  console.log('\n─── por projeto ───')
  console.log(`  ${'projeto'.padEnd(32)} ${'projectId'.padEnd(26)} apagar  revisar  restaurar  tocadas  conflito  resets`)
  for (const [sp, r] of [...perSpace.entries()].sort((a, b) => (b[1].del + b[1].resets) - (a[1].del + a[1].resets))) {
    const p = projectById.get(sp)
    const label = `${p?.archived === true ? '[arq] ' : ''}${String(p?.identifier ?? '?')} · ${String(p?.name ?? '')}`.slice(0, 32).padEnd(32)
    console.log(`  ${label} ${sp.padEnd(26)} ${String(r.del).padStart(6)}  ${String(r.rev).padStart(7)}  ${String(r.rest).padStart(9)}  ${String(r.touch).padStart(7)}  ${String(r.conf).padStart(8)}  ${String(r.resets).padStart(6)}`)
  }

  if (toDelete.length > 0) {
    console.log('\n─── cópias a apagar (amostra de 15) ───')
    for (const t of toDelete.slice(0, 15)) {
      const orig = t.original !== undefined ? `← cópia de ${String(t.original.identifier)}` : ''
      console.log(`  ${String(t.root.identifier).padEnd(12)} ${orig.padEnd(22)} +${t.nodes.length - 1} sub   ${String(t.root.title).slice(0, 60)}`)
    }
  }
  if (toReview.length > 0) {
    console.log('\n─── cópias para revisar à mão (não serão apagadas) ───')
    for (const t of toReview) {
      console.log(`  ${String(t.root.identifier ?? t.root._id).padEnd(12)} ${String(t.root.title ?? '').slice(0, 50).padEnd(50)} ${[...new Set(t.reasons)].join('; ')}`)
    }
  }
  if (origRestore.length > 0) {
    console.log('\n─── originais a restaurar (amostra de 15) ───')
    for (const o of origRestore.slice(0, 15)) {
      const extra = o.clearCompleted ? '  (+ limpa data de conclusão carimbada)' : ''
      console.log(`  ${String(o.doc.identifier).padEnd(12)} "${statusName(o.doc.status)}" → "${statusName(o.preStatus)}"${extra}   ${String(o.doc.title).slice(0, 50)}`)
    }
  }
  if (origTouched.length > 0) {
    console.log('\n─── originais tocadas depois do incidente (fora) ───')
    for (const o of origTouched) {
      console.log(`  ${String(o.doc.identifier).padEnd(12)} voltaria para "${statusName(o.preStatus)}" — ${String(o.touchedBy)}`)
    }
  }
  if (origConflict.length > 0) {
    console.log('\n─── originais em conflito (não mexe) ───')
    for (const o of origConflict) console.log(`  ${String(o.doc.identifier).padEnd(12)} ${String(o.conflict)}`)
  }

  if (csvPath !== undefined) {
    const q = (s: unknown): string => JSON.stringify(String(s ?? ''))
    const proj = (sp: string | undefined): string => String(projectById.get(sp ?? '')?.identifier ?? '')
    const lines = ['acao,identifier,titulo,projeto,detalhe,id']
    for (const t of toDelete) {
      for (const n of [...t.nodes].sort((a, b) => b.depth - a.depth)) {
        const det = t.original !== undefined ? `cópia de ${String(t.original.identifier)}` : ''
        lines.push(['apagar-copia', n.doc.identifier, q(n.doc.title), proj(n.doc.space), q(det), n.doc._id].join(','))
      }
    }
    for (const t of toReview) lines.push(['revisar-copia', t.root.identifier, q(t.root.title), proj(t.root.space), q([...new Set(t.reasons)].join('; ')), t.root._id].join(','))
    for (const o of origRestore) lines.push(['restaurar-status', o.doc.identifier, q(o.doc.title), proj(o.doc.space), q(`${statusName(o.doc.status)} → ${statusName(o.preStatus)}`), o.doc._id].join(','))
    for (const o of origTouched) lines.push(['original-tocada', o.doc.identifier, q(o.doc.title), proj(o.doc.space), q(o.touchedBy), o.doc._id].join(','))
    for (const o of origConflict) lines.push(['original-conflito', o.doc.identifier, q(o.doc.title), proj(o.doc.space), q(o.conflict), o.doc._id].join(','))
    for (const id of resetIds) {
      const d = issueById.get(id)
      lines.push(['reset-relatorio', d?.identifier, q(d?.title), proj(d?.space), '', id].join(','))
    }
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8')
    console.log(`\n📄 Plano exportado: ${csvPath} (${lines.length - 1} linhas)`)
  }

  // ---------- 6. Apply ----------
  if (!apply) {
    console.log('\n💡 DRY-RUN — nada foi gravado. Para aplicar: adicione --apply (sugestão: comece com --space <projectId>).')
    return
  }
  if (toDelete.length === 0 && origRestore.length === 0) {
    console.log('\nNada a aplicar.')
    return
  }

  const { createRestTxOperations } = await import('@hcengineering/api-client')
  const client: any = await createRestTxOperations(url, workspaceId, HUB_API_TOKEN)

  console.log(`\n💾 Apagando ${toDelete.length} cópias (+ ${subCount(toDelete)} sub-tarefas)...`)
  const deleteFailures: string[] = []
  const deletedIds: string[] = []
  let treesDone = 0
  for (const t of toDelete) {
    // Mais fundo primeiro: a raiz só sai depois das sub-tarefas.
    for (const n of [...t.nodes].sort((a, b) => b.depth - a.depth)) {
      const d = n.doc
      try {
        if (d.attachedTo != null && d.attachedToClass != null && d.collection != null) {
          await client.removeCollection(ISSUE, d.space, d._id, d.attachedTo, d.attachedToClass, d.collection)
        } else {
          await client.removeDoc(ISSUE, d.space, d._id)
        }
        deletedIds.push(d._id)
      } catch (err: any) {
        deleteFailures.push(`${String(d.identifier)}: ${String(err?.message ?? err)}`)
      }
      await sleep(WRITE_THROTTLE_MS)
    }
    if (++treesDone % 25 === 0) console.log(`  … ${treesDone}/${toDelete.length}`)
  }
  console.log(`  apagadas: ${deletedIds.length}, falhas: ${deleteFailures.length}`)
  for (const f of deleteFailures) console.warn(`  ⚠️  ${f}`)

  console.log(`\n💾 Restaurando o status de ${origRestore.length} originais...`)
  const restoreFailures: string[] = []
  for (const o of origRestore) {
    const d = o.doc
    try {
      await client.updateDoc(ISSUE, d.space, d._id, { status: o.preStatus })
      if (o.clearCompleted) await client.updateDoc(ISSUE, d.space, d._id, { completedDate: null })
    } catch (err: any) {
      restoreFailures.push(`${String(d.identifier)}: ${String(err?.message ?? err)}`)
    }
    await sleep(WRITE_THROTTLE_MS)
  }
  console.log(`  falhas: ${restoreFailures.length}`)
  for (const f of restoreFailures) console.warn(`  ⚠️  ${f}`)

  // ---------- 7. Conferência ----------
  // Os triggers podem desfazer em silêncio (OnIssueCompletionCheck devolve o
  // status se a regra de conclusão do projeto não bater) — relê e compara.
  console.log('\n🔍 Conferindo...')
  const stillThere = await findIn(ISSUE, '_id', deletedIds)
  console.log(`  cópias que ainda existem: ${stillThere.length}`)
  const reread = await findIn(ISSUE, '_id', origRestore.map((o) => o.doc._id as string))
  if (reread.some((d: any) => d._id == null)) {
    console.log('  ⚠️  a releitura veio sem _id — confira rodando o dry-run de novo')
  } else {
    const byId = new Map<string, any>(reread.map((d: any) => [d._id, d]))
    const mismatch = origRestore.filter((o) => byId.get(o.doc._id)?.status !== o.preStatus)
    console.log(`  originais com status diferente do esperado: ${mismatch.length}`)
    for (const o of mismatch) {
      console.log(`    ${String(o.doc.identifier).padEnd(12)} esperado "${statusName(o.preStatus)}", está "${statusName(byId.get(o.doc._id)?.status)}"`)
    }
  }
  console.log('\n✅ Concluído. Rode o dry-run de novo: deve sobrar só o que está em "revisar", "tocadas" ou "conflito".')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
