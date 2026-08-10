//
// F04 — Ciclo PDCA: auditoria de tarefas com ciclo vencido ("perdido").
//
// Lista as issues com pdcaCycleActive=true cujo pdcaNextCycleDate JÁ PASSOU —
// ou seja, o worker (serviço time-machine) deveria ter reiniciado a tarefa e
// não reiniciou (worker parado, agendamento perdido, erro no processamento).
// Também sinaliza:
//   - ATIVAS SEM AGENDAMENTO: pdcaCycleActive=true mas pdcaNextCycleDate vazio
//     (nunca foram agendadas — o bootstrap deveria ter preenchido).
//   - MAL CONFIGURADAS: ativas sem frequência/status de reset (ou custom sem
//     weekdays) — o worker pula essas, então nunca vão rodar.
//
// Somente LEITURA — não grava nada.
//
// Uso:
//   npx tsx automation/pdca-audit.ts             # panorama completo (marca as atrasadas)
//   npx tsx automation/pdca-audit.ts --stale     # só as atrasadas + mal configuradas
//   npx tsx automation/pdca-audit.ts --grace 60  # tolerância em minutos antes de acusar atraso (default 0)
//
// Env (automation/.env): HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN
//
import tracker from '@hcengineering/tracker'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '.env') })

const FREQ_LABEL: Record<string, string> = {
  daily: 'diária',
  weekly: 'semanal',
  biweekly: 'quinzenal',
  monthly: 'mensal',
  quarterly: 'trimestral',
  custom: 'custom'
}

function fmtDate (ts: number | null | undefined): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function fmtDelta (ms: number): string {
  const abs = Math.abs(ms)
  const d = Math.floor(abs / 86400000)
  const h = Math.floor((abs % 86400000) / 3600000)
  const m = Math.floor((abs % 3600000) / 60000)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 && d === 0) parts.push(`${m}m`)
  return parts.length > 0 ? parts.join(' ') : '<1m'
}

