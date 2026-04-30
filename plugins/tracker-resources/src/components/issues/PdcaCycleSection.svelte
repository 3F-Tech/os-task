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
  import { getClient } from '@hcengineering/presentation'
  import { getTaskTypeStates } from '@hcengineering/task'
  import { taskTypeStore } from '@hcengineering/task-resources'
  import { type Issue, type IssueStatus, PdcaFrequency } from '@hcengineering/tracker'
  import {
    Toggle,
    Label,
    DueDatePresenter,
    Icon,
    IconCalendar,
    IconRedo,
    SelectPopup,
    eventToHTMLElement,
    showPopup,
    DropdownLabelsIntl,
    type DropdownIntlItem
  } from '@hcengineering/ui'
  import { statusStore } from '@hcengineering/view-resources'

  import tracker from '../../plugin'

  export let issue: Issue
  export let readonly = false

  const client = getClient()

  $: statuses = getTaskTypeStates(issue.kind, $taskTypeStore, $statusStore.byId)

  const frequencyItems: DropdownIntlItem[] = [
    { id: PdcaFrequency.Weekly, label: tracker.string.PdcaCycleWeekly },
    { id: PdcaFrequency.Biweekly, label: tracker.string.PdcaCycleBiweekly },
    { id: PdcaFrequency.Monthly, label: tracker.string.PdcaCycleMonthly }
  ]

  async function toggleActive (val: boolean): Promise<void> {
    await client.update(issue, { pdcaCycleActive: val })
  }

  async function setFrequency (val: PdcaFrequency): Promise<void> {
    await client.update(issue, { pdcaCycleFrequency: val })
  }

  async function setResetStatus (val: Ref<IssueStatus> | undefined): Promise<void> {
    await client.update(issue, { pdcaCycleResetStatus: val })
  }

  function openStatusPopup (event: MouseEvent): void {
    if (readonly) return
    const items = [
      { id: '', text: '—', isSelected: !issue.pdcaCycleResetStatus },
      ...statuses.map((s) => ({ id: s._id, text: s.name, isSelected: s._id === issue.pdcaCycleResetStatus }))
    ]
    showPopup(SelectPopup, { value: items }, eventToHTMLElement(event), (selected: string | undefined) => {
      if (selected !== undefined) {
        void setResetStatus(selected === '' ? undefined : (selected as Ref<IssueStatus>))
      }
    })
  }

  $: isActive = issue.pdcaCycleActive === true
  $: selectedFrequency = issue.pdcaCycleFrequency ?? PdcaFrequency.Weekly
  $: resetStatusName = statuses.find((s) => s._id === issue.pdcaCycleResetStatus)?.name ?? '—'
</script>

<div class="pdca-card">
  <div class="pdca-header">
    <div class="pdca-title">
      <Icon icon={IconRedo} size="small" />
      <span class="pdca-title-text">
        <Label label={tracker.string.PdcaCycleActive} />
      </span>
    </div>
    <Toggle on={isActive} disabled={readonly} on:change={(e) => { void toggleActive(e.detail) }} />
  </div>

  {#if isActive}
    <div class="pdca-body">
      <div class="pdca-row">
        <span class="pdca-label">
          <Label label={tracker.string.PdcaCycleFrequency} />
        </span>
        <DropdownLabelsIntl
          kind="link-bordered"
          size="small"
          items={frequencyItems}
          selected={selectedFrequency}
          disabled={readonly}
          on:selected={(e) => { void setFrequency(e.detail) }}
        />
      </div>

      <div class="pdca-row">
        <span class="pdca-label">
          <Label label={tracker.string.PdcaCycleResetStatus} />
        </span>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="pdca-status-btn"
          class:disabled={readonly}
          on:click={openStatusPopup}
        >
          {resetStatusName}
        </div>
      </div>

      {#if issue.pdcaNextCycleDate != null}
        <div class="pdca-row pdca-next">
          <Icon icon={IconCalendar} size="small" />
          <span class="pdca-label">
            <Label label={tracker.string.PdcaNextCycleDate} />
          </span>
          <DueDatePresenter
            kind="link"
            value={issue.pdcaNextCycleDate}
            editable={false}
            shouldIgnoreOverdue={true}
          />
        </div>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  .pdca-card {
    grid-column: 1 / -1;
    border: 1px solid var(--theme-divider-color);
    border-radius: 6px;
    background: var(--theme-bg-color);
    overflow: hidden;
    margin-top: 0.25rem;
  }

  .pdca-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--theme-button-default);
    gap: 0.5rem;
  }

  .pdca-title {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--theme-caption-color);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .pdca-title-text {
    color: var(--theme-caption-color);
  }

  .pdca-body {
    padding: 0.375rem 0.75rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .pdca-row {
    display: flex;
    align-items: center;
    min-height: 2rem;
    gap: 0.5rem;
  }

  .pdca-label {
    flex: 1;
    font-size: 0.75rem;
    color: var(--theme-content-color);
  }

  .pdca-status-btn {
    font-size: 0.8125rem;
    color: var(--theme-content-color);
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--medium-focus-BorderRadius, 6px);
    cursor: pointer;
    min-width: 4rem;
    text-align: right;

    &:hover:not(.disabled) {
      background: var(--theme-button-hovered);
      border-color: var(--theme-content-color);
    }

    &.disabled {
      cursor: default;
      opacity: 0.6;
    }
  }

  .pdca-next {
    margin-top: 0.125rem;
    padding-top: 0.375rem;
    border-top: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
    font-size: 0.75rem;
  }
</style>
