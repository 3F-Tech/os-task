<!--
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering Inc.
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
  import presentation, { Card, createQuery, getClient } from '@hcengineering/presentation'
  import { Issue, Project } from '@hcengineering/tracker'
  import { Button, IconAdd, Label, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import tracker from '../../../plugin'
  import IssuePresenter from '../IssuePresenter.svelte'
  import EstimationStatsPresenter from './EstimationStatsPresenter.svelte'
  import EstimationValuePopup from './EstimationValuePopup.svelte'
  import SubIssuesEstimations from './SubIssuesEstimations.svelte'
  import TimeSpendReportPopup from './TimeSpendReportPopup.svelte'
  import TimeSpendReports from './TimeSpendReports.svelte'
  import TimePresenter from './TimePresenter.svelte'

  export let object: Issue

  $: _value = object.estimation

  const dispatch = createEventDispatcher()
  const client = getClient()

  $: childIds = Array.from((object.childInfo ?? []).map((it) => it.childId))

  const query = createQuery()

  let currentProject: Project | undefined

  $: query.query(
    object._class,
    { _id: object._id },
    (res) => {
      const r = res.shift()
      if (r !== undefined) {
        object = r
        currentProject = r.$lookup?.space
      }
    },
    {
      lookup: {
        space: tracker.class.Project
      }
    }
  )
  $: defaultTimeReportDay = currentProject?.defaultTimeReportDay

  function editEstimation (): void {
    showPopup(
      EstimationValuePopup,
      {
        value: object.estimation,
        issue: object,
        onChange: (res: number) => {
          if (_value !== res) {
            _value = res
            void client.update(object, { estimation: res })
            object.estimation = res
          }
        }
      },
      'top'
    )
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<Card
  label={tracker.string.Estimation}
  canSave={true}
  okAction={() => {
    dispatch('close')
  }}
  okLabel={presentation.string.Ok}
  gap={'gapV-4'}
  on:close={() => {
    dispatch('close', null)
  }}
  on:changeContent
>
  <svelte:fragment slot="title">
    <div class="flex-row-center">
      <Label label={tracker.string.Estimation} />
      <div
        class="ml-2 mr-4"
        on:click={editEstimation}
      >
        <EstimationStatsPresenter value={object} estimation={_value} />
      </div>
      <Label label={tracker.string.RemainingTime} />
      <div class="ml-2 mr-4">
        <TimePresenter value={object.remainingTime} />
      </div>
    </div>
  </svelte:fragment>

  <svelte:fragment slot="header">
    <IssuePresenter value={object} disabled />
  </svelte:fragment>

  {#if currentProject}
    <SubIssuesEstimations issue={object} />
  {/if}

  {#if currentProject}
    <TimeSpendReports issue={object} query={{ attachedTo: { $in: [object._id, ...childIds] } }} />
  {/if}
  <svelte:fragment slot="buttons">
    <Button
      icon={IconAdd}
      size={'large'}
      on:click={() => {
        showPopup(
          TimeSpendReportPopup,
          {
            issue: object,
            issueId: object._id,
            issueClass: object._class,
            space: object.space,
            assignee: object.assignee?.[0] ?? null,
            defaultTimeReportDay
          },
          'top'
        )
      }}
      label={tracker.string.TimeSpendReportAdd}
    />
  </svelte:fragment>
</Card>
