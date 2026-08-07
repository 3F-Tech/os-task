//
// F12 — Nome do cliente via 3F Core: script de reconciliação one-off.
//
// Casa o `clientName` (texto livre) das issues existentes com o cadastro de
// clientes da 3F Core, comparando por `common_name` (normalizado). Onde casa,
// grava `clientCoreId` + normaliza o `clientName` para o nome cadastrado. Onde
// não casa, deixa como está (pendente).
//
// Só atualiza issues-RAIZ; o trigger OnIssueClientPropagate cascateia o
// clientCoreId para as sub-issues. Idempotente: pula issues já vinculadas.
//
// Uso:
//   npx tsx automation/reconcile-clients.ts            # dry-run (só relatório)
//   npx tsx automation/reconcile-clients.ts --apply    # aplica de verdade
//   npx tsx automation/reconcile-clients.ts --apply --csv automation/apelidos.csv
//
// Env (automation/.env):
//   HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN  (conexão Huly)
//   THREEF_CORE_URL, THREEF_CORE_API_KEY                 (3F Core /clients)
//
// CSV opcional (apelido→common_name): duas colunas `apelido,common_name`, usado
// para resolver os apelidos que não batem direto com o common_name.
//
import { createRestTxOperations, createRestClient } from '@hcengineering/api-client'
import tracker from '@hcengineering/tracker'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '.env') })

interface CoreClient {
  id: number
  name: string
  common_name: string | null
  status: string
  is_active: boolean
}

