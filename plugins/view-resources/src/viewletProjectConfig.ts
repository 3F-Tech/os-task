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

// 3F — Per-project column config override stored in localStorage.
// Sits at the top of the resolution chain in front of ViewletProjectDefault (DB, shared)
// and ViewletPreference (DB, workspace-wide, user-scoped). When a user modifies columns
// inside a project, a full snapshot is written here so changes in project A do not bleed
// into project B.

import type { Ref, Space } from '@hcengineering/core'
import type { BuildModelKey, Viewlet } from '@hcengineering/view'
import { get, writable } from 'svelte/store'

type ProjectScopedConfig = Array<string | BuildModelKey>

const STORAGE_PREFIX = 'viewletConfig:'

function makeKey (viewletId: Ref<Viewlet>, project: Ref<Space>): string {
  return `${STORAGE_PREFIX}${viewletId}:${project}`
}

function loadAll (): Map<string, ProjectScopedConfig> {
  const result = new Map<string, ProjectScopedConfig>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key === null || !key.startsWith(STORAGE_PREFIX)) continue
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    try {
      result.set(key, JSON.parse(raw) as ProjectScopedConfig)
    } catch {
      // corrupted entry — drop silently
    }
  }
  return result
}

export const viewletProjectConfigStore = writable<Map<string, ProjectScopedConfig>>(loadAll())

export function getProjectScopedConfig (
  viewletId: Ref<Viewlet>,
  project: Ref<Space>
): ProjectScopedConfig | undefined {
  return get(viewletProjectConfigStore).get(makeKey(viewletId, project))
}

export function setProjectScopedConfig (
  viewletId: Ref<Viewlet>,
  project: Ref<Space>,
  config: ProjectScopedConfig
): void {
  const key = makeKey(viewletId, project)
  localStorage.setItem(key, JSON.stringify(config))
  const map = get(viewletProjectConfigStore)
  map.set(key, config)
  viewletProjectConfigStore.set(map)
}

export function clearProjectScopedConfig (viewletId: Ref<Viewlet>, project: Ref<Space>): void {
  const key = makeKey(viewletId, project)
  localStorage.removeItem(key)
  const map = get(viewletProjectConfigStore)
  map.delete(key)
  viewletProjectConfigStore.set(map)
}

export function hasProjectScopedConfig (viewletId: Ref<Viewlet>, project: Ref<Space>): boolean {
  return get(viewletProjectConfigStore).has(makeKey(viewletId, project))
}
