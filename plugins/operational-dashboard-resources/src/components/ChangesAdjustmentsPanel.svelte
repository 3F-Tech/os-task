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
  import { type ChangesResult } from '../metricsGreen'
  import operationalDashboard from '../plugin'

  export let result: ChangesResult

  function hours (ms: number): string {
    return `${(ms / 3_600_000).toFixed(1)}h`
  }

  $: breakdown = `${hours(result.reworkMs)} em ajustes · ${hours(result.devMs)} em desenvolvimento · ${result.issueCount} tarefas`

  // Paginação clássica — 10 linhas por página (mesmo padrão do IssueListModal).
  const PAGE_SIZE = 10
  let page = 0
  $: rowCount = result.perIssue.length
  $: totalPages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE))
  $: if (page >= totalPages) page = totalPages - 1
  $: pagedRows = result.perIssue.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  $: pageItems = pageList(totalPages, page)

  // Janela de páginas: tudo se <=7; senão primeira, vizinhas da atual e última, com "…".
  function pageList (total: number, current: number): Array<number | '…'> {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i)
    const pages = new Set<number>([0, total - 1, current - 1, current, current + 1])
    const list = [...pages].filter((p) => p >= 0 && p < total).sort((a, b) => a - b)
    const out: Array<number | '…'> = []
    let prev = -1
    for (const p of list) {
      if (prev !== -1 && p - prev > 1) out.push('…')
      out.push(p)
      prev = p
    }
    return out
  }
</script>

<div class="changes-panel">
  <h3><Label label={operationalDashboard.string.ChangesAdjustments} /></h3>

  {#if !result.configured}
    <div class="hint"><Label label={operationalDashboard.string.ChangesAdjustmentsHint} /></div>
  {:else if result.pct == null}
    <div class="hint"><Label label={operationalDashboard.string.NoIssuesInMetric} /></div>
  {:else}
    <div class="headline">
      <span class="value">{result.pct}%</span>
      <span class="breakdown">{breakdown}</span>
    </div>

    {#if result.perIssue.length > 0}
      <table>
        <thead>
          <tr>
            <th><Label label={operationalDashboard.string.IssueIdentifier} /></th>
            <th><Label label={operationalDashboard.string.IssueTitle} /></th>
            <th class="num"><Label label={operationalDashboard.string.ReworkPct} /></th>
          </tr>
        </thead>
        <tbody>
          {#each pagedRows as r (r.issueId)}
            <tr>
              <td class="mono">{r.identifier}</td>
              <td class="title">{r.title}</td>
              <td class="num">{r.pct}%</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if totalPages > 1}
        <div class="pager">
          <button class="page-btn" disabled={page === 0} on:click={() => (page -= 1)} aria-label="Página anterior">
            ‹
          </button>
          {#each pageItems as it, idx (idx)}
            {#if it === '…'}
              <span class="ellipsis">…</span>
            {:else}
              <button class="page-btn" class:active={it === page} on:click={() => (page = it)}>
                {it + 1}
              </button>
            {/if}
          {/each}
          <button
            class="page-btn"
            disabled={page === totalPages - 1}
            on:click={() => (page += 1)}
            aria-label="Próxima página"
          >
            ›
          </button>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style lang="scss">
  .changes-panel {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 1rem 1.25rem;
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.625rem;

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
    color: var(--theme-dark-color);
    font-size: 0.875rem;
  }

  .headline {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-wrap: wrap;

    .value {
      font-size: 2rem;
      font-weight: 600;
      color: var(--theme-caption-color);
      line-height: 1.1;
    }

    .breakdown {
      font-size: 0.8125rem;
      color: var(--theme-content-color);
    }
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    margin-top: 0.25rem;

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
      width: 4.5rem;
    }

    .mono {
      font-family: var(--mono-font, monospace);
      white-space: nowrap;
      color: var(--theme-dark-color);
    }

    .title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 0;
    }
  }

  .pager {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .page-btn {
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.375rem;
    background: none;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    color: var(--theme-content-color);
    font-size: 0.8125rem;
    cursor: pointer;

    &:hover:not(:disabled):not(.active) {
      background: var(--theme-button-hovered);
      color: var(--theme-caption-color);
    }

    &.active {
      background: var(--theme-button-pressed, var(--theme-button-hovered));
      border-color: var(--theme-caption-color);
      color: var(--theme-caption-color);
      font-weight: 600;
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }

  .ellipsis {
    padding: 0 0.25rem;
    color: var(--theme-dark-color);
  }
</style>
