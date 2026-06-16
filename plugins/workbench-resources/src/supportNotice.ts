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

import { getCurrentResolvedLocation, navigate, showPopup } from '@hcengineering/ui'
import SupportNoticePopup from './components/SupportNoticePopup.svelte'

// Bump this version to re-show the support notice to every user after an update.
const SUPPORT_NOTICE_VERSION = 2

// Categoria própria do popup: permite fechá-lo explicitamente sem ser afetado
// pelos closePopup() genéricos disparados pela navegação (doSyncLoc no Workbench).
export const SUPPORT_NOTICE_POPUP_CATEGORY = 'supportNotice'

// Project de suporte (Tracker) — alvo do botão "Abrir suporte no 3ftasks".
// Corresponde a: /workbench/fventure/tracker/6a088eecb84b623fdfa0af2f/issues
const SUPPORT_WORKSPACE = 'fventure'
const SUPPORT_APP = 'tracker'
const SUPPORT_PROJECT = '6a088eecb84b623fdfa0af2f'
const SUPPORT_SPECIAL = 'issues'

function storageKey (accountUuid: string): string {
  return `3f.supportNotice.seen.v${SUPPORT_NOTICE_VERSION}.${accountUuid}`
}

export function hasSeenSupportNotice (accountUuid: string): boolean {
  try {
    return localStorage.getItem(storageKey(accountUuid)) === '1'
  } catch {
    return false
  }
}

export function markSupportNoticeSeen (accountUuid: string): void {
  try {
    localStorage.setItem(storageKey(accountUuid), '1')
  } catch {
    /* localStorage indisponível — ignora */
  }
}

/** Navega para o projeto de suporte no Tracker (mesma SPA, sem reload). */
export function openSupportProject (): void {
  const loc = getCurrentResolvedLocation()
  navigate({
    path: [loc.path[0], SUPPORT_WORKSPACE, SUPPORT_APP, SUPPORT_PROJECT, SUPPORT_SPECIAL],
    fragment: undefined,
    query: undefined
  })
}

/** Exibe o popup de aviso de suporte (centralizado).
 *  fixed: true → não é fechado pelos closePopup() genéricos da navegação. */
export function showSupportNotice (): void {
  showPopup(SupportNoticePopup, {}, undefined, undefined, undefined, {
    category: SUPPORT_NOTICE_POPUP_CATEGORY,
    overlay: true,
    fixed: true
  })
}

/** Exibe o popup apenas se o usuário ainda não viu nesta versão; marca como visto.
 *  Exibe ANTES de marcar para não suprimir permanentemente caso o show falhe. */
export function showSupportNoticeOnce (accountUuid: string): void {
  if (hasSeenSupportNotice(accountUuid)) return
  showSupportNotice()
  markSupportNoticeSeen(accountUuid)
}
