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

import { concatLink } from '@hcengineering/core'
import login from '@hcengineering/login'
import { getMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import BirthdayPromptPopup from './components/BirthdayPromptPopup.svelte'

// Categoria própria: o modal só é fechado programaticamente (após salvar) via
// closePopup(CATEGORY); os closePopup() genéricos da navegação não o afetam.
export const BIRTHDAY_PROMPT_POPUP_CATEGORY = 'birthdayPrompt'

interface BirthdayState {
  found: boolean
  hasBirthday: boolean
  birthDate: string | null
}

// `shown`: marca que o popup já foi exibido (não reexibir). `inFlight`: dedupe
// de chamadas concorrentes (o onMount do Workbench pode disparar em re-render).
// O estado real de "preenchido" mora na 3F Core — sem localStorage, some sozinho
// quando gravado. Não marcamos nada como "avaliado" em falha: assim uma falha
// transitória no primeiro load (token ainda não populado, Core fria) é retentada.
let shown = false
let inFlight: Promise<void> | undefined

async function delay (ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function accountEndpoint (): { url: string, token: string } | undefined {
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  const token = getMetadata(presentation.metadata.Token)
  if (accountsUrl == null || accountsUrl === '' || token == null || token === '') return undefined
  return { url: accountsUrl, token }
}

async function fetchBirthdayState (): Promise<BirthdayState | undefined> {
  const ep = accountEndpoint()
  if (ep === undefined) return undefined
  try {
    const res = await fetch(concatLink(ep.url, '/api/v1/me/birthday'), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + ep.token }
    })
    if (!res.ok) return undefined
    const body: any = await res.json()
    return body?.data as BirthdayState
  } catch {
    return undefined
  }
}

/**
 * Envia o aniversário (`YYYY-MM-DD`) para a 3F Core via account. Lança em falha
 * para o componente exibir o erro e manter o modal aberto.
 * @public
 */
export async function submitBirthday (birthDate: string): Promise<void> {
  const ep = accountEndpoint()
  if (ep === undefined) throw new Error('Accounts URL ou token indisponível')
  const res = await fetch(concatLink(ep.url, '/api/v1/me/birthday'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ep.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ birthDate })
  })
  if (!res.ok) {
    throw new Error(`birthday POST HTTP ${res.status}`)
  }
}

function showBirthdayPrompt (): void {
  showPopup(BirthdayPromptPopup, {}, undefined, undefined, undefined, {
    category: BIRTHDAY_PROMPT_POPUP_CATEGORY,
    overlay: true,
    fixed: true
  })
}

/**
 * Se o usuário logado não tem aniversário preenchido na 3F Core, mostra o modal
 * (bloqueante) pedindo para preencher. Fail-safe por design: qualquer
 * erro/indisponibilidade (Core fora, token ausente, usuário não encontrado) →
 * não mostra nada, não trava o acesso. Idempotente por sessão.
 * @public
 */
async function evaluateBirthday (): Promise<void> {
  if (shown) return
  // Retenta em falha transitória. A detecção falhar (state === undefined) NÃO
  // consome a tentativa: no primeiro login o token pode ainda não estar em
  // metadata quando o Workbench monta, e a 1ª chamada à Core (fria) pode
  // demorar. Com resposta definitiva (found true/false), encerra.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const state = await fetchBirthdayState()
    if (state !== undefined) {
      if (state.found && !state.hasBirthday && !shown) {
        shown = true
        showBirthdayPrompt()
      }
      return
    }
    if (attempt < 3) await delay(attempt * 1500)
  }
}

/**
 * Se o usuário logado não tem aniversário preenchido na 3F Core, mostra o modal
 * (bloqueante) pedindo para preencher. Fail-safe: após 3 tentativas sem resposta
 * (Core fora, token ausente) → não mostra nada, não trava o acesso. Idempotente:
 * dedupe por `inFlight`, e nunca reexibe depois de mostrado (`shown`).
 * @public
 */
export async function showBirthdayPromptOnce (): Promise<void> {
  if (shown) return
  if (inFlight === undefined) {
    inFlight = evaluateBirthday().finally(() => {
      inFlight = undefined
    })
  }
  await inFlight
}
