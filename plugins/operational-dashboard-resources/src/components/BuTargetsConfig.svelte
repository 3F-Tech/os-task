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
  import { type BuDashboardSettings } from '@hcengineering/operational-dashboard'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Button, Label } from '@hcengineering/ui'
  import { ensureOrgStructure, orgStore } from '../orgStructure'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'

  void ensureOrgStructure()

  const canEdit = canEditDashboard()
  const client = getClient()

  interface Inputs {
    onTimeTarget?: number
    baselineHoursPerDay?: number
    capacityLowPct?: number
    capacityHighPct?: number
    wipLow?: number
    wipHigh?: number
  }

  // Metas por BU (BuDashboardSettings), indexadas pelo id da BU do 3F Core.
  const settingsQuery = createQuery()
  let byBu = new Map<number, BuDashboardSettings>()
  let settingsLoaded = false
  $: settingsQuery.query(operationalDashboard.class.BuDashboardSettings, {}, (res) => {
    byBu = new Map(res.map((d) => [d.coreBuId, d]))
    settingsLoaded = true
  })

  $: bus = ($orgStore.indexes?.busList ?? [])
    .filter((b) => b.is_active)
    .sort((a, b) => a.name.localeCompare(b.name))

  // Semeia os inputs de cada BU uma vez (após a query de settings emitir, para
  // não perder valores gravados que cheguem depois da lista de BUs).
  let inputs: Record<number, Inputs> = {}
  $: if (settingsLoaded) {
    let changed = false
    for (const b of bus) {
      if (inputs[b.id] === undefined) {
        const d = byBu.get(b.id)
        inputs[b.id] = {
          onTimeTarget: d?.onTimeTarget,
          baselineHoursPerDay: d?.baselineHoursPerDay,
          capacityLowPct: d?.capacityLowPct,
          capacityHighPct: d?.capacityHighPct,
          wipLow: d?.wipLow,
          wipHigh: d?.wipHigh
        }
        changed = true
      }
    }
    if (changed) inputs = inputs
  }

  const num = (v: number | undefined): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined

  async function save (buId: number): Promise<void> {
    if (!canEdit) return
    const v = inputs[buId] ?? {}
    const data = {
      coreBuId: buId,
      onTimeTarget: num(v.onTimeTarget),
      baselineHoursPerDay: num(v.baselineHoursPerDay),
      capacityLowPct: num(v.capacityLowPct),
      capacityHighPct: num(v.capacityHighPct),
      wipLow: num(v.wipLow),
      wipHigh: num(v.wipHigh)
    }
    const existing = byBu.get(buId)
    if (existing == null) {
      await client.createDoc(operationalDashboard.class.BuDashboardSettings, core.space.Workspace, data)
    } else {
      await client.updateDoc(operationalDashboard.class.BuDashboardSettings, existing.space, existing._id, data)
    }
  }
</script>

<div class="bu-targets">
  <h3><Label label={operationalDashboard.string.BuTargets} /></h3>
  <div class="hint"><Label label={operationalDashboard.string.BuTargetsHint} /></div>

  {#if $orgStore.status === 'loading'}
    <div class="empty"><Label label={operationalDashboard.string.OrgLoading} /></div>
  {:else if $orgStore.status === 'error'}
    <div class="empty err"><Label label={operationalDashboard.string.OrgError} /> — {$orgStore.error}</div>
  {:else if bus.length === 0}
    <div class="empty"><Label label={operationalDashboard.string.NoCoreBUs} /></div>
  {:else}
    <div class="bu-cards">
      {#each bus as bu (bu.id)}
        {#if inputs[bu.id] !== undefined}
          <div class="bu-card">
            <div class="bu-name">{bu.name}</div>
            <div class="targets-grid">
              <label class="target-item">
                <span><Label label={operationalDashboard.string.OnTimeTarget} /></span>
                <input type="number" min="0" max="100" bind:value={inputs[bu.id].onTimeTarget} disabled={!canEdit} />
              </label>
              <label class="target-item">
                <span><Label label={operationalDashboard.string.BaselineHoursPerDay} /></span>
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  bind:value={inputs[bu.id].baselineHoursPerDay}
                  disabled={!canEdit}
                />
              </label>
              <label class="target-item">
                <span><Label label={operationalDashboard.string.CapacityLowPct} /></span>
                <input type="number" min="0" max="100" bind:value={inputs[bu.id].capacityLowPct} disabled={!canEdit} />
              </label>
              <label class="target-item">
                <span><Label label={operationalDashboard.string.CapacityHighPct} /></span>
                <input type="number" min="0" max="100" bind:value={inputs[bu.id].capacityHighPct} disabled={!canEdit} />
              </label>
              <label class="target-item">
                <span><Label label={operationalDashboard.string.WipLow} /></span>
                <input type="number" min="0" max="50" bind:value={inputs[bu.id].wipLow} disabled={!canEdit} />
              </label>
              <label class="target-item">
                <span><Label label={operationalDashboard.string.WipHigh} /></span>
                <input type="number" min="0" max="50" bind:value={inputs[bu.id].wipHigh} disabled={!canEdit} />
              </label>
            </div>
            <div class="wip-hint"><Label label={operationalDashboard.string.WipThresholdsHint} /></div>
            {#if canEdit}
              <div class="bu-actions">
                <Button kind="primary" label={operationalDashboard.string.Save} on:click={() => save(bu.id)} />
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .bu-targets {
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

  .bu-cards {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .bu-card {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.75rem 0.875rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;

    .bu-name {
      font-weight: 500;
      color: var(--theme-caption-color);
    }

    .wip-hint {
      font-size: 0.75rem;
      color: var(--theme-dark-color);
    }
  }

  .targets-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 0.75rem;
  }

  .target-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    span {
      font-size: 0.8125rem;
      color: var(--theme-dark-color);
    }

    input {
      padding: 0.375rem 0.5rem;
      background: var(--theme-button-bg);
      color: var(--theme-content-color);
      border: 1px solid var(--theme-divider-color);
      border-radius: 0.375rem;
    }
  }

  .bu-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
