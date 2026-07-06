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
  import { type IntlString } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { Label, showPopup } from '@hcengineering/ui'
  import { type IssueRow, toneForTarget } from '../metrics'
  import { computeQG, emptyQGResult, type QGResult } from '../metricsGreen'
  import { orgStore } from '../orgStructure'
  import operationalDashboard from '../plugin'
  import IssueListModal from './IssueListModal.svelte'
  import {
    dashboardFilters,
    markRefreshDone,
    markRefreshFailed,
    refreshState,
    refreshTrigger
  } from '../stores'
  import CapacityPanel from './CapacityPanel.svelte'
  import ChangesAdjustmentsPanel from './ChangesAdjustmentsPanel.svelte'
  import DateRangePicker from './DateRangePicker.svelte'
  import MetricCard from './MetricCard.svelte'
  import OverduePerPersonTable from './OverduePerPersonTable.svelte'

  const client = getClient()

  // Squads do 3F Core (read-through) — pool do QG selecionável.
  $: idx = $orgStore.indexes
  $: teams = (idx?.raw.squads ?? []).filter((s) => s.is_active)

  let qgTeamId = ''
  let qg: QGResult = emptyQGResult()
  let isLoading = false
  let pendingToken = 0

  $: $refreshTrigger, qgTeamId, idx, $dashboardFilters.dateFrom, $dashboardFilters.dateTo, void load()

  async function load (): Promise<void> {
    const token = ++pendingToken
    if (idx == null) {
      isLoading = false
      return
    }
    isLoading = true
    refreshState.set('loading')
    try {
      const result = await computeQG(
        client,
        $dashboardFilters.dateFrom,
        $dashboardFilters.dateTo,
        qgTeamId,
        idx
      )
      if (token === pendingToken) {
        qg = result
        markRefreshDone()
      }
    } catch (e) {
      console.error('[operational-dashboard] QG metrics computation failed', e)
      if (token === pendingToken) markRefreshFailed()
    } finally {
      if (token === pendingToken) isLoading = false
    }
  }

  const CARGO_LABELS: Record<string, IntlString> = {
    account: operationalDashboard.string.CargoAccount,
    gt: operationalDashboard.string.CargoGT,
    socialMedia: operationalDashboard.string.CargoSocialMedia,
    designer: operationalDashboard.string.CargoDesigner,
    editor: operationalDashboard.string.CargoEditor,
    coordinator: operationalDashboard.string.CargoCoordinator,
    qgLeader: operationalDashboard.string.CargoQGLeader
  }

  // Hues distintos (mesma convenção do TeamRanking)
  const COLOR_HUES: number[] = [0, 36, 60, 110, 150, 185, 215, 255, 290, 325]
  function getColorHsl (color: number): string {
    return `hsl(${COLOR_HUES[(color - 1) % COLOR_HUES.length]}, 60%, 55%)`
  }

  // Drill-down da tabela de atraso por pessoa (linha emite issues + título).
  function openPerPerson (
    e: CustomEvent<{ issues: IssueRow[], titleText?: string, title?: IntlString }>
  ): void {
    const { issues, titleText, title } = e.detail
    if (issues == null || issues.length === 0) return
    showPopup(IssueListModal, { rows: issues, titleText, title }, 'center')
  }

  function fmtPct (v: number | null): string {
    return v == null ? '—' : `${v}%`
  }
  function toneClass (v: number | null): string {
    if (v == null) return ''
    const t = toneForTarget(v, undefined)
    return t === 'positive' ? 'pos' : t === 'negative' ? 'neg' : 'neu'
  }
</script>

