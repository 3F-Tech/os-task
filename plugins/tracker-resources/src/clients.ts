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

// ──────────────────────────────────────────────────────────────────────────
// Clientes da 3F Core (F09 "Nome do cliente via Core"). O front lê a lista de
// clientes ao vivo do proxy do account (GET /api/v1/clients) — a API Key fica
// server-side. Este store alimenta o ClientNameSelector e a tela de
// acompanhamento em Configurações. São poucos clientes (~centenas), então
// buscamos tudo uma vez e filtramos/buscamos client-side.
// ──────────────────────────────────────────────────────────────────────────

import { concatLink } from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'
import login from '@hcengineering/login'
import presentation from '@hcengineering/presentation'
import { SelectPopup, eventToHTMLElement, showPopup, type SelectPopupValueType } from '@hcengineering/ui'
import { get, writable } from 'svelte/store'
import ClientOption from './components/issues/ClientOption.svelte'

/** Cliente da 3F Core (espelha o proxy GET /api/v1/clients). @public */
export interface CoreClient {
  id: number
  /** Razão social / nome formal. */
  name: string
  /** Nome comum/apelido; pode faltar (null). */
  common_name: string | null
  /** active | aguardando_renovacao | em_cancelamento | churn | cancelado */
  status: string
  is_active: boolean
}

/** @public */
export interface ClientsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  clients: CoreClient[]
  byId: Map<number, CoreClient>
  error?: string
  fetchedAt?: number
}

/** Store global da lista de clientes da Core. @public */
export const clientsStore = writable<ClientsState>({ status: 'idle', clients: [], byId: new Map() })

let inFlight: Promise<void> | undefined

/** Rótulo amigável: nome comum quando existe, senão razão social. @public */
export function clientLabel (c: CoreClient): string {
  const cn = (c.common_name ?? '').trim()
  return cn.length > 0 ? cn : c.name
}

/** true se o cliente está em churn (status da Core). @public */
export function isChurn (c: CoreClient): boolean {
  return (c.status ?? '').toLowerCase() === 'churn'
}

/**
 * Monta os itens do SelectPopup para a lista de clientes. Renderiza cada item
 * com o ClientOption (rótulo + tag "churn" quando aplicável) e mantém `text`
 * preenchido para a busca client-side do popup continuar funcionando.
 * @public
 */
export function clientPopupItems (clients: CoreClient[], currentId?: number): SelectPopupValueType[] {
  return clients.map((c) => {
    const label = clientLabel(c)
    return {
      id: String(c.id),
      text: label,
      isSelected: currentId !== undefined && c.id === currentId,
      component: ClientOption,
      props: { label, churn: isChurn(c) }
    }
  })
}

/** Normaliza para comparação/busca: sem acento, minúsculo, trim. @public */
export function normalizeClient (s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

async function fetchClientsRaw (): Promise<CoreClient[]> {
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  const token = getMetadata(presentation.metadata.Token)
  if (accountsUrl == null || accountsUrl === '' || token == null || token === '') {
    throw new Error('Accounts URL ou token indisponível')
  }
  const res = await fetch(concatLink(accountsUrl, '/api/v1/clients'), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token }
  })
  if (!res.ok) {
    throw new Error(`clients HTTP ${res.status}`)
  }
  const body: any = await res.json()
  return Array.isArray(body?.data) ? (body.data as CoreClient[]) : []
}

async function load (): Promise<void> {
  clientsStore.update((s) => (s.clients.length > 0 ? s : { ...s, status: 'loading' }))
  try {
    const clients = await fetchClientsRaw()
    clients.sort((a, b) => clientLabel(a).localeCompare(clientLabel(b), 'pt-BR'))
    const byId = new Map<number, CoreClient>()
    for (const c of clients) byId.set(c.id, c)
    clientsStore.set({ status: 'ready', clients, byId, fetchedAt: Date.now() })
  } catch (err: any) {
    clientsStore.set({
      status: 'error',
      clients: [],
      byId: new Map(),
      error: err?.message ?? String(err)
    })
  }
}

/** Carrega a lista uma vez (idempotente); reusa a promise em voo. @public */
export async function ensureClients (): Promise<void> {
  const st = get(clientsStore)
  if (st.status === 'ready') return
  if (inFlight !== undefined) {
    await inFlight
    return
  }
  inFlight = load().finally(() => {
    inFlight = undefined
  })
  await inFlight
}

/** Força recarga da lista (ignora cache). @public */
export async function refreshClients (): Promise<void> {
  inFlight = load().finally(() => {
    inFlight = undefined
  })
  await inFlight
}

/**
 * Abre o seletor de clientes da Core (SelectPopup buscável) ancorado no evento e
 * chama `onSelect` com o cliente escolhido. Reaproveitado pelo ClientNameSelector
 * (formulário de criar/editar) e pelo ClientNamePresenter (edição inline na lista).
 * @public
 */
export function openClientPopup (
  event: MouseEvent,
  currentId: number | undefined,
  onSelect: (client: CoreClient) => void
): void {
  const state = get(clientsStore)
  if (state.status !== 'ready') {
    void ensureClients()
  }
  const items = clientPopupItems(state.clients, currentId)
  showPopup(SelectPopup, { value: items, searchable: true, width: 'large' }, eventToHTMLElement(event), (selectedId: string | null) => {
    if (selectedId == null) return
    const c = state.byId.get(Number(selectedId))
    if (c === undefined) return
    onSelect(c)
  })
}

/** Busca client-side por nome comum ou razão social (sem acento, substring). @public */
export function searchClients (clients: CoreClient[], q: string, limit = 50): CoreClient[] {
  const nq = normalizeClient(q)
  if (nq.length === 0) return clients.slice(0, limit)
  const out: CoreClient[] = []
  for (const c of clients) {
    const hay = normalizeClient(`${c.common_name ?? ''} ${c.name}`)
    if (hay.includes(nq)) {
      out.push(c)
      if (out.length >= limit) break
    }
  }
  return out
}
