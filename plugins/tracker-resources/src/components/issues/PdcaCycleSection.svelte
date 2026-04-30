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

  // IDs as strings to avoid type mismatch in DropdownLabelsIntl
  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat (JS Date.getDay())
  const weekdayItems: DropdownIntlItem[] = [
    { id: '1', label: tracker.string.PdcaWeekdayMon },
    { id: '2', label: tracker.string.PdcaWeekdayTue },
    { id: '3', label: tracker.string.PdcaWeekdayWed },
    { id: '4', label: tracker.string.PdcaWeekdayThu },
    { id: '5', label: tracker.string.PdcaWeekdayFri },
    { id: '6', label: tracker.string.PdcaWeekdaySat },
    { id: '0', label: tracker.string.PdcaWeekdaySun }
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

  async function setDueDays (days: number[]): Promise<void> {
    await client.update(issue, { pdcaCycleDueDays: days } as any)
  }

  async function toggleDuplicate (val: boolean): Promise<void> {
    await client.update(issue, { pdcaCycleDuplicate: val } as any)
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

  function handleWeekdaySelect (e: CustomEvent<string>): void {
    void setDueDays([parseInt(e.detail)])
  }

  function handleMonthDay1 (e: Event): void {
    const val = parseInt((e.target as HTMLInputElement).value)
    if (isNaN(val) || val < 1 || val > 31) return
    const current = (issue as any).pdcaCycleDueDays as number[] | undefined
    void setDueDays([val, current?.[1] ?? val])
  }

  function handleMonthDay2 (e: Event): void {
    const val = parseInt((e.target as HTMLInputElement).value)
    if (isNaN(val) || val < 1 || val > 31) return
    const current = (issue as any).pdcaCycleDueDays as number[] | undefined
    void setDueDays([current?.[0] ?? val, val])
  }

  function handleMonthDay (e: Event): void {
    const val = parseInt((e.target as HTMLInputElement).value)
    if (isNaN(val) || val < 1 || val > 31) return
    void setDueDays([val])
  }

  $: isActive = issue.pdcaCycleActive === true
  $: selectedFrequency = issue.pdcaCycleFrequency ?? PdcaFrequency.Weekly
  $: resetStatusName = statuses.find((s) => s._id === issue.pdcaCycleResetStatus)?.name ?? '—'
  $: dueDays = (issue as any).pdcaCycleDueDays as number[] | undefined
  $: selectedWeekday = String(dueDays?.[0] ?? 5) // default: Friday
  $: isDuplicate = (issue as any).pdcaCycleDuplicate === true
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

      {#if selectedFrequency === PdcaFrequency.Weekly}
        <div class="pdca-row">
          <span class="pdca-label">
            <Label label={tracker.string.PdcaDueWeekday} />
          </span>
          <DropdownLabelsIntl
            kind="link-bordered"
            size="small"
            items={weekdayItems}
            selected={selectedWeekday}
            disabled={readonly}
            on:selected={handleWeekdaySelect}
          />
        </div>
      {/if}

      {#if selectedFrequency === PdcaFrequency.Monthly}
        <div class="pdca-row">
          <span class="pdca-label">
            <Label label={tracker.string.PdcaDueMonthDay} />
          </span>
          <input
            class="pdca-day-input"
            type="number"
            min="1"
            max="31"
            value={dueDays?.[0] ?? ''}
            disabled={readonly}
            placeholder="15"
            on:change={handleMonthDay}
          />
        </div>
      {/if}

      {#if selectedFrequency === PdcaFrequency.Biweekly}
        <div class="pdca-row">
          <span class="pdca-label">
            <Label label={tracker.string.PdcaDueMonthDays} />
          </span>
          <div class="pdca-two-days">
            <input
              class="pdca-day-input"
              type="number"
              min="1"
              max="31"
              value={dueDays?.[0] ?? ''}
              disabled={readonly}
              placeholder="1"
              on:change={handleMonthDay1}
            />
            <span class="pdca-day-sep">e</span>
            <input
              class="pdca-day-input"
              type="number"
              min="1"
              max="31"
              value={dueDays?.[1] ?? ''}
              disabled={readonly}
              placeholder="15"
              on:change={handleMonthDay2}
            />
          </div>
        </div>
      {/if}

      <div class="pdca-row">
        <span class="pdca-label">
          <Label label={tracker.string.PdcaDuplicate} />
        </span>
        <Toggle
          on={isDuplicate}
          disabled={readonly}
          on:change={(e) => { void toggleDuplicate(e.detail) }}
        />
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

  .pdca-day-input {
    width: 3.5rem;
    padding: 0.125rem 0.375rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--medium-focus-BorderRadius, 6px);
    text-align: center;
    outline: none;

    &:focus {
      border-color: var(--theme-content-color);
    }

    &:disabled {
      opacity: 0.6;
      cursor: default;
    }

    /* Hide browser spin buttons */
    &::-webkit-outer-spin-button,
    &::-webkit-inner-spin-button {
      -webkit-appearance: none;
    }
    -moz-appearance: textfield;
  }

  .pdca-two-days {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .pdca-day-sep {
    font-size: 0.75rem;
    color: var(--theme-content-color);
  }

  .pdca-next {
    margin-top: 0.125rem;
    padding-top: 0.375rem;
    border-top: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
    font-size: 0.75rem;
  }
</style>
