<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import { AttachedData, Class, Doc, Ref, WithLookup } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { getTaskTypeStates } from '@hcengineering/task'
  import task from '@hcengineering/task'
  import { taskTypeStore } from '@hcengineering/task-resources'
  import {
    CompletionRule,
    Issue,
    IssueCompletionConfig,
    IssueDraft,
    IssueStatus,
    Project,
    TrackerEvents
  } from '@hcengineering/tracker'
  import {
    Button,
    ButtonKind,
    ButtonSize,
    IconSize,
    SelectPopup,
    TooltipAlignment,
    eventToHTMLElement,
    showPopup
  } from '@hcengineering/ui'
  import { statusStore } from '@hcengineering/view-resources'
  import { Analytics } from '@hcengineering/analytics'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import CompletionBlockedNotification from './CompletionBlockedNotification.svelte'
  import IssueStatusIcon from './IssueStatusIcon.svelte'
  import StatusPresenter from './StatusPresenter.svelte'

  type ValueType = Issue | (AttachedData<Issue> & { space: Ref<Project> }) | IssueDraft

  export let value: ValueType

  let statuses: WithLookup<IssueStatus>[] | undefined = undefined

  export let isEditable: boolean = true
  export let shouldShowLabel: boolean = false
  export let tooltipAlignment: TooltipAlignment | undefined = undefined

  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'large'
  export let iconSize: IconSize = 'inline'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = undefined
  export let defaultIssueStatus: Ref<IssueStatus> | undefined = undefined
  export let focusIndex: number | undefined = undefined
  export let short: boolean = false

  const client = getClient()
  const dispatch = createEventDispatcher()

  type ViolationEntry = { labelId: string, params?: Record<string, any> }

  async function checkCompletionRules (
    issue: Issue,
    newStatusId: Ref<IssueStatus>
  ): Promise<ViolationEntry[]> {
    const newStatusObj = statuses?.find((s) => s._id === newStatusId)
    if (!newStatusObj || newStatusObj.category !== task.statusCategory.Won) return []

    const hierarchy = client.getHierarchy()
    const project = await client.findOne(tracker.class.Project, { _id: issue.space })
    if (!project) return []

    // Checagem específica para projeto TECH_: branch deve ter commits
    if (project.identifier === 'TECH_') {
      const GITHUB_BRANCH_REQUEST = 'github:class:GithubBranchRequest' as Ref<Class<Doc>>
      const branchRequests = await client.findAll(GITHUB_BRANCH_REQUEST as any, {
        issueId: issue._id,
        action: 'create',
        status: 'done'
      })
      if (branchRequests.length > 0 && !branchRequests.some((r: any) => r.hasCommits === true)) {
        return [{ labelId: 'github:string:BranchHasNoCommits' }]
      }
    }

    if (!hierarchy.hasMixin(project, tracker.mixin.IssueCompletionConfig)) return []

    const config = hierarchy.as<Project, IssueCompletionConfig>(project, tracker.mixin.IssueCompletionConfig)
    const isSubIssue = (issue.parents?.length ?? 0) > 0
    const rules: CompletionRule[] = (isSubIssue ? config.subIssueRules : config.issueRules) ?? []

    const violations: ViolationEntry[] = []
    for (const rule of rules.filter((r) => r.enabled)) {
      if (rule.key === 'spentTime' && (!issue.reportedTime || issue.reportedTime <= 0)) {
        violations.push({ labelId: tracker.string.MissingSpentTime })
      } else if (rule.key === 'estimation' && (!issue.estimation || issue.estimation <= 0)) {
        violations.push({ labelId: tracker.string.MissingEstimation })
      } else if (rule.key === 'allSubIssues' && (issue.subIssues as unknown as number) > 0) {
        const subIssues = await client.findAll(tracker.class.Issue, { attachedTo: issue._id as Ref<Issue> })
        const unresolved = subIssues.filter((s) => {
          const st = $statusStore.byId.get(s.status)
          return !st || st.category !== task.statusCategory.Won
        })
        if (unresolved.length > 0) {
          violations.push({ labelId: tracker.string.OpenSubtasksBlocking, params: { count: unresolved.length } })
        }
      } else if (rule.key === 'completedDate' && !(issue as any).completedDate) {
        violations.push({ labelId: tracker.string.MissingCompletedDate })
      }
    }
    return violations
  }

  const changeStatus = async (newStatus: Ref<IssueStatus> | undefined, refocus: boolean = true) => {
    if (!isEditable || newStatus == null || value.status === newStatus) {
      return
    }

    if ('_class' in value) {
      const violations = await checkCompletionRules(value as Issue, newStatus)
      if (violations.length > 0) {
        const isSubIssue = ((value as Issue).parents?.length ?? 0) > 0
        showPopup(CompletionBlockedNotification, { violations, isSubIssue }, 'centered')
        return
      }
    }

    dispatch('change', newStatus)
    if (refocus) {
      dispatch('refocus')
    }

    if ('_class' in value) {
      await client.update(value, { status: newStatus })
      Analytics.handleEvent(TrackerEvents.IssueSetStatus, {
        issue: (value as Issue).identifier,
        status: newStatus
      })
    }
  }

  const handleStatusEditorOpened = (event: MouseEvent) => {
    if (!isEditable) {
      return
    }

    showPopup(
      SelectPopup,
      { value: statusesInfo, placeholder: tracker.string.SetStatus },
      eventToHTMLElement(event),
      changeStatus
    )
  }

  $: statuses = getTaskTypeStates(value.kind, $taskTypeStore, $statusStore.byId)

  function getSelectedStatus (
    statuses: WithLookup<IssueStatus>[] | undefined,
    value: ValueType,
    defaultStatus: Ref<IssueStatus> | undefined
  ): WithLookup<IssueStatus> | undefined {
    if (value.status !== undefined) {
      const current = statuses?.find((status) => status._id === value.status)
      if (current != null) {
        return current
      }
    }

    if (defaultIssueStatus !== undefined) {
      const res = statuses?.find((status) => status._id === defaultStatus)
      // Might not exist for projects with multiple task types with different statuses
      if (res != null) {
        void changeStatus(res?._id, false)
        return res
      }
    }

    // We need to choose first one, since it should not be case without status.
    void changeStatus(statuses?.[0]?._id, false)
  }

  $: selectedStatus = getSelectedStatus(statuses, value, defaultIssueStatus)
  $: selectedStatusLabel = shouldShowLabel ? selectedStatus?.name : undefined
  $: statusesInfo = statuses?.map((s) => {
    return {
      id: s._id,
      component: StatusPresenter,
      props: { value: s, size: 'small', space: value.space },
      isSelected: selectedStatus?._id === s._id
    }
  })
  $: smallgap = size === 'inline' || size === 'small'
