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
  import { type OverdueAggregate, type PersonOverdueRow } from '../metricsGreen'
  import operationalDashboard from '../plugin'

  export let rows: PersonOverdueRow[] = []
  // Linha de total (agregado) opcional, renderizada no rodapé.
  export let total: OverdueAggregate | undefined = undefined
  // Issues atrasadas do escopo inteiro (drill-down da linha de total).
  export let totalIssues: IssueRow[] = []

  // Clique na linha → drill-down das tarefas atrasadas (da pessoa, ou do escopo
  // na linha de total). Quem trata o evento abre o IssueListModal.
  const dispatch = createEventDispatcher()
  function selectRow (issues: IssueRow[], name: string): void {
    if (issues.length > 0) dispatch('select', { issues, titleText: name })
  }
  function selectTotal (): void {
    if (totalIssues.length > 0) dispatch('select', { issues: totalIssues, title: operationalDashboard.string.Total })
  }
  function onKey (e: KeyboardEvent, fn: () => void): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
</script>

<div class="table-wrap">
  <h3><Label label={operationalDashboard.string.OverdueTasks} /> · <Label label={operationalDashboard.string.PerPersonSection} /></h3>
  {#if rows.length === 0}
    <div class="empty"><Label label={operationalDashboard.string.NoIssuesInMetric} /></div>
  {:else}
    <table>
      <thead>
        <tr>
          <th><Label label={operationalDashboard.string.Assignee} /></th>
          <th class="num"><Label label={operationalDashboard.string.OverdueTasks} /></th>
          <th class="num"><Label label={operationalDashboard.string.ActiveTasks} /></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.person)}
          <tr
            class:row-link={r.issues.length > 0}
            role="button"
            tabindex="0"
            on:click={() => selectRow(r.issues, r.name)}
            on:keydown={(e) => onKey(e, () => selectRow(r.issues, r.name))}
          >
            <td>{r.name}</td>
            <td class="num" class:negative={r.overdue > 0}>{r.overdue}</td>
            <td class="num muted">{r.active}</td>
          </tr>
        {/each}
      </tbody>
      {#if total != null}
        <tfoot>
          <tr
            class="total"
            class:row-link={totalIssues.length > 0}
            role="button"
            tabindex="0"
            on:click={selectTotal}
            on:keydown={(e) => onKey(e, selectTotal)}
          >
            <td><Label label={operationalDashboard.string.Total} /></td>
            <td class="num" class:negative={total.overdue > 0}>{total.overdue}</td>
            <td class="num muted">{total.active}</td>
          </tr>
        </tfoot>
      {/if}
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

    .num {
      text-align: right;
      width: 6rem;
    }

    .muted {
      color: var(--theme-dark-color);
    }

    .negative {
      color: #e74c3c;
    }

    tfoot .total td {
      font-weight: 600;
      color: var(--theme-caption-color);
      border-top: 2px solid var(--theme-divider-color);
      border-bottom: none;
    }
  }
</style>
