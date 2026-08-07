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
import { concatLink, type MeasureContext } from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'

import { accountPlugin } from './plugin'

/**
 * Minimal shape of the user returned by `POST /auth/validate` (3F Core API).
 * Only the fields we actually consume are typed; the response carries more.
 * @public
 */
export interface ThreeFCoreUser {
  id: number
  name: string
  email: string
  role: string
  is_active: boolean
}

/**
 * Result of delegating a password check to the 3F Core universal login.
 * @public
 */
export type ThreeFCoreValidateResult =
  | { ok: true, user: ThreeFCoreUser }
  | { ok: false, code: 'INVALID_CREDENTIALS' | 'NO_SYSTEM_ACCESS' | 'ACCOUNT_INACTIVE' | 'SERVICE_UNAVAILABLE' }

const REQUEST_TIMEOUT_MS = 5000
const MAX_ATTEMPTS = 3

/**
 * Whether universal login delegation to the 3F Core API is enabled.
 * @public
 */
export function is3FCoreEnabled (): boolean {
  return getMetadata(accountPlugin.metadata.ThreeFCoreEnabled) === true
}

async function delay (ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Validates an email/password pair against the 3F Core API (`POST /auth/validate`),
 * scoped to the system that owns the configured API Key.
 *
 * Network/5xx/429 failures are retried with a small backoff and ultimately
 * surface as `SERVICE_UNAVAILABLE` (fail-closed: callers must refuse the login).
 * @public
 */
export async function validate3FCore (
  ctx: MeasureContext,
  email: string,
  password: string
): Promise<ThreeFCoreValidateResult> {
  const baseUrl = getMetadata(accountPlugin.metadata.ThreeFCoreUrl)
  const apiKey = getMetadata(accountPlugin.metadata.ThreeFCoreApiKey)

  if (baseUrl == null || baseUrl === '' || apiKey == null || apiKey === '') {
    ctx.error('3F Core login enabled but URL/API key not configured')
    return { ok: false, code: 'SERVICE_UNAVAILABLE' }
  }

  const url = concatLink(baseUrl, '/auth/validate')
  let lastError: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ email, password }),
        signal: controller.signal
      })

      if (res.status === 200) {
        const body: any = await res.json()
        return { ok: true, user: body?.data as ThreeFCoreUser }
      }

      if (res.status === 401) {
        // e-mail inexistente ou senha errada
        return { ok: false, code: 'INVALID_CREDENTIALS' }
      }

      if (res.status === 403) {
        const body: any = await res.json().catch(() => ({}))
        if (body?.error?.code === 'ACCOUNT_INACTIVE') {
          return { ok: false, code: 'ACCOUNT_INACTIVE' }
        }
        // NO_SYSTEM_ACCESS / SYSTEM_INACTIVE / FORBIDDEN
        return { ok: false, code: 'NO_SYSTEM_ACCESS' }
      }

      if (res.status === 429 || res.status >= 500) {
        // transient — retry with backoff
        lastError = `status ${res.status}`
        await delay(attempt * 500)
        continue
      }

      // Any other 4xx (e.g. 400 validation) won't be fixed by retrying.
      ctx.warn('3F Core /auth/validate unexpected status', { status: res.status })
      return { ok: false, code: 'INVALID_CREDENTIALS' }
    } catch (err: any) {
      // network error / timeout (abort) — retry
      lastError = err?.message ?? String(err)
      await delay(attempt * 500)
    } finally {
      clearTimeout(timer)
    }
  }

  ctx.error('3F Core /auth/validate failed after retries', { error: lastError })
  return { ok: false, code: 'SERVICE_UNAVAILABLE' }
}

// ──────────────────────────────────────────────────────────────────────────
// Org structure (read-through) — usado pelo Painel Operacional via proxy.
//
// A dash lê BU/squad/cargo direto da 3F Core. O browser não pode segurar a
// API Key, então o `account` (que já a tem) expõe um proxy autenticado por
// token Huly. Aqui só buscamos e enxugamos os dados (PII fora — nada de cpf,
// cnpj, endereço, telefone trafega pro front).
// ──────────────────────────────────────────────────────────────────────────