</script>

{#if value && statuses}
  {#if kind === 'list' || kind === 'list-header'}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="flex-row-center flex-no-shrink"
      class:fix-margin={kind === 'list'}
      class:cursor-pointer={isEditable}
      on:click={handleStatusEditorOpened}
    >
      <div class="flex-center flex-no-shrink square-4">
        {#if selectedStatus}<IssueStatusIcon
            value={selectedStatus}
            taskType={value.kind}
            size={kind === 'list' ? 'small' : 'medium'}
            space={value.space}
          />{/if}
      </div>
      {#if selectedStatusLabel}
        <span
          class="{kind === 'list' ? 'ml-1 text-md' : 'ml-2 text-base'} overflow-label disabled content-color"
          class:max-w-20={short}
        >
          {selectedStatusLabel}
        </span>
      {/if}
    </div>
  {:else}
    <Button
      showTooltip={isEditable ? { label: tracker.string.SetStatus, direction: tooltipAlignment } : undefined}
      disabled={!isEditable}
      {justify}
      {size}
      {kind}
      {width}
      {focusIndex}
      {short}
      on:click={handleStatusEditorOpened}
    >
      <svelte:fragment slot="icon">
        {#if selectedStatus}
          <IssueStatusIcon value={selectedStatus} taskType={value.kind} size={iconSize} space={value.space} />
        {/if}
      </svelte:fragment>
      <svelte:fragment slot="content">
        {#if selectedStatusLabel}
          <span
            class="overflow-label disabled"
            class:ml-1-5={selectedStatus && smallgap}
            class:ml-2={selectedStatus && !smallgap}
          >
            {selectedStatusLabel}
          </span>
        {/if}
      </svelte:fragment>
    </Button>
  {/if}
{/if}
