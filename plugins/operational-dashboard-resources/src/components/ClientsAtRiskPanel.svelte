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
  import { createEventDispatcher } from 'svelte'
  import { type IssueRow } from '../metrics'
  import { type ClientRiskRow } from '../metricsGreen'
  import operationalDashboard from '../plugin'

  export let rows: ClientRiskRow[] = []
  // Limiar de dias (só p/ exibir no subtítulo "+N dias").
  export let alertDays = 15

  // Clique na linha → tarefas de Retenção do cliente (drill-down).
  const dispatch = createEventDispatcher()
  function selectRow (r: ClientRiskRow): void {
    if (r.issues.length > 0) dispatch('select', { issues: r.issues, titleText: r.client })
  }
  function onKey (e: KeyboardEvent, r: ClientRiskRow): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectRow(r)
    }
  }

  function formatDate (ts: number | null): string {
    return ts == null ? '—' : new Date(ts).toLocaleDateString('pt-BR')
  }
</script>

<div class="table-wrap">
  <h3>
    <Label label={operationalDashboard.string.ClientsAtRiskTitle} />
    <span class="threshold">· +{alertDays}d</span>
  </h3>
  {#if rows.length === 0}
    <div class="empty"><Label label={operationalDashboard.string.NoClientsAtRisk} /></div>
  {:else}
    <table>
      <thead>
        <tr>
          <th><Label label={operationalDashboard.string.Client} /></th>
          <th><Label label={operationalDashboard.string.Assignee} /></th>
          <th><Label label={operationalDashboard.string.LastRetention} /></th>
          <th class="num"><Label label={operationalDashboard.string.DaysWithoutRetention} /></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.client)}
          <tr
            class:row-link={r.issues.length > 0}
            role="button"
            tabindex="0"
            on:click={() => selectRow(r)}
            on:keydown={(e) => onKey(e, r)}
          >
            <td class="client">{r.client}</td>
            <td>
              {#if r.accounts.length > 0}
                {r.accounts.join(', ')}
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            <td>
              {#if r.lastRetentionAt == null}
                <span class="never"><Label label={operationalDashboard.string.Never} /></span>
              {:else}
                {formatDate(r.lastRetentionAt)}
              {/if}
            </td>
            <td class="num negative">
              {#if r.daysSince == null}
                <Label label={operationalDashboard.string.Never} />
              {:else}
                {r.daysSince}d
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style lang="scss">
  .table-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    h3 {
      margin: 0;
      font-size: 0.95rem;
      color: var(--theme-caption-color);

      .threshold {
        color: var(--theme-dark-color);
        font-weight: 400;
        font-size: 0.8125rem;
      }
    }
  }

  .empty {
    padding: 1.5rem;
    text-align: center;
    color: var(--theme-dark-color);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;

    tr.row-link {
      cursor: pointer;
    }

    tr.row-link:hover {
      background: var(--theme-button-hovered);
    }

    th,
    td {
      padding: 0.5rem 0.625rem;
      text-align: left;
      border-bottom: 1px solid var(--theme-divider-color);
      color: var(--theme-content-color);
    }

    th {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--theme-dark-color);
      font-weight: 500;
    }

    td.client {
      font-weight: 500;
      color: var(--theme-caption-color);
    }

    .num {
      text-align: right;
      white-space: nowrap;
      width: 8rem;
    }

    .negative {
      color: #e74c3c;
      font-weight: 600;
    }

    .never {
      color: #e74c3c;
      font-weight: 600;
    }

    .muted {
      color: var(--theme-dark-color);
    }
  }
</style>
