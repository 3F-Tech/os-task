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

import { type Person, type SocialIdentity } from '@hcengineering/contact'
import contact from '@hcengineering/contact'
import { concatLink, type Ref, SocialIdType } from '@hcengineering/core'
import { Cargo, type Team } from '@hcengineering/operational-dashboard'
import { getMetadata } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import login from '@hcengineering/login'
import presentation from '@hcengineering/presentation'
import { get, writable } from 'svelte/store'

// ──────────────────────────────────────────────────────────────────────────
// Tipos da org structure (espelham o proxy GET /api/v1/org-structure do account).
// O front lê BU/squad/cargo da 3F Core ao vivo — nada de cadastro local.
// ──────────────────────────────────────────────────────────────────────────

/** @public */
export interface CoreBu {
  id: number
  name: string
  slug: string
  parent_id: number | null
  primary_color_hex: string | null
  secondary_color_hex: string | null
  is_active: boolean
}

/** @public */
export interface CoreSquad {
  id: number
  name: string
  leader_id: number | null
  bu_id: number | null
  is_active: boolean
}

/** @public */
export interface CoreUserBu {
  id: number
  name?: string
  slug?: string
  from_squad: boolean
}

/** @public */
export interface CoreUser {
  id: number
  name: string
  email: string
  is_active: boolean
  department_id: number | null
  position_id: number | null
  band_id: number | null
  squad_id: number | null
  bus: CoreUserBu[]
}

/** @public */
export interface CoreNamed {
  id: number
  name: string
  is_active: boolean
}

/** @public */
export interface CoreBand {
  id: number
  name: string
  color_hex: string | null
  sort_order: number
  is_active: boolean
}

/** @public */
export interface OrgStructure {
  bus: CoreBu[]
  squads: CoreSquad[]
  users: CoreUser[]
  positions: CoreNamed[]
  departments: CoreNamed[]
  bands: CoreBand[]
  fetchedAt: number
}

/**
 * Índices derivados, prontos pro consumo das métricas/componentes. O join
 * Core↔Huly é por email: `user.email` (3F Core) → `Ref<Person>` (Huly), via
 * `contact.class.SocialIdentity` tipo EMAIL.
 * @public
 */
export interface OrgIndexes {
  raw: OrgStructure
  // BUs
  busList: CoreBu[]
  buById: Map<number, CoreBu>
  // squads
  squadById: Map<number, CoreSquad>
  squadsByLeaderPersonRef: Map<Ref<Person>, CoreSquad[]>
  memberRefsBySquadId: Map<number, Array<Ref<Person>>>
  // users / join
  usersById: Map<number, CoreUser>
  personByEmail: Map<string, Ref<Person>>
  coreUserByPersonRef: Map<Ref<Person>, CoreUser>
  personRefByCoreUserId: Map<number, Ref<Person>>
  // cargo
  positionById: Map<number, CoreNamed>
  cargoByPersonRef: Map<Ref<Person>, Cargo>
  // diagnóstico do join (users do Core cujo email não casou com nenhuma Person)
  unmatchedEmails: string[]
  matchedCount: number
  totalActiveUsers: number
}

/** @public */
export interface OrgState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  indexes?: OrgIndexes
  error?: string
}

/** Store global da org structure. @public */
export const orgStore = writable<OrgState>({ status: 'idle' })

let inFlight: Promise<void> | undefined

function normalize (s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Seed automático cargo ← nome do `position` da 3F Core. Os nomes batem hoje
 * ("Account/Especialista", "Gestor de Tráfego"…). Um override explícito
 * (positionId → Cargo, salvo no DashboardSettings) sempre vence isto.
 */
export function seedCargoForPositionName (name: string): Cargo | undefined {
  const n = normalize(name)
  // Conservador de propósito: só mapeia nomes de alta confiança. O resto fica
  // sem cargo (não aparece nas visões por-cargo) até o admin ajustar o override.
  if (n.includes('account')) return Cargo.Account
  if (n.includes('trafego') || n === 'gt') return Cargo.GT
  if (n.includes('social')) return Cargo.SocialMedia
  if (n.includes('design')) return Cargo.Designer
  if (n.includes('editor') || n.includes('video')) return Cargo.Editor
  if (n.includes('coorden')) return Cargo.Coordinator
  if (n.includes('qg')) return Cargo.QGLeader
  return undefined
}

async function fetchOrgStructureRaw (): Promise<OrgStructure> {
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  const token = getMetadata(presentation.metadata.Token)
  if (accountsUrl == null || accountsUrl === '' || token == null || token === '') {
    throw new Error('Accounts URL ou token indisponível')
  }
  const res = await fetch(concatLink(accountsUrl, '/api/v1/org-structure'), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token }
  })
  if (!res.ok) {
    throw new Error(`org-structure HTTP ${res.status}`)
  }
  const body: any = await res.json()
  return body?.data as OrgStructure
}

/** Monta `email → Ref<Person>` a partir das SocialIdentity tipo EMAIL do workspace. */
async function buildPersonByEmail (): Promise<Map<string, Ref<Person>>> {
  const client = getClient()
  const ids = await client.findAll(contact.class.SocialIdentity, { type: SocialIdType.EMAIL })
  const map = new Map<string, Ref<Person>>()
  for (const sid of ids as SocialIdentity[]) {
    if (sid.value == null || sid.value === '') continue
    map.set(normalize(sid.value), sid.attachedTo)
  }
  return map
}

