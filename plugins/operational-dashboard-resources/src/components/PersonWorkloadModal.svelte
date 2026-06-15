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
  import tracker from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { type IssueRow } from '../metrics'
  import operationalDashboard from '../plugin'

  export let title: IntlString
  export let rows: IssueRow[] = []

  const dispatch = createEventDispatcher()

  interface Bucket {
    personId: Ref<Person> | null
    tasks: number
    subtasks: number
    estimation: number
  }

  // Sub-issue é Issue com attachedTo apontando para outra issue;
  // issues raiz têm attachedTo = tracker.ids.NoParent.
  function isSubtask (r: IssueRow): boolean {
    const at = r.issue.attachedTo
    return at != null && at !== tracker.ids.NoParent
  }

  $: personIds = Array.from(
    new Set(
      rows
        .flatMap((r) => r.issue.assignee ?? [])
        .filter((a): a is Ref<Person> => a != null)
    )
  )

  const personQuery = createQuery()
  let personMap: Map<Ref<Person>, Person> = new Map()

  $: if (personIds.length > 0) {
    personQuery.query(contact.class.Person, { _id: { $in: personIds } }, (res) => {
      personMap = new Map(res.map((p) => [p._id, p]))
    })
  } else {
    personMap = new Map()
  }

  $: buckets = computeBuckets(rows)
  $: assignedBuckets = buckets
    .filter((b): b is Bucket & { personId: Ref<Person> } => b.personId !== null)
    .sort((a, b) => b.tasks + b.subtasks - (a.tasks + a.subtasks))
  $: unassignedBucket = buckets.find((b) => b.personId === null)

  function computeBuckets (rs: IssueRow[]): Bucket[] {
    const map = new Map<Ref<Person> | 'unassigned', Bucket>()
    const add = (key: Ref<Person> | 'unassigned', personId: Ref<Person> | null, r: IssueRow): void => {
      const cur = map.get(key) ?? { personId, tasks: 0, subtasks: 0, estimation: 0 }
      if (isSubtask(r)) cur.subtasks += 1
      else cur.tasks += 1
      cur.estimation += r.issue.estimation ?? 0
      map.set(key, cur)
    }
    for (const r of rs) {
      const assignees = r.issue.assignee ?? []
      if (assignees.length === 0) {
        add('unassigned', null, r)
      } else {
        // multi-assignee: a issue conta no bucket de cada responsável
        for (const a of assignees) {
          add(a, a, r)
        }
      }
    }
    return [...map.values()]
  }

  function formatHours (h: number): string {
    if (h === 0) return '—'
    if (Number.isInteger(h)) return `${h}h`
    return `${h.toFixed(1).replace('.', ',')}h`
  }

  $: totalTasks = buckets.reduce((s, b) => s + b.tasks, 0)
  $: totalSubtasks = buckets.reduce((s, b) => s + b.subtasks, 0)
  $: totalEstimation = rows.reduce((s, r) => s + (r.issue.estimation ?? 0), 0)
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
            <th><Label label={operationalDashboard.string.Assignee} /></th>
            <th class="num"><Label label={operationalDashboard.string.TaskCount} /></th>
            <th class="num"><Label label={operationalDashboard.string.SubtaskCount} /></th>
            <th class="num"><Label label={operationalDashboard.string.TotalEstimation} /></th>
          </tr>
        </thead>
        <tbody>
          {#each assignedBuckets as b (b.personId)}
            {@const person = personMap.get(b.personId)}
            <tr>
              <td>{person != null ? formatName(person.name ?? '') : '…'}</td>
              <td class="num">{b.tasks}</td>
              <td class="num">{b.subtasks > 0 ? b.subtasks : '—'}</td>
              <td class="num">{formatHours(b.estimation)}</td>
            </tr>
          {/each}
          {#if unassignedBucket != null}
            <tr class="unassigned-row">
              <td><em><Label label={operationalDashboard.string.Unassigned} /></em></td>
              <td class="num">{unassignedBucket.tasks}</td>
              <td class="num">{unassignedBucket.subtasks > 0 ? unassignedBucket.subtasks : '—'}</td>
              <td class="num">{formatHours(unassignedBucket.estimation)}</td>
            </tr>
          {/if}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>Total</strong></td>
            <td class="num"><strong>{totalTasks}</strong></td>
            <td class="num"><strong>{totalSubtasks}</strong></td>
            <td class="num"><strong>{formatHours(totalEstimation)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</div>

<style lang="scss">
  .modal {
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.625rem;
    box-shadow: var(--theme-popup-shadow);
    min-width: 36rem;
    max-width: 52rem;
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

        &.num {
          text-align: right;
        }
      }

      tbody tr {
        border-bottom: 1px solid var(--theme-divider-color);

        &:last-child {
          border-bottom: none;
        }

        &:hover {
          background: var(--theme-button-hovered);
        }

        &.unassigned-row {
          background: var(--theme-button-bg);
          color: var(--theme-content-color);
        }
      }

      td {
        padding: 0.625rem 1rem;
        color: var(--theme-caption-color);

        &.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      }

      tfoot tr {
        border-top: 2px solid var(--theme-divider-color);
        background: var(--theme-bg-color);

        td {
          padding: 0.75rem 1rem;
          color: var(--theme-caption-color);
        }
      }
    }
  }
</style>
