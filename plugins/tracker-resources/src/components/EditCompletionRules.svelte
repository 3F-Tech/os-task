<!--
// Copyright © 2024 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import { type Ref, type Space } from '@hcengineering/core'
  import { SpaceSelector, createQuery, getClient } from '@hcengineering/presentation'
  import { type CompletionRule, type IssueCompletionConfig, type Project } from '@hcengineering/tracker'
  import { Label, Toggle } from '@hcengineering/ui'
  import tracker from '../plugin'

  export let value: Space | undefined

  const client = getClient()
  const hierarchy = client.getHierarchy()

  type RuleEntry = { key: string; labelId: string; enabled: boolean }

  const ISSUE_KEYS: RuleEntry[] = [
    { key: 'spentTime',     labelId: tracker.string.CompletionRuleSpentTime,    enabled: false },
    { key: 'estimation',    labelId: tracker.string.CompletionRuleEstimation,   enabled: false },
    { key: 'allSubIssues',  labelId: tracker.string.CompletionRuleAllSubIssues, enabled: false },
    { key: 'completedDate', labelId: tracker.string.CompletionRuleCompletedDate, enabled: false }
  ]

  const SUBISSUE_KEYS: RuleEntry[] = [
    { key: 'spentTime',     labelId: tracker.string.CompletionRuleSpentTime,    enabled: false },
    { key: 'estimation',    labelId: tracker.string.CompletionRuleEstimation,   enabled: false },
    { key: 'completedDate', labelId: tracker.string.CompletionRuleCompletedDate, enabled: false }
  ]

  let issueEntries: RuleEntry[] = [...ISSUE_KEYS]
  let subIssueEntries: RuleEntry[] = [...SUBISSUE_KEYS]

  let selectedSpaceId: Ref<Space> | undefined = value?._id
  let selectedProject: Project | undefined

  // Sync parent prop into selectedSpaceId
  $: if (value) selectedSpaceId = value._id

  const projectQuery = createQuery()
  $: if (selectedSpaceId) {
    projectQuery.query(
      tracker.class.Project,
      { _id: selectedSpaceId as Ref<Project> },
      (res) => { selectedProject = res[0] ?? undefined }
    )
  } else {
    selectedProject = undefined
  }

  $: if (selectedProject) {
    if (hierarchy.hasMixin(selectedProject, tracker.mixin.IssueCompletionConfig)) {
      const config = hierarchy.as<Space, IssueCompletionConfig>(selectedProject, tracker.mixin.IssueCompletionConfig)
      issueEntries = ISSUE_KEYS.map((entry) => {
        const saved = config.issueRules?.find((r) => r.key === entry.key)
        return { ...entry, enabled: saved?.enabled ?? false }
      })
      subIssueEntries = SUBISSUE_KEYS.map((entry) => {
        const saved = config.subIssueRules?.find((r) => r.key === entry.key)
        return { ...entry, enabled: saved?.enabled ?? false }
      })
    } else {
      issueEntries = [...ISSUE_KEYS]
      subIssueEntries = [...SUBISSUE_KEYS]
    }
  } else {
    issueEntries = [...ISSUE_KEYS]
    subIssueEntries = [...SUBISSUE_KEYS]
  }

  async function saveRules (
    field: 'issueRules' | 'subIssueRules',
    entries: RuleEntry[]
  ): Promise<void> {
    if (!selectedProject) return
    const rules: CompletionRule[] = entries.map((e) => ({ key: e.key, enabled: e.enabled }))
    if (hierarchy.hasMixin(selectedProject, tracker.mixin.IssueCompletionConfig)) {
      await client.updateMixin(
        selectedProject._id,
        tracker.class.Project,
        selectedProject.space,
        tracker.mixin.IssueCompletionConfig,
        { [field]: rules }
      )
    } else {
      const issueRules: CompletionRule[] = issueEntries.map((e) => ({ key: e.key, enabled: e.enabled }))
      const subIssueRules: CompletionRule[] = subIssueEntries.map((e) => ({ key: e.key, enabled: e.enabled }))
      await client.createMixin(
        selectedProject._id,
        tracker.class.Project,
        selectedProject.space,
        tracker.mixin.IssueCompletionConfig,
        { issueRules, subIssueRules }
      )
    }
  }

  async function toggleIssueRule (key: string): Promise<void> {
    issueEntries = issueEntries.map((e) => (e.key === key ? { ...e, enabled: !e.enabled } : e))
    await saveRules('issueRules', issueEntries)
  }

  async function toggleSubIssueRule (key: string): Promise<void> {
    subIssueEntries = subIssueEntries.map((e) => (e.key === key ? { ...e, enabled: !e.enabled } : e))
    await saveRules('subIssueRules', subIssueEntries)
  }
</script>

<div class="completion-rules">
  {#if !value}
    <div class="project-selector">
      <SpaceSelector
        _class={tracker.class.Project}
        bind:space={selectedSpaceId}
        label={tracker.string.Project}
        kind={'regular'}
        size={'medium'}
      />
    </div>
  {/if}

  {#if selectedProject}
    <section class="rules-section">
      <h3 class="section-title"><Label label={tracker.string.CompletionRules} /></h3>
      <div class="rules-list">
        {#each issueEntries as entry (entry.key)}
          <div class="rule-row">
            <Label label={entry.labelId} />
            <Toggle
              on={entry.enabled}
              on:change={() => toggleIssueRule(entry.key)}
            />
          </div>
        {/each}
      </div>
    </section>

    <div class="divider" />

    <section class="rules-section">
      <h3 class="section-title"><Label label={tracker.string.SubIssueCompletionRules} /></h3>
      <div class="rules-list">
        {#each subIssueEntries as entry (entry.key)}
          <div class="rule-row">
            <Label label={entry.labelId} />
            <Toggle
              on={entry.enabled}
              on:change={() => toggleSubIssueRule(entry.key)}
            />
          </div>
        {/each}
      </div>
    </section>
  {:else if !value}
    <p class="no-project"><Label label={tracker.string.AllProjects} /></p>
  {/if}
</div>

<style lang="scss">
  .completion-rules {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
    max-width: 36rem;
  }

  .project-selector {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .rules-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--theme-caption-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .rules-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .rule-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: var(--theme-content-color);

    &:hover {
      background-color: var(--theme-button-hovered);
    }
  }

  .divider {
    height: 1px;
    background-color: var(--theme-divider-color);
  }

  .no-project {
    color: var(--theme-dark-color);
    font-size: 0.875rem;
  }
</style>