function buildIndexes (
  raw: OrgStructure,
  personByEmail: Map<string, Ref<Person>>,
  positionCargoOverride?: Record<number, Cargo>
): OrgIndexes {
  const buById = new Map<number, CoreBu>()
  for (const b of raw.bus) buById.set(b.id, b)

  const squadById = new Map<number, CoreSquad>()
  for (const s of raw.squads) squadById.set(s.id, s)

  const usersById = new Map<number, CoreUser>()
  for (const u of raw.users) usersById.set(u.id, u)

  const positionById = new Map<number, CoreNamed>()
  for (const p of raw.positions) positionById.set(p.id, p)

  // cargo por positionId: override explícito vence; senão seed por nome.
  const cargoByPositionId = new Map<number, Cargo>()
  for (const p of raw.positions) {
    const override = positionCargoOverride?.[p.id]
    const cargo = override ?? seedCargoForPositionName(p.name)
    if (cargo !== undefined) cargoByPositionId.set(p.id, cargo)
  }

  // join Core user → Person
  const coreUserByPersonRef = new Map<Ref<Person>, CoreUser>()
  const personRefByCoreUserId = new Map<number, Ref<Person>>()
  const cargoByPersonRef = new Map<Ref<Person>, Cargo>()
  const unmatchedEmails: string[] = []
  let matchedCount = 0
  let totalActiveUsers = 0

  for (const u of raw.users) {
    if (u.is_active) totalActiveUsers++
    const personRef = u.email != null ? personByEmail.get(normalize(u.email)) : undefined
    if (personRef === undefined) {
      if (u.is_active) unmatchedEmails.push(u.email)
      continue
    }
    if (u.is_active) matchedCount++
    coreUserByPersonRef.set(personRef, u)
    personRefByCoreUserId.set(u.id, personRef)
    if (u.position_id != null) {
      const cargo = cargoByPositionId.get(u.position_id)
      if (cargo !== undefined) cargoByPersonRef.set(personRef, cargo)
    }
  }

  // squads por líder (Person) e membros (Person) — derivados via o join acima.
  const squadsByLeaderPersonRef = new Map<Ref<Person>, CoreSquad[]>()
  for (const s of raw.squads) {
    if (s.leader_id == null) continue
    const leaderRef = personRefByCoreUserId.get(s.leader_id)
    if (leaderRef === undefined) continue
    const list = squadsByLeaderPersonRef.get(leaderRef) ?? []
    list.push(s)
    squadsByLeaderPersonRef.set(leaderRef, list)
  }

  const memberRefsBySquadId = new Map<number, Array<Ref<Person>>>()
  for (const u of raw.users) {
    if (u.squad_id == null) continue
    const ref = personRefByCoreUserId.get(u.id)
    if (ref === undefined) continue
    const list = memberRefsBySquadId.get(u.squad_id) ?? []
    list.push(ref)
    memberRefsBySquadId.set(u.squad_id, list)
  }

  return {
    raw,
    busList: raw.bus,
    buById,
    squadById,
    squadsByLeaderPersonRef,
    memberRefsBySquadId,
    usersById,
    personByEmail,
    coreUserByPersonRef,
    personRefByCoreUserId,
    positionById,
    cargoByPersonRef,
    unmatchedEmails,
    matchedCount,
    totalActiveUsers
  }
}

/**
 * (Re)carrega a org structure do proxy + reconstrói os índices. Plugado no
 * botão Refresh da dash. `positionCargoOverride` vem do DashboardSettings.
 * @public
 */
export async function refreshOrgStructure (positionCargoOverride?: Record<number, Cargo>): Promise<void> {
  orgStore.update((s) => ({ ...s, status: 'loading' }))
  try {
    const [raw, personByEmail] = await Promise.all([fetchOrgStructureRaw(), buildPersonByEmail()])
    const indexes = buildIndexes(raw, personByEmail, positionCargoOverride)
    orgStore.set({ status: 'ready', indexes })
  } catch (err: any) {
    orgStore.set({ status: 'error', error: err?.message ?? String(err) })
  }
}

/** Carrega uma vez se ainda não foi (idempotente). @public */
export async function ensureOrgStructure (positionCargoOverride?: Record<number, Cargo>): Promise<void> {
  const status = get(orgStore).status
  if (status === 'ready' || status === 'loading') return
  if (inFlight === undefined) {
    inFlight = refreshOrgStructure(positionCargoOverride).finally(() => {
      inFlight = undefined
    })
  }
  await inFlight
}

/**
 * Converte os squads do Core em objetos "Team-like" que as métricas consomem
 * (`_id`, `name`, `archived`, `members[].person`). `_id` = id do squad como
 * string; o líder recebe role 'leader'. Substitui a antiga query de Team local.
 * @public
 */
export function squadsAsTeams (idx: OrgIndexes): Team[] {
  return idx.raw.squads.map((s) => {
    const memberRefs = idx.memberRefsBySquadId.get(s.id) ?? []
    const leaderRef = s.leader_id != null ? idx.personRefByCoreUserId.get(s.leader_id) : undefined
    return {
      _id: String(s.id),
      name: s.name,
      color: (s.id % 10) + 1,
      archived: !s.is_active,
      members: memberRefs.map((person) => ({ person, role: person === leaderRef ? 'leader' : 'member' }))
    } as unknown as Team
  })
}