// O wrapper findAll do api-client local quebra quando o transactor devolve
// `lookupMap: null` (skew de versão cliente↔servidor: rest.ts:131 faz null[...]).
// Batemos direto no endpoint REST e extraímos só o array de docs, ignorando o
// lookupMap — a auditoria não usa $lookup. Não pedimos snappy, então o undici
// já descomprime gzip sozinho.
async function restFindAll (
  base: string,
  workspace: string,
  token: string,
  _class: string,
  query?: Record<string, any>
): Promise<any[]> {
  const params = new URLSearchParams()
  params.append('class', _class)
  if (query != null && Object.keys(query).length > 0) params.append('query', JSON.stringify(query))
  const endpoint = base.replace(/\/$/, '')
  const res = await fetch(`${endpoint}/api/v1/find-all/${workspace}?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  if (!res.ok) throw new Error(`find-all ${_class} → HTTP ${res.status} ${res.statusText}`)
  if (res.headers.get('content-encoding') === 'snappy') {
    throw new Error('resposta snappy inesperada (não solicitamos snappy)')
  }
  const parsed: any = JSON.parse(await res.text())
  if (parsed?.error != null) throw new Error(`platform error: ${JSON.stringify(parsed.error)}`)
  if (parsed?.dataType === 'TotalArray') return Array.isArray(parsed.value) ? parsed.value : []
  if (Array.isArray(parsed)) return parsed
  return Array.isArray(parsed?.value) ? parsed.value : []
}

interface Row {
  identifier: string
  title: string
  freq: string
  next: number | undefined
  status: string
  overdueMs: number | null
  misconfigured: boolean
  attached: boolean
}

async function run (): Promise<void> {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN } = process.env
  if (!HUB_API_TOKEN) {
    console.error('❌ HUB_API_TOKEN não configurado (automation/.env)')
    process.exit(1)
  }

  const onlyStale = process.argv.includes('--stale')
  const graceIdx = process.argv.indexOf('--grace')
  const graceMinRaw = graceIdx >= 0 ? Number(process.argv[graceIdx + 1] ?? '0') : 0
  const graceMin = Number.isFinite(graceMinRaw) ? graceMinRaw : 0
  const graceMs = graceMin * 60000

  let workspaceId = HUB_WORKSPACE_ID
  if (!workspaceId) {
    const payload = JSON.parse(Buffer.from(HUB_API_TOKEN.split('.')[1], 'base64').toString())
    workspaceId = payload.workspace
  }

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332'

  const now = Date.now()

  // Só as tarefas com ciclo ativo — mesma query filtrada que o bootstrap do
  // worker roda em produção (services/worker/src/pdca.ts). Leve: não puxa todas
  // as issues do workspace.
  const issues = await restFindAll(url, workspaceId!, HUB_API_TOKEN, tracker.class.Issue as unknown as string, {
    pdcaCycleActive: true
  })
  const statuses = await restFindAll(url, workspaceId!, HUB_API_TOKEN, tracker.class.IssueStatus as unknown as string)
  const statusName = new Map<string, string>(statuses.map((s: any) => [s._id, s.name]))
  const noParent = tracker.ids.NoParent as unknown as string

  const rows: Row[] = []
  for (const i of issues) {
    const freq = (i as any).pdcaCycleFrequency as string | undefined
    const resetStatus = (i as any).pdcaCycleResetStatus
    const customWeekdays = (i as any).pdcaCycleCustomWeekdays as number[] | undefined
    const next = (i as any).pdcaNextCycleDate as number | undefined
    const attachedTo = (i as any).attachedTo as string | undefined
    const misconfigured =
      freq == null ||
      resetStatus == null ||
      (freq === 'custom' && (customWeekdays == null || customWeekdays.length === 0))
    rows.push({
      identifier: (i as any).identifier ?? String(i._id),
      title: (i as any).title ?? '(sem título)',
      freq: freq != null ? (FREQ_LABEL[freq] ?? freq) : '—',
      next,
      status: statusName.get((i as any).status) ?? '—',
      overdueMs: next == null ? null : now - next,
      misconfigured,
      attached: attachedTo != null && attachedTo !== noParent
    })
  }

  const stale = rows
    .filter((r) => !r.misconfigured && r.overdueMs != null && r.overdueMs > graceMs)
    .sort((a, b) => (b.overdueMs ?? 0) - (a.overdueMs ?? 0))
  const notScheduled = rows.filter((r) => !r.misconfigured && r.next == null)
  const misconf = rows.filter((r) => r.misconfigured)
  const healthy = rows
    .filter((r) => !r.misconfigured && r.next != null && now - r.next <= graceMs)
    .sort((a, b) => (a.next ?? 0) - (b.next ?? 0))

  console.log(`\n🔁 Auditoria PDCA — ${rows.length} tarefa(s) com ciclo ATIVO`)
  console.log(`   agora: ${fmtDate(now)}${graceMin > 0 ? `  ·  tolerância: ${graceMin}min` : ''}`)
  console.log(`\n   ⏰ atrasadas (deveria ter reiniciado): ${stale.length}`)
  console.log(`   ⚠️  ativas sem agendamento (pdcaNextCycleDate vazio): ${notScheduled.length}`)
  console.log(`   ❌ mal configuradas (nunca vão rodar): ${misconf.length}`)
  console.log(`   ✅ em dia: ${healthy.length}`)

  if (stale.length > 0) {
    console.log('\n─── ⏰ ATRASADAS ─────────────────────────────────────────────')
    for (const r of stale) {
      console.log(
        `  ${r.identifier.padEnd(12)} atraso ${fmtDelta(r.overdueMs!).padEnd(10)} ` +
        `venceu ${fmtDate(r.next)}  [${r.freq} · ${r.status}]${r.attached ? ' (sub)' : ''}`
      )
      console.log(`               ${r.title}`)
    }
  }

  if (notScheduled.length > 0) {
    console.log('\n─── ⚠️  ATIVAS SEM AGENDAMENTO ───────────────────────────────')
    for (const r of notScheduled) {
      console.log(`  ${r.identifier.padEnd(12)} [${r.freq}]  ${r.title}`)
    }
  }

  if (misconf.length > 0) {
    console.log('\n─── ❌ MAL CONFIGURADAS (frequência/status de reset faltando) ─')
    for (const r of misconf) {
      console.log(`  ${r.identifier.padEnd(12)} [freq: ${r.freq}]  ${r.title}`)
    }
  }

  if (!onlyStale && healthy.length > 0) {
    console.log('\n─── ✅ EM DIA (próximo ciclo no futuro) ──────────────────────')
    for (const r of healthy) {
      console.log(`  ${r.identifier.padEnd(12)} próximo ${fmtDate(r.next)}  [${r.freq}]  ${r.title}`)
    }
  }

  if (stale.length === 0 && notScheduled.length === 0 && misconf.length === 0) {
    console.log('\n🎉 Nenhuma tarefa PDCA atrasada ou mal configurada.')
  } else if (stale.length > 0 || notScheduled.length > 0) {
    console.log('\n💡 Atraso/sem-agendamento = o worker (time-machine) não processou/agendou o disparo.')
    console.log('   Reagendar tudo: `docker restart dev-time-machine-1` (o bootstrap re-agenda as ativas).')
    console.log('   Investigar:     `docker logs dev-time-machine-1 2>&1 | grep -iE "PDCA|error" | tail -40`')
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
