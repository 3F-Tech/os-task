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
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import { computeGreen, emptyGreenResult, type GreenResult } from '../metricsGreen'
  import { orgStore } from '../orgStructure'
  import operationalDashboard from '../plugin'
  import {
    dashboardFilters,
    markRefreshDone,
    markRefreshFailed,
    refreshState,
    refreshTrigger,
    type DashboardFilters as Filters
  } from '../stores'
  import DashboardFilters from './DashboardFilters.svelte'
  import DateRangePicker from './DateRangePicker.svelte'
  import EfficiencyScatter from './EfficiencyScatter.svelte'

  const client = getClient()

  // Org structure do 3F Core (squad/cargo).
  $: idx = $orgStore.indexes

  let green: GreenResult = emptyGreenResult()
  let isLoading = false
  let pendingToken = 0

  $: $refreshTrigger, idx, void load($dashboardFilters)

  async function load (filters: Filters): Promise<void> {
    const token = ++pendingToken
    if (idx == null) {
      isLoading = false
      return
    }
    if (filters.buId === '') {
      green = emptyGreenResult()
      isLoading = false
      refreshState.set('idle')
      return
    }
    isLoading = true
    refreshState.set('loading')
    try {
      const result = await computeGreen(client, filters, idx)
      if (token === pendingToken) {
        green = result
        markRefreshDone()
      }
    } catch (e) {
      console.error('[operational-dashboard] green metrics computation failed', e)
      if (token === pendingToken) markRefreshFailed()
    } finally {
      if (token === pendingToken) isLoading = false
    }
  }
</script>

<div class="efficiency-view">
  <div class="filters-row">
    <DashboardFilters hideClientStage />
    <DateRangePicker />
  </div>

  {#if $dashboardFilters.buId === ''}
    <div class="empty-state">
      <Label label={operationalDashboard.string.SelectBUFirst} />
    </div>
  {:else}
    <div class:loading={isLoading}>
      <EfficiencyScatter
        rows={green.efficiencyRows}
        target={green.onTimeTarget}
        wipLow={green.wipLow}
        wipHigh={green.wipHigh}
      />
    </div>
  {/if}
</div>

<style lang="scss">
  .efficiency-view {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .filters-row {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .loading {
    opacity: 0.6;
    transition: opacity 0.15s ease;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.5rem;
    color: var(--theme-dark-color);
    font-size: 0.95rem;
    text-align: center;
  }
</style>
