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
