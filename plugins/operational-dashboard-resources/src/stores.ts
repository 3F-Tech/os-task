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

import { writable } from 'svelte/store'

export type DateRangePreset = 'week' | 'month' | 'last-month' | 'quarter' | 'custom'

export interface DashboardFilters {
  buId: string
  projectId: string
  clientStage: string
  teamId: string
  userId: string
  dateFrom: number
  dateTo: number
  preset: DateRangePreset
}

export function computeDateRange (preset: DateRangePreset): { from: number, to: number } {
  const now = new Date()
  const to = now.getTime()
  let from: number

  switch (preset) {
    case 'week': {
      const d = new Date(now)
      d.setDate(d.getDate() - 7)
      from = d.getTime()
      break
    }
    case 'month': {
      from = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      break
    }
    case 'last-month': {
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const startOfLastMonth = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() - 1, 1)
      const endOfLastMonth = new Date(firstOfThisMonth.getTime() - 1)
      return { from: startOfLastMonth.getTime(), to: endOfLastMonth.getTime() }
    }
    case 'quarter': {
      const d = new Date(now)
      d.setMonth(d.getMonth() - 3)
      from = d.getTime()
      break
    }
    case 'custom':
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  }

  return { from, to }
}

function getInitialFilters (): DashboardFilters {
  const { from, to } = computeDateRange('month')
  return {
    buId: '',
    projectId: '',
    clientStage: '',
    teamId: '',
    userId: '',
    dateFrom: from,
    dateTo: to,
    preset: 'month'
  }
}

export const dashboardFilters = writable<DashboardFilters>(getInitialFilters())

export type RefreshState = 'idle' | 'loading' | 'done'

export const refreshTrigger = writable<number>(0)
export const refreshState = writable<RefreshState>('idle')
export const lastRefreshedAt = writable<number | null>(null)

export const REFRESH_COOLDOWN_MS = 1500

/**
 * Pede uma nova execução do load. Só dispara se o estado atual for 'idle'
 * — durante 'loading' (em execução) ou 'done' (cooldown pós-sucesso),
 * o clique é ignorado.
 *
 * @returns true se o refresh foi disparado, false se foi bloqueado por cooldown.
 */
export function triggerRefresh (): boolean {
  let allowed = false
  refreshState.update((s) => {
    if (s === 'idle') {
      allowed = true
      return 'loading'
    }
    return s
  })
  if (allowed) refreshTrigger.update((n) => n + 1)
  return allowed
}

export function markRefreshDone (): void {
  lastRefreshedAt.set(Date.now())
  refreshState.set('done')
  setTimeout(() => {
    refreshState.update((s) => (s === 'done' ? 'idle' : s))
  }, REFRESH_COOLDOWN_MS)
}

export function markRefreshFailed (): void {
  refreshState.set('idle')
}

export function resetFilters (): void {
  dashboardFilters.set(getInitialFilters())
}

export function setPreset (preset: DateRangePreset): void {
  if (preset === 'custom') {
    dashboardFilters.update((f) => ({ ...f, preset }))
    return
  }
  const { from, to } = computeDateRange(preset)
  dashboardFilters.update((f) => ({ ...f, preset, dateFrom: from, dateTo: to }))
}
