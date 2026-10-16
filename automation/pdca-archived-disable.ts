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
// F04 — Desliga o PDCA das tarefas que estão em projetos ARQUIVADOS.
//
// Por quê: o servidor esconde projeto arquivado das consultas comuns
// (shouldShowArchived), mas o worker usa a conta de sistema e continua ciclando
// essas tarefas — resets e duplicações que ninguém vê. Em 16/10 eram 602 das 982
// tarefas com PDCA ativo, e responderam pela maior parte da rajada do incidente.
// Ver memory pdca_orphan_replay_on_boot.
//
// O que faz: grava { pdcaCycleActive: false }. O trigger OnPdcaCycleToggle cancela
// o agendamento no TimeMachine e limpa o pdcaNextCycleDate. Frequência, status de
// reset e demais campos pdcaCycle* ficam como estão — religar no painel da tarefa
// volta a agendar.
//
// SÓ LEITURA por padrão (dry-run). Use --apply para gravar.
//
// Uso:
//   npx tsx automation/pdca-archived-disable.ts                       # dry-run
//   npx tsx automation/pdca-archived-disable.ts --space <projectId>   # só um projeto
//   npx tsx automation/pdca-archived-disable.ts --apply [--csv lista.csv]
//
// Env (automation/.env ou --env): HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN
//
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

const envFile = arg('--env')
dotenv.config({ path: envFile !== undefined ? path.resolve(envFile) : path.join(__dirname, '.env') })

const ISSUE = 'tracker:class:Issue'
const PROJECT = 'tracker:class:Project'
const WRITE_THROTTLE_MS = 80
const IN_BATCH = 200

// showArchived: sem ele o servidor omite justamente os projetos que queremos.
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
  const apply = process.argv.includes('--apply')
  const onlySpace = arg('--space')
  const csvPath = arg('--csv')

  let workspaceId = HUB_WORKSPACE_ID
  if (workspaceId === undefined || workspaceId === '') {
    const payload = JSON.parse(Buffer.from(HUB_API_TOKEN.split('.')[1], 'base64').toString())
    workspaceId = payload.workspace as string
  }
  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332'
  const F = async (c: string, q?: Record<string, any>): Promise<any[]> =>
    await restFind(url, workspaceId as string, HUB_API_TOKEN, c, q)

  const projects = await F(PROJECT)
  const archived = projects.filter((p: any) => p.archived === true && (onlySpace === undefined || p._id === onlySpace))
  const archivedById = new Map<string, any>(archived.map((p: any) => [p._id, p]))
  // pdcaCycleActive vem omitido do resultado (igualdade na query) — sabemos que é true.
  const active = (await F(ISSUE, { pdcaCycleActive: true })).filter((i: any) => archivedById.has(i.space))

  console.log('\n🗄️  Desligar PDCA em projetos arquivados')
  console.log(`   modo: ${apply ? '💾 APPLY (grava em produção)' : '🔎 DRY-RUN (não grava)'}   workspace: ${String(workspaceId)}`)
  console.log(`   projetos arquivados: ${archived.length}   tarefas com PDCA ativo neles: ${active.length}\n`)
  const perProject = new Map<string, { n: number, dup: number }>()
  for (const i of active) {
    const row = perProject.get(i.space) ?? { n: 0, dup: 0 }
    row.n++
    if (i.pdcaCycleDuplicate === true) row.dup++
    perProject.set(i.space, row)
  }
  for (const [sp, r] of [...perProject.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const p = archivedById.get(sp)
    console.log(`  ${String(p?.identifier).padEnd(8)} ${String(p?.name ?? '').slice(0, 40).padEnd(40)} ${String(r.n).padStart(4)} ativas (${r.dup} em modo duplicar)`)
  }

  if (csvPath !== undefined) {
    const q = (s: unknown): string => JSON.stringify(String(s ?? ''))
    const lines = ['identifier,titulo,projeto,frequencia,duplicar,id']
    for (const i of active) {
      lines.push([i.identifier, q(i.title), archivedById.get(i.space)?.identifier, i.pdcaCycleFrequency ?? '', i.pdcaCycleDuplicate === true, i._id].join(','))
    }
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8')
    console.log(`\n📄 Lista exportada: ${csvPath} (${active.length} linhas)`)
  }

  if (!apply) {
    console.log('\n💡 DRY-RUN — nada foi gravado. Para aplicar: adicione --apply.')
    return
  }
  if (active.length === 0) {
    console.log('\nNada a aplicar.')
    return
  }

  const { createRestTxOperations } = await import('@hcengineering/api-client')
  const client: any = await createRestTxOperations(url, workspaceId, HUB_API_TOKEN)
  console.log(`\n💾 Desligando o PDCA de ${active.length} tarefas...`)
  const failures: string[] = []
  let done = 0
  for (const i of active) {
    try {
      await client.updateDoc(ISSUE, i.space, i._id, { pdcaCycleActive: false })
      done++
      if (done % 100 === 0) console.log(`  … ${done}/${active.length}`)
    } catch (err: any) {
      failures.push(`${String(i.identifier)}: ${String(err?.message ?? err)}`)
    }
    await sleep(WRITE_THROTTLE_MS)
  }
  console.log(`  desligadas: ${done}, falhas: ${failures.length}`)
  for (const f of failures) console.warn(`  ⚠️  ${f}`)

  const ids: string[] = active.map((i: any) => i._id)
  let still = 0
  for (let k = 0; k < ids.length; k += IN_BATCH) {
    const docs = await F(ISSUE, { _id: { $in: ids.slice(k, k + IN_BATCH) } })
    still += docs.filter((d: any) => d.pdcaCycleActive === true).length
  }
  console.log(`\n🔍 Conferência: ${still} ainda com PDCA ativo (esperado 0).`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
