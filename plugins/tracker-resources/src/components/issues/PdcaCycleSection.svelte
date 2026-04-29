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
  import { getClient, createQuery } from '@hcengineering/presentation'
  import { type Issue, type IssueStatus, PdcaFrequency } from '@hcengineering/tracker'
  import { Button, Label, Toggle, DueDatePresenter } from '@hcengineering/ui'

  import tracker from '../../plugin'

  export let issue: Issue
  export let readonly = false

  const client = getClient()
  const query = createQuery()

  let statuses: IssueStatus[] = []

  $: query.query(tracker.class.IssueStatus, { attachedTo: issue.space }, (res) => {
    statuses = res
  })

  const frequencyOptions = [
    { value: PdcaFrequency.Weekly, label: tracker.string.PdcaCycleWeekly },
    { value: PdcaFrequency.Biweekly, label: tracker.string.PdcaCycleBiweekly },
    { value: PdcaFrequency.Monthly, label: tracker.string.PdcaCycleMonthly }
  ]

  async function toggleActive (val: boolean): Promise<void> {
    await client.update(issue, { pdcaCycleActive: val })
  }

  async function setFrequency (val: PdcaFrequency): Promise<void> {
    await client.update(issue, { pdcaCycleFrequency: val })
  }

  async function setResetStatus (val: Ref<IssueStatus>): Promise<void> {
    await client.update(issue, { pdcaCycleResetStatus: val === '' ? undefined : val as Ref<IssueStatus> })
  }

  function handleFrequencyChange (e: Event): void {
    void setFrequency((e.currentTarget as HTMLSelectElement).value as PdcaFrequency)
  }

  function handleResetStatusChange (e: Event): void {
    void setResetStatus((e.currentTarget as HTMLSelectElement).value as Ref<IssueStatus>)
  }

  $: isActive = issue.pdcaCycleActive === true
</script>

<span class="labelOnPanel">
  <Label label={tracker.string.PdcaCycleActive} />
</span>
<Toggle
  on={isActive}
  disabled={readonly}
  on:change={(e) => { void toggleActive(e.detail) }}
/>

{#if isActive}
  <span class="labelOnPanel">
    <Label label={tracker.string.PdcaCycleFrequency} />
  </span>
  <div class="pdca-select">
    <select
      class="antiSelect"
      disabled={readonly}
      value={issue.pdcaCycleFrequency ?? PdcaFrequency.Weekly}
      on:change={handleFrequencyChange}
    >
      {#each frequencyOptions as opt}
        <option value={opt.value}><Label label={opt.label} /></option>
      {/each}
    </select>
  </div>

  <span class="labelOnPanel">
    <Label label={tracker.string.PdcaCycleResetStatus} />
  </span>
  <div class="pdca-select">
    <select
      class="antiSelect"
      disabled={readonly}
      value={issue.pdcaCycleResetStatus ?? ''}
      on:change={handleResetStatusChange}
    >
      <option value="">—</option>
      {#each statuses as s}
        <option value={s._id}>{s.name}</option>
      {/each}
    </select>
  </div>

  {#if issue.pdcaNextCycleDate != null}
    <span class="labelOnPanel">
      <Label label={tracker.string.PdcaNextCycleDate} />
    </span>
    <DueDatePresenter
      kind={'link'}
      value={issue.pdcaNextCycleDate}
      editable={false}
      shouldIgnoreOverdue={true}
    />
  {/if}
{/if}

<style lang="scss">
  .pdca-select {
    width: 100%;
    select {
      width: 100%;
      padding: 0.25rem 0.5rem;
    }
  }
</style>
