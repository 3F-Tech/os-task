<!--
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { AutomationScript } from '@hcengineering/tracker'
  import { Breadcrumb, Button, Header, IconAdd, IconDelete, IconEdit, Label, showPopup } from '@hcengineering/ui'

  import tracker from '../../plugin'
  import EditAutomationScript from './EditAutomationScript.svelte'
  import RunAutomationScript from './RunAutomationScript.svelte'

  interface HistoryEntry {
    date: string
    label: string
    detail?: string
    count: number
  }

  let historico: HistoryEntry[] = []
  let scripts: AutomationScript[] = []

  const scriptQuery = createQuery()
  $: scriptQuery.query(
    tracker.class.AutomationScript,
    {},
    (res) => {
      scripts = res
    },
    { sort: { name: 1 } }
  )

  const client = getClient()

  function formatDate (): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function openNewScript (): void {
    showPopup(EditAutomationScript, {}, 'top')
  }

  function openEditScript (script: AutomationScript): void {
    showPopup(EditAutomationScript, { script }, 'top')
  }

  function openRunScript (script: AutomationScript): void {
    showPopup(
      RunAutomationScript,
      {
        scriptId: script._id,
        onComplete: (entry: { scriptName: string, clientName: string, count: number }) => {
          historico = [
            {
              date: formatDate(),
              label: entry.clientName,
              detail: entry.scriptName,
              count: entry.count
            },
            ...historico
          ]
        }
      },
      'top'
    )
  }

  async function deleteScript (script: AutomationScript): Promise<void> {
    if (!window.confirm(`${script.name}\n\nExcluir este script e todas as suas etapas?`)) return
    const steps = await client.findAll(tracker.class.AutomationScriptStep, { attachedTo: script._id })
    for (const step of steps) {
      await client.removeCollection(
        tracker.class.AutomationScriptStep,
        step.space,
        step._id,
        script._id,
        tracker.class.AutomationScript,
        'steps'
      )
    }
    await client.removeDoc(tracker.class.AutomationScript, script.space, script._id)
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={tracker.icon.Issue} label={tracker.string.AutomationScripts} size={'large'} isCurrent />
  </Header>

  <div class="page-body">
    <p class="page-description">
      <Label label={tracker.string.AutomationScriptsDescription} />
    </p>

    <section class="custom-section">
      <div class="custom-header">
        <h3 class="section-title"><Label label={tracker.string.CustomScripts} /></h3>
        <Button
          label={tracker.string.NewScript}
          icon={IconAdd}
          kind="regular"
          size="small"
          on:click={openNewScript}
        />
      </div>

      {#if scripts.length === 0}
        <p class="empty-message">
          <Label label={tracker.string.NoCustomScripts} />
        </p>
      {:else}
        <ul class="script-list">
          {#each scripts as script (script._id)}
            <li class="script-row">
              <div class="script-row-info">
                <span class="script-row-name">{script.name}</span>
                {#if script.description !== undefined && script.description !== ''}
                  <span class="script-row-desc">{script.description}</span>
                {/if}
                <span class="script-row-meta">
                  <Label label={tracker.string.ScriptStepsCount} params={{ count: script.steps ?? 0 }} />
                </span>
              </div>
              <div class="script-row-actions">
                <Button
                  label={tracker.string.RunScript}
                  kind="primary"
                  size="small"
                  disabled={(script.steps ?? 0) === 0}
                  on:click={() => openRunScript(script)}
                />
                <Button
                  icon={IconEdit}
                  kind="ghost"
                  size="small"
                  showTooltip={{ label: tracker.string.EditScript }}
                  on:click={() => openEditScript(script)}
                />
                <Button
                  icon={IconDelete}
                  kind="ghost"
                  size="small"
                  showTooltip={{ label: tracker.string.DeleteScript }}
                  on:click={() => deleteScript(script)}
                />
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <div class="divider" />

    <section class="history-section">
      <h3 class="section-title"><Label label={tracker.string.OnboardingHistorySession} /></h3>
      {#if historico.length === 0}
        <p class="empty-history">
          <Label label={tracker.string.OnboardingHistoryEmpty} />
        </p>
      {:else}
        <ul class="history-list">
          {#each historico as entry, i (i)}
            <li class="history-row">
              <span class="history-icon">✅</span>
              <span class="history-date">{entry.date}</span>
              <span class="history-client">{entry.label}</span>
              {#if entry.detail !== undefined}
                <span class="history-sep">—</span>
                <span class="history-bu">{entry.detail}</span>
              {/if}
              <span class="history-count">
                {entry.count}
                <Label label={tracker.string.OnboardingTasksCount} />
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>

<style lang="scss">
  .page-body {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
    max-width: 48rem;
  }

  .page-description {
    margin: 0;
    color: var(--theme-dark-color);
    font-size: 0.875rem;
  }

  .custom-section,
  .history-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .custom-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .section-title {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--theme-caption-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .divider {
    height: 1px;
    background-color: var(--theme-divider-color);
  }

  .empty-message {
    margin: 0;
    padding: 1rem;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.375rem;
    text-align: center;
  }

  .script-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .script-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background-color: var(--theme-comp-header-color);
  }

  .script-row-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    flex: 1;
    min-width: 0;
  }

  .script-row-name {
    font-weight: 500;
    color: var(--theme-caption-color);
    font-size: 0.875rem;
  }

  .script-row-desc {
    color: var(--theme-content-color);
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .script-row-meta {
    color: var(--theme-dark-color);
    font-size: 0.75rem;
  }

  .script-row-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .empty-history {
    margin: 0;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
  }

  .history-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .history-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);

    &:hover {
      background-color: var(--theme-button-hovered);
    }
  }

  .history-icon {
    flex-shrink: 0;
  }

  .history-date {
    color: var(--theme-dark-color);
    font-variant-numeric: tabular-nums;
  }

  .history-client {
    font-weight: 500;
    color: var(--theme-caption-color);
  }

  .history-sep {
    color: var(--theme-dark-color);
  }

  .history-bu {
    color: var(--theme-content-color);
  }

  .history-count {
    margin-left: auto;
    color: var(--theme-dark-color);
    font-variant-numeric: tabular-nums;
  }
</style>
