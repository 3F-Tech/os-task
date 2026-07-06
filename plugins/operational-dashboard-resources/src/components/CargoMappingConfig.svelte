<!--
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
-->
<script lang="ts">
  import core from '@hcengineering/core'
  import { Cargo, type DashboardSettings } from '@hcengineering/operational-dashboard'
  import { type IntlString, translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, themeStore } from '@hcengineering/ui'
  import { ensureOrgStructure, orgStore, refreshOrgStructure, seedCargoForPositionName } from '../orgStructure'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'

  void ensureOrgStructure()

  const canEdit = canEditDashboard()
  const client = getClient()

  // Override position(id 3F Core) → Cargo, guardado no singleton DashboardSettings.
  const settingsQuery = createQuery()
  let settings: DashboardSettings | undefined
  let overrideMap: Record<number, Cargo> = {}
  let seeded = false
  $: settingsQuery.query(operationalDashboard.class.DashboardSettings, {}, (res) => {
    settings = res[0]
    if (!seeded) {
      overrideMap = { ...(settings?.positionCargoMap ?? {}) }
      seeded = true
    }
  })

  $: positions = ($orgStore.indexes?.raw.positions ?? [])
    .filter((p) => p.is_active)
    .sort((a, b) => a.name.localeCompare(b.name))

  const CARGO_DEFS: Array<{ value: Cargo, label: IntlString }> = [
    { value: Cargo.Account, label: operationalDashboard.string.CargoAccount },
    { value: Cargo.GT, label: operationalDashboard.string.CargoGT },
    { value: Cargo.SocialMedia, label: operationalDashboard.string.CargoSocialMedia },
    { value: Cargo.Designer, label: operationalDashboard.string.CargoDesigner },
    { value: Cargo.Editor, label: operationalDashboard.string.CargoEditor },
    { value: Cargo.Coordinator, label: operationalDashboard.string.CargoCoordinator },
    { value: Cargo.QGLeader, label: operationalDashboard.string.CargoQGLeader }
  ]
  let cargoOptions: Array<{ value: Cargo, label: string }> = []
  $: void Promise.all(
    CARGO_DEFS.map(async (d) => ({ value: d.value, label: await translate(d.label, {}, $themeStore.language) }))
  ).then((res) => {
    cargoOptions = res
  })
  $: cargoLabel = new Map(cargoOptions.map((o) => [o.value, o.label]))

  // Cargo efetivo por position: override explícito vence; senão seed por nome.
  function seedOf (name: string): Cargo | undefined {
    return seedCargoForPositionName(name)
  }

  async function persist (next: Record<number, Cargo>): Promise<void> {
    if (!canEdit) return
    overrideMap = next
    const data = { positionCargoMap: next }
    if (settings == null) {
      await client.createDoc(
        operationalDashboard.class.DashboardSettings,
        core.space.Workspace,
        data,
        operationalDashboard.ids.DashboardSettings
      )
    } else {
      await client.updateDoc(operationalDashboard.class.DashboardSettings, settings.space, settings._id, data)
    }
    // Reaplica o override no store da org structure para as visões refletirem já.
    await refreshOrgStructure(next)
  }

  async function setCargo (positionId: number, value: string): Promise<void> {
    const next = { ...overrideMap }
    if (value === '') {
      // "automático": remove o override → volta a valer o seed por nome.
      delete next[positionId]
    } else {
      next[positionId] = value as Cargo
    }
    await persist(next)
  }
</script>

<div class="cargo-mapping">
  <h3><Label label={operationalDashboard.string.CargoMapping} /></h3>
  <div class="hint"><Label label={operationalDashboard.string.CargoMappingHint} /></div>

  {#if $orgStore.status === 'loading'}
    <div class="empty"><Label label={operationalDashboard.string.OrgLoading} /></div>
  {:else if $orgStore.status === 'error'}
    <div class="empty err"><Label label={operationalDashboard.string.OrgError} /> — {$orgStore.error}</div>
  {:else if positions.length === 0}
    <div class="empty"><Label label={operationalDashboard.string.NoCargo} /></div>
  {:else}
    <div class="rows">
      {#each positions as p (p.id)}
        {@const ov = overrideMap[p.id]}
        {@const seed = seedOf(p.name)}
        <div class="row">
          <div class="pos-name">{p.name}</div>
          <div class="pick">
            <select
              value={ov ?? ''}
              disabled={!canEdit}
              on:change={(e) => {
                void setCargo(p.id, e.currentTarget.value)
              }}
            >
              <option value="">
                {#if seed != null}
                  {cargoLabel.get(seed) ?? seed} ·
                {/if}
              </option>
              {#each cargoOptions as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
            {#if ov == null}
              <span class="auto"><Label label={operationalDashboard.string.AutoSeeded} /></span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .cargo-mapping {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;

    h3 {
      margin: 0;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--theme-dark-color);
      font-weight: 500;
    }
  }

  .hint {
    color: var(--theme-content-color);
    font-size: 0.8125rem;
    margin-bottom: 0.25rem;
  }

  .empty {
    padding: 1rem;
    text-align: center;
    color: var(--theme-dark-color);

    &.err {
      color: var(--theme-error-color, #c4314b);
    }
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .pos-name {
    color: var(--theme-caption-color);
    font-size: 0.9375rem;
    min-width: 0;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .auto {
    font-size: 0.6875rem;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  select {
    min-width: 12rem;
    padding: 0.375rem 0.5rem;
    background: var(--theme-button-bg);
    color: var(--theme-content-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;

    option {
      background: var(--theme-popup-color);
      color: var(--theme-content-color);
    }
  }
</style>