/** BU da 3F Core (enxuta). @public */
export interface CoreBu {
  id: number
  name: string
  slug: string
  parent_id: number | null
  primary_color_hex: string | null
  secondary_color_hex: string | null
  is_active: boolean
}

/** Squad da 3F Core (enxuto). @public */
export interface CoreSquad {
  id: number
  name: string
  leader_id: number | null
  bu_id: number | null
  is_active: boolean
}

/** Vínculo user↔BU embutido no user. @public */
export interface CoreUserBu {
  id: number
  name?: string
  slug?: string
  from_squad: boolean
}

/** Usuário da 3F Core (enxuto, sem PII). @public */
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

/** Cargo (`position`) ou departamento (`department`) da 3F Core. @public */
export interface CoreNamed {
  id: number
  name: string
  is_active: boolean
}

/** Band/faixa da 3F Core. @public */
export interface CoreBand {
  id: number
  name: string
  color_hex: string | null
  sort_order: number
  is_active: boolean
}

/** Estrutura organizacional agregada devolvida pelo proxy. @public */
export interface OrgStructure {
  bus: CoreBu[]
  squads: CoreSquad[]
  users: CoreUser[]
  positions: CoreNamed[]
  departments: CoreNamed[]
  bands: CoreBand[]
  fetchedAt: number
}

const ORG_CACHE_TTL_MS = 60_000
const ORG_PER_PAGE = 100
const ORG_MAX_PAGES = 200 // trava de segurança (até 20k itens por recurso)
// Timeout próprio (maior que o do /auth/validate): a agregação não é hot path
// e o /users do Core chega a ~3.5s por página; 5s estoura sob concorrência.
const ORG_REQUEST_TIMEOUT_MS = 20_000

let orgCache: OrgStructure | undefined

async function coreGetPage (baseUrl: string, apiKey: string, path: string): Promise<{ data: any[], total: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, ORG_REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(concatLink(baseUrl, path), {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      signal: controller.signal
    })
    if (res.status !== 200) {
      throw new Error(`3F Core GET ${path} → status ${res.status}`)
    }
    const body: any = await res.json()
    const data: any[] = Array.isArray(body?.data) ? body.data : []
    const total: number = typeof body?.meta?.total === 'number' ? body.meta.total : data.length
    return { data, total }
  } finally {
    clearTimeout(timer)
  }
}

async function coreGetAll (baseUrl: string, apiKey: string, resource: string): Promise<any[]> {
  const acc: any[] = []
  for (let page = 1; page <= ORG_MAX_PAGES; page++) {
    const { data, total } = await coreGetPage(baseUrl, apiKey, `${resource}?page=${page}&perPage=${ORG_PER_PAGE}`)
    acc.push(...data)
    if (data.length === 0 || acc.length >= total) break
  }
  return acc
}

/**
 * Busca e agrega a estrutura organizacional da 3F Core (BUs, squads, usuários,
 * cargos, departamentos, bands). Pagina internamente e cacheia ~60s in-memory.
 * Lança em falha de rede/config — o chamador (proxy) traduz pra 5xx.
 * @public
 */
