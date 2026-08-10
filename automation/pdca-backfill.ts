//
// F04 — Backfill das tarefas PDCA "configuradas, porém sem ciclos".
//
// Conserta as issues com pdcaCycleActive=true que nunca ciclam porque nasceram
// sem pdcaCycleFrequency e/ou pdcaCycleResetStatus (bug do default só-visual do
// PdcaCycleSection; ver memory pdca_template_default_not_persisted). Estratégia:
//
//   • frequency  → copiado do TEMPLATE de origem (campo template.template; se não
//                  houver, casa por título exato). NÃO chutamos frequência: se o
//                  template também estiver sem freq, a issue fica "bloqueada" e é
//                  reportada (corrija o template primeiro na UI já corrigida).
//   • resetStatus→ do template; se o template não tiver, usa o defaultIssueStatus
//                  do PRÓPRIO projeto da issue (default seguro, escopado ao projeto).
//   • dueDays / customWeekdays → copiados do template quando a issue não tiver.
//
// O updateDoc que grava freq/reset dispara o trigger OnPdcaCycleToggle no
// transactor, que agenda o ciclo e preenche pdcaNextCycleDate sozinho — não
// precisa reiniciar o worker.
//
// SÓ LEITURA por padrão (dry-run). Use --apply para gravar.
//
// Uso:
//   npx tsx automation/pdca-backfill.ts               # dry-run (não grava)
//   npx tsx automation/pdca-backfill.ts --csv plano.csv
//   npx tsx automation/pdca-backfill.ts --apply       # grava em produção
//
// Env (automation/.env): HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN
//
import { createRestTxOperations } from '@hcengineering/api-client'
import tracker from '@hcengineering/tracker'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '.env') })

const ISSUE = tracker.class.Issue as unknown as string
const TEMPLATE = tracker.class.IssueTemplate as unknown as string
const PROJECT = tracker.class.Project as unknown as string
const NO_PARENT = tracker.ids.NoParent as unknown as string

const WRITE_THROTTLE_MS = 60

const FREQ_LABEL: Record<string, string> = {
  daily: 'diária', weekly: 'semanal', biweekly: 'quinzenal',
  monthly: 'mensal', quarterly: 'trimestral', custom: 'custom'
}

