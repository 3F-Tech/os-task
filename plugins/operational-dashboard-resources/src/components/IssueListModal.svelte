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
  import contact, { formatName, type Person } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import tracker, { type Issue, type IssueStatus, type Project } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { type IssueRow } from '../metrics'
  import operationalDashboard from '../plugin'

  export let title: IntlString
  export let rows: IssueRow[] = []
  // Quando false, esconde colunas Vencimento e Atraso (vão juntas).
  export let showDueDate: boolean = true

  const dispatch = createEventDispatcher()

  const DAY_MS = 1000 * 60 * 60 * 24

  function startOfDay (ts: number): number {
    const d = new Date(ts)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  // Compara só a data (sem hora). Vence hoje = 0 dias de atraso.
  // Vence ontem (ou completou ontem para um dueDate de anteontem) = 1 dia, etc.
  function lateDays (row: IssueRow): number | null {
    const due = row.issue.dueDate
    if (due == null) return null
    const ref = row.completedAt ?? Date.now()
    const diff = (startOfDay(ref) - startOfDay(due)) / DAY_MS
    return diff > 0 ? diff : 0
  }

  $: hasStartedAt = rows.some((r) => r.startedAt != null)
  $: hasCompletedAt = rows.some((r) => r.completedAt != null)
  $: hasLate = showDueDate && rows.some((r) => (lateDays(r) ?? 0) > 0)
  $: hasRework = rows.some((r) => r.reworkCount != null)
  $: statusIds = Array.from(new Set(rows.map((r) => r.issue.status)))
  $: personIds = Array.from(
    new Set(
      rows
        .map((r) => r.issue.assignee)
        .filter((a): a is Ref<Person> => a != null)
    )
  )
  $: projectIds = Array.from(new Set(rows.map((r) => r.issue.space as Ref<Project>)))

  const statusQuery = createQuery()
  const personQuery = createQuery()
  const projectQuery = createQuery()

  let statusMap: Map<Ref<IssueStatus>, IssueStatus> = new Map()
  let personMap: Map<Ref<Person>, Person> = new Map()
  let projectMap: Map<Ref<Project>, Project> = new Map()

  $: if (statusIds.length > 0) {
    statusQuery.query(tracker.class.IssueStatus, { _id: { $in: statusIds } }, (res) => {
      statusMap = new Map(res.map((s) => [s._id, s]))
    })
  }

  $: if (personIds.length > 0) {
    personQuery.query(contact.class.Person, { _id: { $in: personIds } }, (res) => {
      personMap = new Map(res.map((p) => [p._id, p]))
    })
  }

  $: if (projectIds.length > 0) {
    projectQuery.query(tracker.class.Project, { _id: { $in: projectIds } }, (res) => {
      projectMap = new Map(res.map((p) => [p._id, p]))
    })
  }

  function formatDate (ts: number | null | undefined): string {
    if (ts == null) return '—'
    return new Date(ts).toLocaleDateString('pt-BR')
  }

  function identifierOf (issue: Issue): string {
    const p = projectMap.get(issue.space as Ref<Project>)
    const prefix = p?.identifier ?? ''
    return prefix !== '' ? `${prefix}-${issue.number ?? '?'}` : `#${issue.number ?? '?'}`
  }

  function isOverdue (issue: Issue): boolean {
    if (issue.dueDate == null) return false
    return startOfDay(issue.dueDate) < startOfDay(Date.now())
  }

  // Paginação clássica — 10 linhas por página.
  const PAGE_SIZE = 10
  let page = 0
  $: totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  $: if (page >= totalPages) page = totalPages - 1
  $: pagedRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
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

<div class="modal">
  <header>
    <h3><Label label={title} /></h3>
    <button class="close" on:click={() => dispatch('close')} aria-label="Fechar">×</button>
  </header>

  {#if rows.length === 0}
    <div class="empty">
      <Label label={operationalDashboard.string.NoIssuesInMetric} />
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th><Label label={operationalDashboard.string.IssueIdentifier} /></th>
            <th><Label label={operationalDashboard.string.IssueTitle} /></th>
            <th><Label label={operationalDashboard.string.StatusName} /></th>
            <th><Label label={operationalDashboard.string.Assignee} /></th>
            {#if hasStartedAt}
              <th><Label label={operationalDashboard.string.StartedAt} /></th>
            {/if}
            {#if hasCompletedAt}
              <th><Label label={operationalDashboard.string.CompletedAt} /></th>
            {/if}
            {#if showDueDate}
              <th><Label label={operationalDashboard.string.DueDate} /></th>
            {/if}
            {#if hasLate}
              <th><Label label={operationalDashboard.string.DaysLate} /></th>
            {/if}
            {#if hasRework}
              <th><Label label={operationalDashboard.string.ReworkCount} /></th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each pagedRows as row (row.issue._id)}
            <tr>
              <td class="mono">{identifierOf(row.issue)}</td>
              <td class="title-col">{row.issue.title}</td>
              <td>{statusMap.get(row.issue.status)?.name ?? '…'}</td>
              <td>
                {#if row.issue.assignee != null}
                  {@const assigneePerson = personMap.get(row.issue.assignee)}
                  {assigneePerson != null ? formatName(assigneePerson.name ?? '') : '…'}
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
              {#if hasStartedAt}
                <td>{formatDate(row.startedAt)}</td>
              {/if}
              {#if hasCompletedAt}
                <td>{formatDate(row.completedAt)}</td>
              {/if}
              {#if showDueDate}
                <td class:overdue={isOverdue(row.issue)}>{formatDate(row.issue.dueDate)}</td>
              {/if}
              {#if hasLate}
                {@const ld = lateDays(row)}
                <td>
                  {#if ld != null && ld > 0}
                    <span class="late">{ld}d</span>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
              {/if}
              {#if hasRework}
                <td>
                  {#if row.reworkCount != null && row.reworkCount > 0}
                    <span class="rework-count">{row.reworkCount}</span>
                  {:else}
                    <span class="muted">0</span>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <footer>
      <span class="count">{rows.length} {rows.length === 1 ? 'tarefa' : 'tarefas'}</span>
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
    </footer>
  {/if}
</div>

<style lang="scss">
  .modal {
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.625rem;
    box-shadow: var(--theme-popup-shadow);
    min-width: 40rem;
    max-width: 64rem;
    max-height: 80vh;
    display: flex;
    flex-direction: column;

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--theme-divider-color);

      h3 {
        margin: 0;
        font-size: 1.0625rem;
        color: var(--theme-caption-color);
      }

      .close {
        background: none;
        border: none;
        color: var(--theme-content-color);
        font-size: 1.5rem;
        line-height: 1;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;

        &:hover {
          background: var(--theme-button-hovered);
          color: var(--theme-caption-color);
        }
      }
    }

    .empty {
      padding: 3rem;
      text-align: center;
      color: var(--theme-dark-color);
    }

    .table-wrap {
      flex: 1;
      overflow-y: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;

      thead th {
        position: sticky;
        top: 0;
        background: var(--theme-bg-color);
        text-align: left;
        padding: 0.625rem 1rem;
        font-weight: 600;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--theme-dark-color);
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
      }

      td {
        padding: 0.5rem 1rem;
        color: var(--theme-caption-color);
        vertical-align: top;
      }

      td.mono {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        color: var(--theme-dark-color);
        white-space: nowrap;
      }

      td.title-col {
        max-width: 24rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      td.overdue {
        color: #e74c3c;
        font-weight: 500;
      }

      .late {
        color: #e74c3c;
        font-weight: 600;
        white-space: nowrap;
      }

      .rework-count {
        color: #f39c12;
        font-weight: 600;
      }

      .muted {
        color: var(--theme-dark-color);
      }
    }

    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.625rem 1.25rem;
      border-top: 1px solid var(--theme-divider-color);
      color: var(--theme-dark-color);
      font-size: 0.8125rem;
    }

    .pager {
      display: flex;
      align-items: center;
      gap: 0.25rem;
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
  }
</style>
