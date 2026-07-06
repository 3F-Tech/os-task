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
  import { type Ref } from '@hcengineering/core'
  import { type ProjectDashboardConfig } from '@hcengineering/operational-dashboard'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import task, { type ProjectType } from '@hcengineering/task'
  import tracker, { type IssueStatus, type Project } from '@hcengineering/tracker'
  import { Button, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'

  export let project: Project

  const canEdit = canEditDashboard()
  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  // Load ordered status refs from project type → task types
  const projectTypeQuery = createQuery()
  const taskTypesQuery = createQuery()
  const statusesQuery = createQuery()

  let projectType: ProjectType | undefined
  let orderedStatusRefs: Ref<IssueStatus>[] = []
  let statusMap: Map<Ref<IssueStatus>, IssueStatus> = new Map()
  let statuses: IssueStatus[] = []

  $: projectTypeQuery.query(
    task.class.ProjectType,
    { _id: project.type },
    (res) => {
      projectType = res[0]
    },
    { limit: 1 }
  )

  $: if ((projectType?.tasks?.length ?? 0) > 0) {
    taskTypesQuery.query(
      task.class.TaskType,
      { _id: { $in: projectType?.tasks ?? [] } },
      (res) => {
        // Dedupe: task types distintos podem compartilhar o mesmo status (_id),
        // e refs duplicados quebram o keyed each da tabela.
        orderedStatusRefs = Array.from(new Set(res.flatMap((t) => t.statuses as Ref<IssueStatus>[])))
      }
    )
  } else {
    orderedStatusRefs = []
  }

  $: if (orderedStatusRefs.length > 0) {
    statusesQuery.query(
      tracker.class.IssueStatus,
      { _id: { $in: orderedStatusRefs } },
      (res) => {
        statusMap = new Map(res.map((s) => [s._id, s]))
        statuses = orderedStatusRefs
          .map((r) => statusMap.get(r))
          .filter((s): s is IssueStatus => s !== undefined)
      }
    )
  } else {
    statuses = []
  }

  // Load current config
  let approvedSet: Set<Ref<IssueStatus>> = new Set()
  let reworkSet: Set<Ref<IssueStatus>> = new Set()
  let waitingSet: Set<Ref<IssueStatus>> = new Set()
  let cycleStart: Ref<IssueStatus> | undefined
  let subtaskDueDates = false

  $: {
    const config = hierarchy.as(project, operationalDashboard.mixin.ProjectDashboardConfig) as ProjectDashboardConfig
    approvedSet = new Set(config.approvedStatuses ?? [])
    reworkSet = new Set(config.reworkStatuses ?? [])
    waitingSet = new Set(config.waitingApprovalStatuses ?? [])
    cycleStart = config.cycleStartStatus
    subtaskDueDates = config.subtaskDueDates === true
  }

  function toggleApproved (id: Ref<IssueStatus>): void {
    const next = new Set(approvedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    approvedSet = next
  }

  function toggleRework (id: Ref<IssueStatus>): void {
    const next = new Set(reworkSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    reworkSet = next
  }

  function toggleWaiting (id: Ref<IssueStatus>): void {
    const next = new Set(waitingSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    waitingSet = next
  }

  function selectCycleStart (id: Ref<IssueStatus> | undefined): void {
    cycleStart = id
  }

  async function save (): Promise<void> {
    if (!canEdit) return
    await client.createMixin(
      project._id,
      project._class,
      project.space,
      operationalDashboard.mixin.ProjectDashboardConfig,
      {
        approvedStatuses: Array.from(approvedSet),
        reworkStatuses: Array.from(reworkSet),
        waitingApprovalStatuses: Array.from(waitingSet),
        cycleStartStatus: cycleStart,
        subtaskDueDates
      }
    )
    dispatch('close')
  }

  function cancel (): void {
    dispatch('close')
  }
</script>

<div class="config-popup">
  <header>
    <h3>{project.name}</h3>
    <p><Label label={operationalDashboard.string.ConfigureMetrics} /></p>
  </header>

  <div class="form">
    {#if statuses.length === 0}
      <div class="empty">
        <Label label={operationalDashboard.string.NoStatusesAvailable} />
      </div>
    {:else}
      <div class="status-table">
        <div class="header-row">
          <div class="col-name"><Label label={operationalDashboard.string.StatusName} /></div>
          <div class="col-check"><Label label={operationalDashboard.string.Approved} /></div>
          <div class="col-check"><Label label={operationalDashboard.string.Rework} /></div>
          <div class="col-check"><Label label={operationalDashboard.string.WaitingApprovalShort} /></div>
          <div class="col-check"><Label label={operationalDashboard.string.CycleStart} /></div>
        </div>

        {#each statuses as s (s._id)}
          <div class="status-row">
            <div class="col-name">{s.name}</div>
            <div class="col-check">
              <input
                type="checkbox"
                checked={approvedSet.has(s._id)}
                on:change={() => toggleApproved(s._id)}
              />
            </div>
            <div class="col-check">
              <input
                type="checkbox"
                checked={reworkSet.has(s._id)}
                on:change={() => toggleRework(s._id)}
              />
            </div>
            <div class="col-check">
              <input
                type="checkbox"
                checked={waitingSet.has(s._id)}
                on:change={() => toggleWaiting(s._id)}
              />
            </div>
            <div class="col-check">
              <input
                type="radio"
                name="cycleStart"
                checked={cycleStart === s._id}
                on:change={() => selectCycleStart(s._id)}
              />
            </div>
          </div>
        {/each}

        <div class="status-row none-row">
          <div class="col-name">
            <em><Label label={operationalDashboard.string.NoCycleStart} /></em>
          </div>
          <div class="col-check" />
          <div class="col-check" />
          <div class="col-check" />
          <div class="col-check">
            <input
              type="radio"
              name="cycleStart"
              checked={cycleStart === undefined}
              on:change={() => selectCycleStart(undefined)}
            />
          </div>
        </div>
      </div>

      <label class="toggle-row">
        <input type="checkbox" bind:checked={subtaskDueDates} disabled={!canEdit} />
        <span class="toggle-text">
          <span class="toggle-title"><Label label={operationalDashboard.string.SubtaskDueDates} /></span>
          <span class="toggle-hint"><Label label={operationalDashboard.string.SubtaskDueDatesHint} /></span>
        </span>
      </label>

      <div class="hints">
        <p><Label label={operationalDashboard.string.ApprovedStatusesHint} /></p>
        <p><Label label={operationalDashboard.string.ReworkStatusesHint} /></p>
        <p><Label label={operationalDashboard.string.WaitingApprovalStatusesHint} /></p>
        <p><Label label={operationalDashboard.string.CycleStartStatusHint} /></p>
      </div>
    {/if}
  </div>

  <footer>
    <Button label={operationalDashboard.string.Cancel} on:click={cancel} />
    {#if canEdit}
      <Button label={operationalDashboard.string.Save} kind="primary" on:click={save} />
    {/if}
  </footer>
</div>

<style lang="scss">
  .config-popup {
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.625rem;
    padding: 1.25rem;
    min-width: 42rem;
    max-width: 52rem;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--theme-popup-shadow);

    header {
      margin-bottom: 1rem;
      h3 {
        margin: 0 0 0.25rem;
        font-size: 1.125rem;
        color: var(--theme-caption-color);
      }
      p {
        margin: 0;
        color: var(--theme-content-color);
        font-size: 0.875rem;
      }
    }

    .form {
      flex: 1;
      overflow-y: auto;
      padding-right: 0.25rem;
    }

    .empty {
      padding: 2rem;
      text-align: center;
      color: var(--theme-dark-color);
    }

    .status-table {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--theme-divider-color);
      border-radius: 0.375rem;
      overflow: hidden;
    }

    .header-row,
    .status-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 6rem 6rem 6rem 5rem;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--theme-divider-color);

      &:last-child {
        border-bottom: none;
      }
    }

    .header-row {
      background: var(--theme-divider-color);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      color: var(--theme-dark-color);

      .col-check {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
    }

    .none-row {
      background: var(--theme-button-bg);
      font-style: italic;
      color: var(--theme-content-color);
    }

    .col-name {
      color: var(--theme-caption-color);
    }

    .col-check {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .toggle-row {
      display: flex;
      align-items: flex-start;
      gap: 0.625rem;
      margin-top: 0.875rem;
      padding: 0.625rem 0.75rem;
      background: var(--theme-button-bg);
      border: 1px solid var(--theme-divider-color);
      border-radius: 0.375rem;
      cursor: pointer;

      input {
        margin-top: 0.15rem;
      }

      .toggle-text {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }

      .toggle-title {
        color: var(--theme-caption-color);
        font-size: 0.9375rem;
      }

      .toggle-hint {
        color: var(--theme-dark-color);
        font-size: 0.8125rem;
      }
    }

    .hints {
      margin-top: 0.75rem;
      padding: 0.625rem 0.75rem;
      background: var(--theme-divider-color);
      border-radius: 0.375rem;
      font-size: 0.8125rem;
      color: var(--theme-content-color);

      p {
        margin: 0 0 0.25rem;
        &:last-child {
          margin-bottom: 0;
        }
      }
    }

    footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--theme-divider-color);
    }
  }
</style>