export async function fetchOrgStructure (ctx: MeasureContext, force = false): Promise<OrgStructure> {
  if (!force && orgCache !== undefined && Date.now() - orgCache.fetchedAt < ORG_CACHE_TTL_MS) {
    return orgCache
  }

  const baseUrl = getMetadata(accountPlugin.metadata.ThreeFCoreUrl)
  const apiKey = getMetadata(accountPlugin.metadata.ThreeFCoreApiKey)
  if (baseUrl == null || baseUrl === '' || apiKey == null || apiKey === '') {
    ctx.error('org-structure requested but 3F Core URL/API key not configured')
    throw new Error('3F Core URL/API key not configured')
  }

  const [busRaw, squadsRaw, usersRaw, positionsRaw, departmentsRaw, bandsRaw] = await Promise.all([
    coreGetAll(baseUrl, apiKey, '/bus'),
    coreGetAll(baseUrl, apiKey, '/squads'),
    coreGetAll(baseUrl, apiKey, '/users'),
    coreGetAll(baseUrl, apiKey, '/positions'),
    coreGetAll(baseUrl, apiKey, '/departments'),
    coreGetAll(baseUrl, apiKey, '/bands')
  ])

  const data: OrgStructure = {
    bus: busRaw.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      parent_id: b.parent_id ?? null,
      primary_color_hex: b.primary_color_hex ?? null,
      secondary_color_hex: b.secondary_color_hex ?? null,
      is_active: b.is_active ?? true
    })),
    squads: squadsRaw.map((s) => ({
      id: s.id,
      name: s.name,
      leader_id: s.leader_id ?? null,
      bu_id: s.bu_id ?? null,
      is_active: s.is_active ?? true
    })),
    users: usersRaw.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      is_active: u.is_active ?? true,
      department_id: u.department_id ?? null,
      position_id: u.position_id ?? null,
      band_id: u.band_id ?? null,
      squad_id: u.squad_id ?? null,
      bus: Array.isArray(u.bus)
        ? u.bus.map((x: any) => ({ id: x.id, name: x.name, slug: x.slug, from_squad: x.from_squad === true }))
        : []
    })),
    positions: positionsRaw.map((p) => ({ id: p.id, name: p.name, is_active: p.is_active ?? true })),
    departments: departmentsRaw.map((d) => ({ id: d.id, name: d.name, is_active: d.is_active ?? true })),
    bands: bandsRaw.map((b) => ({
      id: b.id,
      name: b.name,
      color_hex: b.color_hex ?? null,
      sort_order: b.sort_order ?? 0,
      is_active: b.is_active ?? true
    })),
    fetchedAt: Date.now()
  }

  orgCache = data
  return data
}

// ──────────────────────────────────────────────────────────────────────────
// Clients (read-through) — usado pela feature F09 "Nome do cliente via Core".
//
// O seletor de cliente na Issue e a tela de acompanhamento em Configurações
// leem a lista de clientes direto da 3F Core (identidade canônica). Mesmo
// padrão da org-structure: proxy no account (a API Key fica server-side) e
// resposta enxuta SEM PII (nada de documento/cpf/cnpj/endereço/contato).
// ──────────────────────────────────────────────────────────────────────────

/** Cliente da 3F Core (enxuto, sem PII). @public */
export interface CoreClient {
  id: number
  /** Razão social / nome formal. */
  name: string
  /** Nome comum/apelido usado no dia a dia (pode faltar → null). */
  common_name: string | null
  /** Ciclo de vida comercial: active | aguardando_renovacao | em_cancelamento | churn | cancelado. */
  status: string
  is_active: boolean
}

const CLIENTS_CACHE_TTL_MS = 60_000
let clientsCache: CoreClient[] | undefined
let clientsCacheAt = 0

/**
 * Busca a lista de clientes da 3F Core (id, razão social, nome comum, status).
 * Pagina internamente (reusa coreGetAll) e cacheia ~60s in-memory. Exclui
 * registros soft-deleted (is_active=false); mantém todos os status comerciais
 * (inclusive churn/cancelado — o filtro por status é decisão do consumidor).
 * Lança em falha de rede/config — o proxy traduz pra 5xx.
 * @public
 */
export async function fetchCoreClients (ctx: MeasureContext, force = false): Promise<CoreClient[]> {
  if (!force && clientsCache !== undefined && Date.now() - clientsCacheAt < CLIENTS_CACHE_TTL_MS) {
    return clientsCache
  }

  const baseUrl = getMetadata(accountPlugin.metadata.ThreeFCoreUrl)
  const apiKey = getMetadata(accountPlugin.metadata.ThreeFCoreApiKey)
  if (baseUrl == null || baseUrl === '' || apiKey == null || apiKey === '') {
    ctx.error('clients requested but 3F Core URL/API key not configured')
    throw new Error('3F Core URL/API key not configured')
  }

  const raw = await coreGetAll(baseUrl, apiKey, '/clients')
  const data: CoreClient[] = raw
    .map((c) => ({
      id: c.id,
      name: c.name,
      common_name: c.common_name ?? null,
      status: typeof c.status === 'string' ? c.status : 'active',
      is_active: c.is_active ?? true
    }))
    .filter((c) => c.is_active && typeof c.id === 'number')

  clientsCache = data
  clientsCacheAt = Date.now()
  return data
}