<div class="qg-view">
  <div class="filters-row">
    <DateRangePicker />
    <label class="qg-team">
      <Label label={operationalDashboard.string.QGTeam} />
      <select bind:value={qgTeamId}>
        <option value="">{''}</option>
        {#each teams as t (t.id)}
          <option value={String(t.id)}>{t.name}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class:loading={isLoading} class="content">
    <!-- Operação inteira -->
    <div class="grid-2">
      <div class="card">
        <h3><Label label={operationalDashboard.string.ByCargoTitle} /></h3>
        {#if qg.byCargo.length === 0}
          <div class="hint"><Label label={operationalDashboard.string.NoIssuesInMetric} /></div>
        {:else}
          <table>
            <thead>
              <tr>
                <th><Label label={operationalDashboard.string.Cargo} /></th>
                <th class="num"><Label label={operationalDashboard.string.OnTimePct} /></th>
              </tr>
            </thead>
            <tbody>
              {#each qg.byCargo as r (r.cargo)}
                <tr>
                  <td>
                    {#if r.cargo === ''}
                      <Label label={operationalDashboard.string.NoCargo} />
                    {:else if CARGO_LABELS[r.cargo] != null}
                      <Label label={CARGO_LABELS[r.cargo]} />
                    {:else}
                      {r.cargo}
                    {/if}
                  </td>
                  <td class="num {toneClass(r.pct)}">{fmtPct(r.pct)} <span class="frac">({r.onTime}/{r.withDue})</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <div class="card">
        <h3><Label label={operationalDashboard.string.ByBUTitle} /></h3>
        {#if qg.byBU.length === 0}
          <div class="hint"><Label label={operationalDashboard.string.NoBusinessUnits} /></div>
        {:else}
          <table>
            <thead>
              <tr>
                <th><Label label={operationalDashboard.string.BusinessUnit} /></th>
                <th class="num"><Label label={operationalDashboard.string.OnTimePct} /></th>
              </tr>
            </thead>
            <tbody>
              {#each qg.byBU as r (r.bu)}
                <tr>
                  <td>
                    <span class="bu-color" style="background: {getColorHsl(r.color)}" />
                    {r.name}
                  </td>
                  <td class="num {toneClass(r.pct)}">{fmtPct(r.pct)} <span class="frac">({r.onTime}/{r.withDue})</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>

    <ChangesAdjustmentsPanel result={qg.changes} />

    <!-- Pool do QG (depende do time selecionado) -->
    {#if !qg.hasTeam}
      <div class="card hint-card">
        <Label label={operationalDashboard.string.SelectQGTeam} />
      </div>
    {:else}
      <div class="grid-2">
        <MetricCard
          title={operationalDashboard.string.QGExecutionTitle}
          value={fmtPct(qg.qgExecution.pct)}
          subtitle={qg.qgExecution.withDue > 0
            ? `${qg.qgExecution.onTime}/${qg.qgExecution.withDue} no prazo`
            : 'sem entregas no período'}
          tone={qg.qgExecution.pct == null ? 'neutral' : toneForTarget(qg.qgExecution.pct, undefined)}
        />
        <CapacityPanel result={qg.capacity} />
      </div>
      <OverduePerPersonTable rows={qg.overduePerPerson} on:select={openPerPerson} />
    {/if}
  </div>
</div>

<style lang="scss">
  .qg-view {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .filters-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .qg-team {
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
      min-width: 12rem;

      option {
        background: var(--theme-popup-color);
        color: var(--theme-content-color);
      }
    }
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    transition: opacity 0.15s ease;

    &.loading {
      opacity: 0.6;
    }
  }

  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;

    @media (max-width: 900px) {
      grid-template-columns: 1fr;
    }
  }

  .card {
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.625rem;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;

    h3 {
      margin: 0;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--theme-dark-color);
      font-weight: 500;
    }
  }

  .hint,
  .hint-card {
    color: var(--theme-dark-color);
    font-size: 0.875rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;

    th,
    td {
      padding: 0.375rem 0.5rem;
      text-align: left;
      border-bottom: 1px solid var(--theme-divider-color);
      color: var(--theme-content-color);
    }

    th {
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--theme-dark-color);
      font-weight: 500;
    }

    .num {
      text-align: right;
      white-space: nowrap;

      &.pos {
        color: #2ecc71;
      }
      &.neg {
        color: #e74c3c;
      }
      &.neu {
        color: var(--theme-content-color);
      }
    }

    .frac {
      color: var(--theme-dark-color);
      font-size: 0.6875rem;
    }
  }

  .bu-color {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    margin-right: 0.375rem;
    vertical-align: middle;
  }
</style>
