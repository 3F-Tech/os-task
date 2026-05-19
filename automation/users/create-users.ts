import { getClient } from '@hcengineering/account-client'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, '..', '.env') })

// AccountRole.User = 2
const USER_ROLE = 2 as any

interface UserEntry {
  first: string
  last: string
  email: string
}

function parseCSV (filePath: string): UserEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  const users: UserEntry[] = []

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    const first = parts[0]?.trim() ?? ''
    const last = parts[1]?.trim() ?? ''
    const email = parts[2]?.trim() ?? ''
    if (!email || !first) continue
    users.push({ first, last, email })
  }

  return users
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function run (): Promise<void> {
  const { HUB_ACCOUNTS_URL, HUB_API_TOKEN, HUB_WORKSPACE_URL } = process.env

  if (!HUB_ACCOUNTS_URL || !HUB_API_TOKEN || !HUB_WORKSPACE_URL) {
    console.error('❌ Faltam variáveis no .env:')
    if (!HUB_ACCOUNTS_URL) console.error('   HUB_ACCOUNTS_URL  (ex: https://3ftasks.3fventure.tech:3333)')
    if (!HUB_WORKSPACE_URL) console.error('   HUB_WORKSPACE_URL (o slug do workspace na barra de endereço)')
    if (!HUB_API_TOKEN) console.error('   HUB_API_TOKEN')
    process.exit(1)
  }

  const defaultPassword = process.argv[2]
  if (!defaultPassword) {
    console.log('Uso: npm run create-users -- "SenhaPadrao123"')
    process.exit(1)
  }

  const csvPath = path.join(__dirname, 'users.csv')
  const users = parseCSV(csvPath)
  console.log(`\n📋 ${users.length} usuários encontrados no CSV\n`)

  const accountClient = getClient(HUB_ACCOUNTS_URL, HUB_API_TOKEN)

  // Cria um invite aberto com usos suficientes, expira em 2h
  const expMs = Date.now() + 2 * 60 * 60 * 1000
  const inviteId = await accountClient.createInvite(expMs, '', users.length + 10, USER_ROLE)
  console.log(`🔗 Invite criado: ${inviteId}\n`)

  let ok = 0
  let failed = 0

  for (const user of users) {
    try {
      await accountClient.signUpJoin(
        user.email,
        defaultPassword,
        user.first,
        user.last,
        inviteId,
        HUB_WORKSPACE_URL
      )
      console.log(`  ✅ ${user.first} ${user.last} <${user.email}>`)
      ok++
    } catch (err: any) {
      const msg = (err?.message ?? String(err)).replace(/\n/g, ' ').slice(0, 120)
      console.log(`  ❌ ${user.email} — ${msg}`)
      failed++
    }

    await sleep(300)
  }

  console.log(`\n🎉 Concluído: ${ok} criados, ${failed} falhas`)
}

run().catch(console.error)