// ──────────────────────────────────────────────────────────────────────────
// Profile completion (birth date) — usado pelo popup pós-login que pede o
// aniversário quando ele está vazio na 3F Core.
//
// Leitura: GET /users?q=<email> (scope users:read). Escrita: PATCH /users/:id
// { birth_date } (scope users:write — exige chave adm). A identidade é sempre
// resolvida server-side pelo email do token Huly, nunca vinda do browser.
// ──────────────────────────────────────────────────────────────────────────

/** Usuário da 3F Core reduzido ao necessário para o fluxo de aniversário. @public */
export interface CoreUserBirthday {
  id: number
  email: string
  /** `YYYY-MM-DD` ou `null` se ainda não preenchido. */
  birthDate: string | null
}

function normalizeCoreEmail (email: string): string {
  return email.trim().toLowerCase()
}

// Timeout próprio (maior que o 5s do /auth/validate): o /users do Core faz busca
// por `q` e pode chegar a ~3.5s por página — 5s estoura sob concorrência (mesmo
// motivo do ORG_REQUEST_TIMEOUT_MS acima). Vale para leitura e escrita do perfil.
const CORE_USERS_TIMEOUT_MS = 20_000

/**
 * Busca o usuário da 3F Core pelo email exato (case-insensitive). Usa o filtro
 * `q` do `/users` (que casa nome OU email) e confere a igualdade exata depois.
 * Retorna `undefined` se nenhum usuário casar. Lança em erro de rede/config/HTTP.
 * @public
 */
export async function getCoreUserByEmail (ctx: MeasureContext, email: string): Promise<CoreUserBirthday | undefined> {
  const baseUrl = getMetadata(accountPlugin.metadata.ThreeFCoreUrl)
  const apiKey = getMetadata(accountPlugin.metadata.ThreeFCoreApiKey)
  if (baseUrl == null || baseUrl === '' || apiKey == null || apiKey === '') {
    ctx.error('birthday lookup requested but 3F Core URL/API key not configured')
    throw new Error('3F Core URL/API key not configured')
  }

  const wanted = normalizeCoreEmail(email)
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, CORE_USERS_TIMEOUT_MS)
  try {
    const res = await fetch(concatLink(baseUrl, `/users?q=${encodeURIComponent(wanted)}&perPage=100`), {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      signal: controller.signal
    })
    if (res.status !== 200) {
      throw new Error(`3F Core GET /users → status ${res.status}`)
    }
    const body: any = await res.json()
    const data: any[] = Array.isArray(body?.data) ? body.data : []
    const match = data.find((u) => typeof u?.email === 'string' && normalizeCoreEmail(u.email) === wanted)
    if (match === undefined) return undefined
    const birthDate =
      typeof match.birth_date === 'string' && match.birth_date !== '' ? match.birth_date.slice(0, 10) : null
    return { id: match.id, email: match.email, birthDate }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Grava o `birth_date` (`YYYY-MM-DD`) do usuário na 3F Core via `PATCH /users/:id`.
 * Exige que a API Key configurada tenha o scope `users:write` (chave `adm`).
 * Lança em erro de rede/config/HTTP.
 * @public
 */
export async function setCoreUserBirthDate (ctx: MeasureContext, coreUserId: number, birthDate: string): Promise<void> {
  const baseUrl = getMetadata(accountPlugin.metadata.ThreeFCoreUrl)
  const apiKey = getMetadata(accountPlugin.metadata.ThreeFCoreApiKey)
  if (baseUrl == null || baseUrl === '' || apiKey == null || apiKey === '') {
    ctx.error('birthday write requested but 3F Core URL/API key not configured')
    throw new Error('3F Core URL/API key not configured')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, CORE_USERS_TIMEOUT_MS)
  try {
    const res = await fetch(concatLink(baseUrl, `/users/${coreUserId}`), {
      method: 'PATCH',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ birth_date: birthDate }),
      signal: controller.signal
    })
    if (res.status !== 200) {
      const detail = await res.text().catch(() => '')
      throw new Error(`3F Core PATCH /users/${coreUserId} → status ${res.status} ${detail}`)
    }
  } finally {
    clearTimeout(timer)
  }
}
