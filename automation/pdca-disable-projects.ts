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
// F04 — Desliga o PDCA de TODAS as tarefas de projetos escolhidos.
//
// Por quê: em 01/11/2026 a duplicação mensal gerou 136 cópias no QG Criativo,
// que cria as tarefas mensais à mão. O time decidiu não usar PDCA nesses
// projetos. Ver INCIDENTES.md (2026-11-01).
//
// O que faz: grava { pdcaCycleActive: false } nas tarefas. O trigger
// OnPdcaCycleToggle cancela o agendamento no TimeMachine e limpa o
// pdcaNextCycleDate. Com --templates, desliga também nos templates dos projetos,
// senão toda tarefa nova criada deles nasce com o PDCA ligado. Frequência, status
// de reset e demais campos pdcaCycle* ficam como estão.
//
// SÓ LEITURA por padrão (dry-run). Use --apply para gravar.
//
// Uso:
//   npx tsx automation/pdca-disable-projects.ts --projetos PLAN,VIDEO            # dry-run
//   npx tsx automation/pdca-disable-projects.ts --projetos PLAN,VIDEO --apply [--templates] [--csv lista.csv]
//
// Env (automation/.env ou --env): HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN
//
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

const envFile = arg('--env')
dotenv.config({ path: envFile !== undefined ? path.resolve(envFile) : path.join(__dirname, '.env') })

const ISSUE = 'tracker:class:Issue'
const TEMPLATE = 'tracker:class:IssueTemplate'
const PROJECT = 'tracker:class:Project'
const WRITE_THROTTLE_MS = 80
const IN_BATCH = 200

async function restFind (
  base: string,
  workspace: string,
  token: string,
  _class: string,
  query: Record<string, any> = {}
): Promise<any[]> {
  const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/find-all/${workspace}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _class, query, options: { showArchived: true } })
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

async function run (): Promise<void> {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN } = process.env
  if (HUB_API_TOKEN === undefined || HUB_API_TOKEN === '') {
    console.error('❌ HUB_API_TOKEN não configurado (automation/.env)')
    process.exit(1)
  }
  const wanted = (arg('--projetos') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => s !== '')
  if (wanted.length === 0) {
    console.error('❌ informe --projetos IDENT1,IDENT2 (identificador do projeto, ex.: PLAN)')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const withTemplates = process.argv.includes('--templates')
  const csvPath = arg('--csv')

  let workspaceId = HUB_WORKSPACE_ID
  if (workspaceId === undefined || workspaceId === '') {
    const payload = JSON.parse(Buffer.from(HUB_API_TOKEN.split('.')[1], 'base64').toString())
    workspaceId = payload.workspace as string
  }
  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332'
  const F = async (c: string, q?: Record<string, any>): Promise<any[]> =>
    await restFind(url, workspaceId as string, HUB_API_TOKEN, c, q)

  const projects = (await F(PROJECT)).filter((p: any) => wanted.includes(String(p.identifier).toUpperCase()))
  const missing = wanted.filter((w) => !projects.some((p: any) => String(p.identifier).toUpperCase() === w))
  if (missing.length > 0) {
    console.error(`❌ projeto(s) não encontrado(s): ${missing.join(', ')}`)
    process.exit(1)
  }
  const byId = new Map<string, any>(projects.map((p: any) => [p._id, p]))
  // pdcaCycleActive vem omitido do resultado (igualdade na query) — sabemos que é true.
  const issues = (await F(ISSUE, { pdcaCycleActive: true })).filter((i: any) => byId.has(i.space))
  const templates = (await F(TEMPLATE, { pdcaCycleActive: true })).filter((t: any) => byId.has(t.space))

  console.log('\n⏹️  Desligar PDCA por projeto')
  console.log(`   modo: ${apply ? '💾 APPLY (grava em produção)' : '🔎 DRY-RUN (não grava)'}   workspace: ${String(workspaceId)}`)
  console.log(`   tarefas com PDCA ativo: ${issues.length}   templates com PDCA ativo: ${templates.length}${withTemplates ? '' : ' (só com --templates)'}\n`)
  for (const p of projects) {
    const mine = issues.filter((i: any) => i.space === p._id)
    const dup = mine.filter((i: any) => i.pdcaCycleDuplicate === true).length
    const tpl = templates.filter((t: any) => t.space === p._id).length
    console.log(`  ${String(p.identifier).padEnd(8)} ${String(p.name ?? '').slice(0, 40).padEnd(40)} ${String(mine.length).padStart(4)} tarefas (${dup} em modo duplicar) · ${tpl} templates`)
  }
  for (const t of templates) {
    console.log(`  template: "${String(t.title)}" (${String(byId.get(t.space)?.identifier)}) freq=${String(t.pdcaCycleFrequency ?? '—')} duplicar=${String(t.pdcaCycleDuplicate === true)}`)
  }

  if (csvPath !== undefined) {
    const q = (s: unknown): string => JSON.stringify(String(s ?? ''))
    const lines = ['tipo,identifier,titulo,projeto,frequencia,duplicar,id']
    for (const i of issues) {
      lines.push(['tarefa', i.identifier, q(i.title), byId.get(i.space)?.identifier, i.pdcaCycleFrequency ?? '', i.pdcaCycleDuplicate === true, i._id].join(','))
    }
    for (const t of templates) {
      lines.push(['template', '', q(t.title), byId.get(t.space)?.identifier, t.pdcaCycleFrequency ?? '', t.pdcaCycleDuplicate === true, t._id].join(','))
    }
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8')
    console.log(`\n📄 Lista exportada: ${csvPath} (${issues.length + templates.length} linhas)`)
  }

  if (!apply) {
    console.log('\n💡 DRY-RUN — nada foi gravado. Para aplicar: adicione --apply (e --templates para os templates).')
    return
  }
  const targets = [...issues.map((d: any) => ({ cls: ISSUE, d })), ...(withTemplates ? templates.map((d: any) => ({ cls: TEMPLATE, d })) : [])]
  if (targets.length === 0) {
    console.log('\nNada a aplicar.')
    return
  }

  const { createRestTxOperations } = await import('@hcengineering/api-client')
  const client: any = await createRestTxOperations(url, workspaceId, HUB_API_TOKEN)
  console.log(`\n💾 Desligando o PDCA de ${targets.length} documento(s)...`)
  const failures: string[] = []
  let done = 0
  for (const { cls, d } of targets) {
    try {
      await client.updateDoc(cls, d.space, d._id, { pdcaCycleActive: false })
      done++
      if (done % 100 === 0) console.log(`  … ${done}/${targets.length}`)
    } catch (err: any) {
      failures.push(`${String(d.identifier ?? d.title)}: ${String(err?.message ?? err)}`)
    }
    await sleep(WRITE_THROTTLE_MS)
  }
  console.log(`  desligados: ${done}, falhas: ${failures.length}`)
  for (const f of failures) console.warn(`  ⚠️  ${f}`)

  let still = 0
  for (const [cls, docs] of [[ISSUE, issues], [TEMPLATE, withTemplates ? templates : []]] as const) {
    const ids: string[] = docs.map((x: any) => x._id)
    for (let k = 0; k < ids.length; k += IN_BATCH) {
      const found = await F(cls, { _id: { $in: ids.slice(k, k + IN_BATCH) } })
      still += found.filter((x: any) => x.pdcaCycleActive === true).length
    }
  }
  console.log(`\n🔍 Conferência: ${still} ainda com PDCA ativo (esperado 0).`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
