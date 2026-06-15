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
  import { type Team } from '@hcengineering/operational-dashboard'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, showPopup } from '@hcengineering/ui'
  import { computeDashboard, type IssueRow, type MetricsResult, type TeamRankingRow } from '../metrics'
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
  import IssueListModal from './IssueListModal.svelte'
  import MetricCard from './MetricCard.svelte'
  import PersonWorkloadModal from './PersonWorkloadModal.svelte'
  import TeamRanking from './TeamRanking.svelte'

  const client = getClient()

  const teamsQuery = createQuery()
  let teams: Team[] = []
  $: teamsQuery.query(operationalDashboard.class.Team, { archived: false }, (res) => {
    teams = res
  })

  const loading: MetricsResult = {
    onTime: { value: '…', subtitle: '', tone: 'neutral', issues: [] },
    overdue: { value: '…', subtitle: '', tone: 'neutral', issues: [] },
    workload: { value: '…', subtitle: '', tone: 'neutral', issues: [] },
    cycleTime: { value: '…', subtitle: '', tone: 'neutral', issues: [] },
    approvedNoChanges: { value: '…', subtitle: '', tone: 'neutral', issues: [] },
    reworkCycles: { value: '…', subtitle: '', tone: 'neutral', issues: [] },
    waitingApproval: { value: '…', subtitle: '', tone: 'neutral', issues: [] }
  }

  let metrics: MetricsResult = loading
  let ranking: TeamRankingRow[] = []
  let isLoading = false
  let pendingToken = 0

  $: $refreshTrigger, teams, void load($dashboardFilters)

  async function load (filters: Filters): Promise<void> {
    const token = ++pendingToken
    // Sem BU selecionada: zera estado, não consulta backend, mantém botão liberado para idle.
    if (filters.buId === '') {
      metrics = loading
      ranking = []
      isLoading = false
      refreshState.set('idle')
      return
    }
    isLoading = true
    // Garante 'loading' mesmo se chamado por mudança de filtro (e não por triggerRefresh).
    refreshState.set('loading')
    try {
      const result = await computeDashboard(client, filters, teams)
      if (token === pendingToken) {
        metrics = result.metrics
        ranking = result.ranking
        markRefreshDone()
      }
    } catch (e) {
      console.error('[operational-dashboard] metrics computation failed', e)
      if (token === pendingToken) markRefreshFailed()
    } finally {
      if (token === pendingToken) isLoading = false
    }
  }

  interface DrillDownOpts {
    showDueDate?: boolean
  }

  function openDrillDown (title: IntlString, rows: IssueRow[], opts: DrillDownOpts = {}): void {
    if (rows.length === 0) return
    showPopup(IssueListModal, { title, rows, ...opts }, 'center')
  }

  function openWorkloadDrillDown (title: IntlString, rows: IssueRow[]): void {
    if (rows.length === 0) return
    showPopup(PersonWorkloadModal, { title, rows }, 'center')
  }
</script>

<div class="overview">
  <div class="filters-row">
    <DashboardFilters />
    <DateRangePicker />
  </div>

  {#if $dashboardFilters.buId === ''}
    <div class="empty-state">
      <Label label={operationalDashboard.string.SelectBUFirst} />
    </div>
  {:else}
    <div class="metrics-grid" class:loading={isLoading}>
      <MetricCard
        title={operationalDashboard.string.OnTimeTasks}
        value={metrics.onTime.value}
        subtitle={metrics.onTime.subtitle}
        tone={metrics.onTime.tone}
        clickable={metrics.onTime.issues.length > 0}
        on:click={() => openDrillDown(operationalDashboard.string.OnTimeTasks, metrics.onTime.issues)}
      />
      <MetricCard
        title={operationalDashboard.string.OverdueTasks}
        value={metrics.overdue.value}
        subtitle={metrics.overdue.subtitle}
        tone={metrics.overdue.tone}
        clickable={metrics.overdue.issues.length > 0}
        on:click={() => openDrillDown(operationalDashboard.string.OverdueTasks, metrics.overdue.issues)}
      />
      <MetricCard
        title={operationalDashboard.string.Workload}
        value={metrics.workload.value}
        subtitle={metrics.workload.subtitle}
        tone={metrics.workload.tone}
        clickable={metrics.workload.issues.length > 0}
        on:click={() => openWorkloadDrillDown(operationalDashboard.string.Workload, metrics.workload.issues)}
      />
      <MetricCard
        title={operationalDashboard.string.CycleTime}
        value={metrics.cycleTime.value}
        subtitle={metrics.cycleTime.subtitle}
        tone={metrics.cycleTime.tone}
        clickable={metrics.cycleTime.issues.length > 0}
        on:click={() => openDrillDown(operationalDashboard.string.CycleTime, metrics.cycleTime.issues)}
      />
      <MetricCard
        title={operationalDashboard.string.ApprovedNoChanges}
        value={metrics.approvedNoChanges.value}
        subtitle={metrics.approvedNoChanges.subtitle}
        tone={metrics.approvedNoChanges.tone}
        clickable={metrics.approvedNoChanges.issues.length > 0}
        on:click={() =>
          openDrillDown(operationalDashboard.string.ApprovedNoChanges, metrics.approvedNoChanges.issues, {
            showDueDate: false
          })}
      />
      <MetricCard
        title={operationalDashboard.string.ReworkCycles}
        value={metrics.reworkCycles.value}
        subtitle={metrics.reworkCycles.subtitle}
        tone={metrics.reworkCycles.tone}
        clickable={metrics.reworkCycles.issues.length > 0}
        on:click={() => openDrillDown(operationalDashboard.string.ReworkCycles, metrics.reworkCycles.issues)}
      />
      <MetricCard
        title={operationalDashboard.string.WaitingApproval}
        value={metrics.waitingApproval.value}
        subtitle={metrics.waitingApproval.subtitle}
        tone={metrics.waitingApproval.tone}
        clickable={metrics.waitingApproval.issues.length > 0}
        on:click={() => openDrillDown(operationalDashboard.string.WaitingApproval, metrics.waitingApproval.issues)}
      />
    </div>

    {#if ranking.length > 0}
      <TeamRanking rows={ranking} selectedTeamId={$dashboardFilters.teamId} />
    {/if}
  {/if}
</div>

<style lang="scss">
  .overview {
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

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    transition: opacity 0.15s ease;

    &.loading {
      opacity: 0.6;
    }

    @media (max-width: 900px) {
      grid-template-columns: repeat(2, 1fr);
    }

    @media (max-width: 600px) {
      grid-template-columns: 1fr;
    }
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