function normalize (s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

async function fetchCoreClients (baseUrl: string, apiKey: string): Promise<CoreClient[]> {
  const acc: CoreClient[] = []
  for (let page = 1; page <= 200; page++) {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/clients?page=${page}&perPage=100`, {
      headers: { 'X-API-Key': apiKey }
    })
    if (!res.ok) throw new Error(`3F Core GET /clients page ${page} → HTTP ${res.status}`)
    const body: any = await res.json()
    const data: CoreClient[] = Array.isArray(body?.data) ? body.data : []
    acc.push(...data)
    const total: number = typeof body?.meta?.total === 'number' ? body.meta.total : acc.length
    if (data.length === 0 || acc.length >= total) break
  }
  return acc.filter((c) => c.is_active)
}

function loadCsvAliases (csvPath: string): Map<string, string> {
  const map = new Map<string, string>()
  const raw = fs.readFileSync(csvPath, 'utf8')
  const lines = raw.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    const cols = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 2) continue
    // pula um provável cabeçalho
    if (i === 0 && /apelido|common|nome/i.test(cols[0]) && /common|core|cadastr/i.test(cols[1])) continue
    map.set(normalize(cols[0]), normalize(cols[1]))
  }
  return map
}

async function run (): Promise<void> {
  const { HUB_TRANSACTOR_URL, HUB_WORKSPACE_ID, HUB_API_TOKEN, THREEF_CORE_URL, THREEF_CORE_API_KEY } = process.env

  if (!HUB_API_TOKEN) {
    console.error('❌ HUB_API_TOKEN não configurado')
    process.exit(1)
  }
  if (!THREEF_CORE_API_KEY) {
    console.error('❌ THREEF_CORE_API_KEY não configurado')
    process.exit(1)
  }
  const coreUrl = THREEF_CORE_URL ?? 'https://3f-core.3fventure.tech'

  const apply = process.argv.includes('--apply')
  const csvIdx = process.argv.indexOf('--csv')
  const csvPath = csvIdx >= 0 ? process.argv[csvIdx + 1] : undefined

  let workspaceId = HUB_WORKSPACE_ID
  if (!workspaceId) {
    const payload = JSON.parse(Buffer.from(HUB_API_TOKEN.split('.')[1], 'base64').toString())
    workspaceId = payload.workspace
  }

  const url = HUB_TRANSACTOR_URL ?? 'https://3ftasks.3fventure.tech:3332'
  const readClient = createRestClient(url, workspaceId!, HUB_API_TOKEN)
  const writeClient = await createRestTxOperations(url, workspaceId!, HUB_API_TOKEN)

  console.log(`\n🔗 Modo: ${apply ? 'APLICAR' : 'DRY-RUN (nada será gravado)'}`)

  // 1) Clientes da Core → índice por common_name normalizado
  const clients = await fetchCoreClients(coreUrl, THREEF_CORE_API_KEY)
  const byCommon = new Map<string, CoreClient>()
  for (const c of clients) {
    const cn = (c.common_name ?? '').trim()
    if (cn !== '') byCommon.set(normalize(cn), c)
  }
  console.log(`📇 Core: ${clients.length} clientes ativos, ${byCommon.size} com nome comum`)

  const aliases = csvPath ? loadCsvAliases(csvPath) : new Map<string, string>()
  if (csvPath) console.log(`🗂️  CSV de apelidos: ${aliases.size} mapeamentos`)

  function resolve (clientName: string): CoreClient | undefined {
    const key = normalize(clientName)
    if (key === '') return undefined
    const direct = byCommon.get(key)
    if (direct !== undefined) return direct
    const viaCsv = aliases.get(key)
    if (viaCsv !== undefined) return byCommon.get(viaCsv)
    return undefined
  }

  // 2) Issues-raiz pendentes (sem clientCoreId, com clientName)
  const allIssues = await readClient.findAll(tracker.class.Issue, {})
  const noParent = tracker.ids.NoParent as unknown as string
  const roots = allIssues.filter((i) => {
    const at = (i as any).attachedTo as string | undefined
    return at === undefined || at === noParent
  })

  const matchedByName = new Map<string, { client: CoreClient, issues: typeof roots }>()
  const pending = new Map<string, number>()
  let emptyCount = 0
  let alreadyLinked = 0

  for (const issue of roots) {
    const name = ((issue as any).clientName ?? '').trim()
    if (name === '') {
      emptyCount++
      continue
    }
    if ((issue as any).clientCoreId !== undefined) {
      alreadyLinked++
      continue
    }
    const client = resolve(name)
    if (client === undefined) {
      pending.set(name, (pending.get(name) ?? 0) + 1)
      continue
    }
    const entry = matchedByName.get(name) ?? { client, issues: [] as typeof roots }
    entry.issues.push(issue)
    matchedByName.set(name, entry)
  }

  // 3) Relatório
  const matchedIssueCount = Array.from(matchedByName.values()).reduce((a, e) => a + e.issues.length, 0)
  console.log('\n─── RELATÓRIO ───')
  console.log(`Issues-raiz: ${roots.length}`)
  console.log(`  já vinculadas: ${alreadyLinked}`)
  console.log(`  sem cliente (vazio): ${emptyCount}`)
  console.log(`  ✅ casadas: ${matchedIssueCount} issues em ${matchedByName.size} nomes distintos`)
  console.log(`  🟡 pendentes: ${Array.from(pending.values()).reduce((a, n) => a + n, 0)} issues em ${pending.size} nomes distintos`)

  if (pending.size > 0) {
    console.log('\n🟡 Nomes SEM match (candidatos a common_name novo ou correção manual):')
    Array.from(pending.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, n]) => console.log(`   ${String(n).padStart(4)}×  ${name}`))
  }

  if (!apply) {
    console.log('\n(dry-run) Rode com --apply para gravar clientCoreId + nome canônico.')
    return
  }

  // 4) Aplicar
  console.log('\n✍️  Aplicando...')
  let updated = 0
  for (const [name, entry] of matchedByName) {
    const canonical = (entry.client.common_name ?? '').trim() !== '' ? entry.client.common_name! : entry.client.name
    for (const issue of entry.issues) {
      await writeClient.updateDoc(tracker.class.Issue, (issue as any).space, issue._id, {
        clientCoreId: entry.client.id,
        clientName: canonical
      } as any)
      updated++
      await new Promise((r) => setTimeout(r, 120))
    }
    console.log(`   ✅ "${name}" → #${entry.client.id} "${canonical}" (${entry.issues.length} issues)`)
  }
  console.log(`\n🎉 ${updated} issues vinculadas. As sub-issues são atualizadas pelo trigger.`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
