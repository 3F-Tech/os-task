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
  import { Label } from '@hcengineering/ui'
  import { type RankMetric, type TeamRankingRow } from '../metrics'
  import operationalDashboard from '../plugin'

  export let rows: TeamRankingRow[] = []
  export let selectedTeamId: string = ''

  let rankBy: RankMetric = 'onTime'

  // Mesma convenção do DashboardFilters: labels de option em pt inline.
  const rankOptions: Array<{ value: RankMetric, label: string }> = [
    { value: 'onTime', label: 'Tarefas no prazo' },
    { value: 'overdue', label: 'Tarefas atrasadas' },
    { value: 'cycleTime', label: 'Tempo de ciclo' },
    { value: 'rework', label: 'Ciclos de retrabalho' }
  ]

  // onTime: maior é melhor (desc); demais: menor é melhor (asc). null sempre ao fim.
  function metricValue (row: TeamRankingRow, metric: RankMetric): number | null {
    switch (metric) {
      case 'onTime':
        return row.onTimePct
      case 'overdue':
        return row.overduePct
      case 'cycleTime':
        return row.avgCycleDays
      case 'rework':
        return row.avgRework
    }
  }

  function compare (a: TeamRankingRow, b: TeamRankingRow, metric: RankMetric): number {
    const va = metricValue(a, metric)
    const vb = metricValue(b, metric)
    if (va == null && vb == null) return a.team.name.localeCompare(b.team.name)
    if (va == null) return 1
    if (vb == null) return -1
    const diff = metric === 'onTime' ? vb - va : va - vb
    if (diff !== 0) return diff
    return a.team.name.localeCompare(b.team.name)
  }

  let sorted: TeamRankingRow[] = []
  $: sorted = [...rows].sort((a, b) => compare(a, b, rankBy))

  // Hues distintos e bem espaçados — evita swatches quase idênticos.
  const COLOR_HUES: number[] = [0, 36, 60, 110, 150, 185, 215, 255, 290, 325]

  function getColorHsl (color: number): string {
    const hue = COLOR_HUES[(color - 1) % COLOR_HUES.length]
    return `hsl(${hue}, 60%, 55%)`
  }

  function fmtPct (v: number | null): string {
    return v == null ? '—' : `${v}%`
  }

  function fmtNum (v: number | null): string {
    return v == null ? '—' : v.toFixed(1)
  }
</script>

<div class="team-ranking">
  <div class="ranking-header">
    <h2><Label label={operationalDashboard.string.TeamRanking} /></h2>
    <label class="rank-by">
      <Label label={operationalDashboard.string.RankBy} />
      <select bind:value={rankBy}>
        {#each rankOptions as o (o.value)}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if sorted.length === 0}
    <div class="empty">
      <Label label={operationalDashboard.string.NoTeamsForRanking} />
    </div>
  {:else}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="num"><Label label={operationalDashboard.string.Position} /></th>
            <th><Label label={operationalDashboard.string.Team} /></th>
            <th class="num"><Label label={operationalDashboard.string.Members} /></th>
            <th class="num"><Label label={operationalDashboard.string.ActiveTasks} /></th>
            <th class="num"><Label label={operationalDashboard.string.OnTimeTasks} /></th>
            <th class="num"><Label label={operationalDashboard.string.OverdueTasks} /></th>
            <th class="num"><Label label={operationalDashboard.string.CycleTime} /></th>
            <th class="num"><Label label={operationalDashboard.string.ReworkCycles} /></th>
          </tr>
        </thead>
        <tbody>
          {#each sorted as row, i (row.team._id)}
            <tr class:highlighted={row.team._id === selectedTeamId}>
              <td class="num">{i + 1}</td>
              <td>
                <div class="team-cell">
                  <span class="team-color" style="background: {getColorHsl(row.team.color)}" />
                  <span class="team-name">{row.team.name}</span>
                </div>
              </td>
              <td class="num">{row.memberCount}</td>
              <td class="num">{row.activeCount}</td>
              <td class="num">{fmtPct(row.onTimePct)}</td>
              <td class="num">{fmtPct(row.overduePct)}</td>
              <td class="num">{fmtNum(row.avgCycleDays)}</td>
              <td class="num">{fmtNum(row.avgRework)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style lang="scss">
  .team-ranking {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .ranking-header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    h2 {
      margin: 0;
      font-size: 1.125rem;
      color: var(--theme-caption-color);
    }

    .rank-by {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--theme-content-color);
      font-size: 0.8125rem;

      select {
        padding: 0.25rem 0.5rem;
        background: var(--theme-button-bg);
        color: var(--theme-content-color);
        border: 1px solid var(--theme-divider-color);
        border-radius: 0.375rem;

        option {
          background: var(--theme-popup-color);
          color: var(--theme-content-color);
        }
      }
    }
  }

  .empty {
    padding: 1.5rem;
    text-align: center;
    color: var(--theme-dark-color);
  }

  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;

    th,
    td {
      padding: 0.5rem 0.75rem;
      text-align: left;
      white-space: nowrap;

      &.num {
        text-align: right;
      }
    }

    thead th {
      background: var(--theme-button-bg);
      color: var(--theme-dark-color);
      font-weight: 500;
      border-bottom: 1px solid var(--theme-divider-color);
    }

    tbody tr {
      border-bottom: 1px solid var(--theme-divider-color);

      &:last-child {
        border-bottom: none;
      }

      &:hover {
        background: var(--theme-button-hovered);
      }

      &.highlighted {
        background: var(--theme-button-hovered);
        outline: 1px solid var(--theme-caption-color);
        outline-offset: -1px;
      }

      td {
        color: var(--theme-content-color);
      }
    }
  }

  .team-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    .team-color {
      width: 0.875rem;
      height: 0.875rem;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .team-name {
      font-weight: 500;
      color: var(--theme-caption-color);
    }
  }
</style>