// Read cru no endpoint REST — o wrapper findAll do api-client local quebra quando
// o transactor devolve lookupMap:null (skew de versão). A auditoria não usa $lookup.
async function restFindAll (base: string, workspace: string, token: string, _class: string, query?: Record<string, any>): Promise<any[]> {
  const params = new URLSearchParams()
  params.append('class', _class)
  if (query != null && Object.keys(query).length > 0) params.append('query', JSON.stringify(query))
  const endpoint = base.replace(/\/$/, '')
  const res = await fetch(`${endpoint}/api/v1/find-all/${workspace}?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  if (!res.ok) throw new Error(`find-all ${_class} → HTTP ${res.status} ${res.statusText}`)
  const parsed: any = JSON.parse(await res.text())
  if (parsed?.error != null) throw new Error(`platform error: ${JSON.stringify(parsed.error)}`)
  if (parsed?.dataType === 'TotalArray') return Array.isArray(parsed.value) ? parsed.value : []
  if (Array.isArray(parsed)) return parsed
  return Array.isArray(parsed?.value) ? parsed.value : []
}

interface TplCfg {
  _id: string
  title: string
  freq?: string
  reset?: string
  dueDays?: number[]
  customWeekdays?: number[]
  ok: boolean
}

function normTitle (s: string | undefined): string {
  return (s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

function tplWellConfigured (freq?: string, reset?: string, cw?: number[]): boolean {
  if (freq == null || reset == null) return false
  if (freq === 'custom' && (!Array.isArray(cw) || cw.length === 0)) return false
  return true
}

function issueMisconfigured (i: any): boolean {
  const freq = i.pdcaCycleFrequency
  const reset = i.pdcaCycleResetStatus
  const cw = i.pdcaCycleCustomWeekdays
  return freq == null || reset == null || (freq === 'custom' && (!Array.isArray(cw) || cw.length === 0))
}

async function run (): Promise<void> {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN } = process.env
  if (!HUB_API_TOKEN) { console.error('❌ HUB_API_TOKEN não configurado (automation/.env)'); process.exit(1) }

  const apply = process.argv.includes('--apply')
  const csvIdx = process.argv.indexOf('--csv')
  const csvPath = csvIdx >= 0 ? process.argv[csvIdx + 1] : undefined

  let workspaceId = HUB_WORKSPACE_ID
  if (!workspaceId) {
    const payload = JSON.parse(Buffer.from(HUB_API_TOKEN.split('.')[1], 'base64').toString())
    workspaceId = payload.workspace
  }
  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332'

  // ---- Carrega templates PDCA, projetos, e issues ativas ----
  const templates = await restFindAll(url, workspaceId!, HUB_API_TOKEN, TEMPLATE)
  const projects = await restFindAll(url, workspaceId!, HUB_API_TOKEN, PROJECT)
  const issues = await restFindAll(url, workspaceId!, HUB_API_TOKEN, ISSUE, { pdcaCycleActive: true })

  const projDefaultStatus = new Map<string, string>()
  for (const p of projects) {
    if (p.defaultIssueStatus != null) projDefaultStatus.set(p._id, p.defaultIssueStatus)
  }

  const tplById = new Map<string, TplCfg>()
  const tplByTitle = new Map<string, TplCfg[]>()
  for (const t of templates) {
    if (t.pdcaCycleActive !== true) continue
    const cfg: TplCfg = {
      _id: t._id,
      title: t.title ?? '',
      freq: t.pdcaCycleFrequency ?? undefined,
      reset: t.pdcaCycleResetStatus ?? undefined,
      dueDays: Array.isArray(t.pdcaCycleDueDays) ? t.pdcaCycleDueDays : undefined,
      customWeekdays: Array.isArray(t.pdcaCycleCustomWeekdays) ? t.pdcaCycleCustomWeekdays : undefined,
      ok: tplWellConfigured(t.pdcaCycleFrequency, t.pdcaCycleResetStatus, t.pdcaCycleCustomWeekdays)
    }
    tplById.set(cfg._id, cfg)
    const key = normTitle(cfg.title)
    const arr = tplByTitle.get(key) ?? []
    arr.push(cfg)
    tplByTitle.set(key, arr)
  }

  const broken = issues.filter(issueMisconfigured)

  interface PlanRow {
    _id: string
    space: string
    identifier: string
    title: string
    via: 'ref' | 'title' | 'projeto'
    tpl?: string
    update: Record<string, any>
  }
  interface Blocked { identifier: string, title: string, reason: string, tplTitle?: string, tplId?: string }

  const plan: PlanRow[] = []
  const blocked: Blocked[] = []
  const blockedByTpl = new Map<string, number>() // tplId → count (bloqueadas por freq faltando no template)

  for (const i of broken) {
    const update: Record<string, any> = {}
    let via: PlanRow['via'] = 'projeto'
    let usedTpl: TplCfg | undefined

    // Resolve template de origem: por ref, senão por título único.
    const ref = i.template?.template as string | undefined
    let src = ref != null ? tplById.get(ref) : undefined
    if (src != null) via = 'ref'
    if (src == null) {
      const cands = tplByTitle.get(normTitle(i.title)) ?? []
      if (cands.length === 1) { src = cands[0]; via = 'title' }
      // cands.length > 1 → ambíguo; deixa src indefinido (cai no fallback de projeto p/ reset, e freq fica bloqueada)
    }

    // --- frequency ---
    if (i.pdcaCycleFrequency == null) {
      if (src?.freq != null) {
        update.pdcaCycleFrequency = src.freq
        usedTpl = src
        // custom precisa de weekdays
        if (src.freq === 'custom') {
          const issueCw = Array.isArray(i.pdcaCycleCustomWeekdays) ? i.pdcaCycleCustomWeekdays : []
          if (issueCw.length === 0) {
            if (src.customWeekdays != null && src.customWeekdays.length > 0) update.pdcaCycleCustomWeekdays = src.customWeekdays
            else {
              blocked.push({ identifier: i.identifier ?? i._id, title: i.title ?? '', reason: 'freq=custom sem weekdays (template também sem)' })
              continue
            }
          }
        }
        if (i.pdcaCycleDueDays == null && src.dueDays != null) update.pdcaCycleDueDays = src.dueDays
      } else {
        // Sem frequência e sem template com frequência → não dá pra chutar.
        const reason = src != null ? `template de origem sem frequência: "${src.title}"` : (ref != null ? 'template de origem sumiu' : 'sem template e título não casa com nenhum template PDCA')
        blocked.push({ identifier: i.identifier ?? i._id, title: i.title ?? '', reason, tplTitle: src?.title, tplId: src?._id })
        if (src != null) blockedByTpl.set(src._id, (blockedByTpl.get(src._id) ?? 0) + 1)
        continue
      }
    }

    // --- resetStatus ---
    if (i.pdcaCycleResetStatus == null) {
      if (src?.reset != null) {
        update.pdcaCycleResetStatus = src.reset
        if (via === 'projeto') via = usedTpl != null ? via : 'ref'
      } else {
        const def = projDefaultStatus.get(i.space)
        if (def != null) update.pdcaCycleResetStatus = def
        else {
          blocked.push({ identifier: i.identifier ?? i._id, title: i.title ?? '', reason: 'sem resetStatus e projeto sem defaultIssueStatus' })
          continue
        }
      }
    }

    // --- customWeekdays: issue já é custom mas sem weekdays (freq presente) ---
    if (i.pdcaCycleFrequency === 'custom' && update.pdcaCycleFrequency == null) {
      const issueCw = Array.isArray(i.pdcaCycleCustomWeekdays) ? i.pdcaCycleCustomWeekdays : []
      if (issueCw.length === 0) {
        if (src?.customWeekdays != null && src.customWeekdays.length > 0) update.pdcaCycleCustomWeekdays = src.customWeekdays
        else {
          blocked.push({ identifier: i.identifier ?? i._id, title: i.title ?? '', reason: 'freq=custom sem weekdays (sem template p/ herdar)' })
          continue
        }
      }
    }

    if (Object.keys(update).length === 0) {
      blocked.push({ identifier: i.identifier ?? i._id, title: i.title ?? '', reason: 'nada a preencher (revisar manualmente)' })
      continue
    }

    plan.push({
      _id: i._id,
      space: i.space,
      identifier: i.identifier ?? i._id,
      title: i.title ?? '',
      via,
      tpl: (usedTpl ?? src)?.title,
      update
    })
  }

  // ---------- Relatório ----------
  const tplTitleById = new Map<string, string>(templates.map((t: any) => [t._id, t.title]))
  const badTpls = [...tplById.values()].filter((t) => !t.ok)

  console.log(`\n🔧 Backfill PDCA — ${broken.length} tarefa(s) ativas mal configuradas`)
  console.log(`   modo: ${apply ? '💾 APPLY (grava em produção)' : '🔎 DRY-RUN (não grava)'}`)
  console.log(`\n   ✅ resolvíveis agora : ${plan.length}`)
  console.log(`   ⛔ bloqueadas        : ${blocked.length}`)

  // Detalhe do que seria gravado
  const setFreq = plan.filter((p) => p.update.pdcaCycleFrequency != null).length
  const setReset = plan.filter((p) => p.update.pdcaCycleResetStatus != null).length
  const setDue = plan.filter((p) => p.update.pdcaCycleDueDays != null).length
  const setCw = plan.filter((p) => p.update.pdcaCycleCustomWeekdays != null).length
  console.log(`\n   campos a preencher nas resolvíveis:`)
  console.log(`     frequency      : ${setFreq}`)
  console.log(`     resetStatus    : ${setReset}  (${plan.filter((p) => p.via === 'projeto' || (p.update.pdcaCycleResetStatus != null && p.update.pdcaCycleFrequency == null)).length} via defaultIssueStatus do projeto)`)
  console.log(`     dueDays        : ${setDue}`)
  console.log(`     customWeekdays : ${setCw}`)

  if (badTpls.length > 0) {
    console.log(`\n─── ❌ TEMPLATES A CORRIGIR PRIMEIRO (${badTpls.length}) — bloqueiam issues por falta de frequência ───`)
    for (const t of badTpls) {
      const nBlocked = blockedByTpl.get(t._id) ?? 0
      const falta = [t.freq == null ? 'frequência' : null, t.reset == null ? 'status de reset' : null].filter(Boolean).join(' + ')
      console.log(`  tpl…${t._id.slice(-6)}  falta ${falta.padEnd(22)} bloqueia ${String(nBlocked).padStart(4)} issue(s)   ${t.title}`)
    }
    console.log(`  → corrija esses templates na UI (agora persiste a frequência) e rode de novo o dry-run.`)
  }

  // Amostra das resolvíveis
  if (plan.length > 0) {
    console.log(`\n─── ✅ AMOSTRA DAS RESOLVÍVEIS (até 20) ───`)
    for (const p of plan.slice(0, 20)) {
      const parts = Object.entries(p.update).map(([k, v]) => {
        const kk = k.replace('pdcaCycle', '')
        if (k === 'pdcaCycleFrequency') return `freq=${FREQ_LABEL[v as string] ?? v}`
        if (k === 'pdcaCycleResetStatus') return `reset=✓`
        return `${kk}=${JSON.stringify(v)}`
      }).join(' ')
      console.log(`  ${String(p.identifier).padEnd(12)} [${p.via}] ${parts}   ${p.title}`)
    }
  }

  // Bloqueadas por motivo
  if (blocked.length > 0) {
    const byReason = new Map<string, number>()
    for (const b of blocked) byReason.set(b.reason, (byReason.get(b.reason) ?? 0) + 1)
    console.log(`\n─── ⛔ BLOQUEADAS por motivo ───`)
    for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}×  ${r}`)
    }
  }

  // CSV
  if (csvPath != null) {
    const lines = ['identifier,title,via,template,frequency,resetStatus,dueDays,customWeekdays']
    for (const p of plan) {
      const u = p.update
      lines.push([
        p.identifier,
        JSON.stringify(p.title),
        p.via,
        JSON.stringify(p.tpl ?? ''),
        u.pdcaCycleFrequency ?? '',
        u.pdcaCycleResetStatus ?? '',
        u.pdcaCycleDueDays != null ? `"${(u.pdcaCycleDueDays as number[]).join('|')}"` : '',
        u.pdcaCycleCustomWeekdays != null ? `"${(u.pdcaCycleCustomWeekdays as number[]).join('|')}"` : ''
      ].join(','))
    }
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8')
    console.log(`\n📄 Plano exportado: ${csvPath} (${plan.length} linhas)`)
  }

  // ---------- Apply ----------
  if (!apply) {
    console.log(`\n💡 Isto foi um DRY-RUN. Para gravar as ${plan.length} resolvíveis: adicione --apply`)
    console.log(`   (o updateDoc dispara o trigger OnPdcaCycleToggle → agenda o ciclo automaticamente)`)
    return
  }

  if (plan.length === 0) {
    console.log('\nNada a aplicar.')
    return
  }

  console.log(`\n💾 Aplicando ${plan.length} correções...`)
  const writeClient = await createRestTxOperations(url, workspaceId!, HUB_API_TOKEN)
  let done = 0
  let failed = 0
  for (const p of plan) {
    try {
      await writeClient.updateDoc(tracker.class.Issue, p.space as any, p._id as any, p.update as any)
      done++
      if (done % 50 === 0) console.log(`  … ${done}/${plan.length}`)
    } catch (err: any) {
      failed++
      console.warn(`  ⚠️  ${p.identifier}: ${err?.message ?? String(err)}`)
    }
    await new Promise((r) => setTimeout(r, WRITE_THROTTLE_MS))
  }
  console.log(`\n✅ Concluído: ${done} gravadas, ${failed} falhas.`)
  console.log(`   O trigger agenda os ciclos; confira com: npx tsx automation/pdca-audit.ts --stale`)
}

run().catch((e) => { console.error(e); process.exit(1) })
