<!--
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import { Card, getClient } from '@hcengineering/presentation'
  import { type Issue, type ScriptExecution, trackerId } from '@hcengineering/tracker'
  import {
    Button,
    IconChevronLeft,
    IconChevronRight,
    Label,
    getCurrentResolvedLocation,
    navigate
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { generateIssuePanelUri } from '../../issues'
  import tracker from '../../plugin'

  export let execution: ScriptExecution

  const client = getClient()
  const dispatch = createEventDispatcher()
  const PAGE_SIZE = 10

  let page = 0
  let errorMsg = false

  $: tasks = execution.tasks ?? []
  $: pageCount = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))
  // Mantém a página dentro do intervalo válido se a lista mudar.
  $: if (page > pageCount - 1) page = pageCount - 1
  $: pageTasks = tasks.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  // Abre a tarefa diretamente na lista de tarefas do tracker (com o painel da issue).
  // Se a issue não existe mais (excluída), mostra aviso e mantém o popup aberto.
  async function openTask (id: Ref<Issue>): Promise<void> {
    errorMsg = false
    const issue = await client.findOne(tracker.class.Issue, { _id: id })
    if (issue === undefined) {
      errorMsg = true
      return
    }
    const loc = getCurrentResolvedLocation()
    loc.path[2] = trackerId
    loc.path[3] = issue.space
    loc.path[4] = 'issues'
    loc.path.length = 5
    loc.query = undefined
    loc.fragment = generateIssuePanelUri(issue)
    navigate(loc)
    dispatch('close')
  }
</script>

<Card
  label={tracker.string.ExecutionTasksTitle}
  okAction={async () => {}}
  canSave={false}
  hideFooter
  width="medium"
  on:close
  on:changeContent
>
  <div class="popup">
    <div class="popup-header">
      <span class="client">{execution.clientName}</span>
      <span class="sep">—</span>
      <span class="script">{execution.scriptName}</span>
      <span class="count">{tasks.length}</span>
    </div>

    {#if errorMsg}
      <p class="error"><Label label={tracker.string.IssueNoLongerExists} /></p>
    {/if}

    {#if tasks.length === 0}
      <p class="empty"><Label label={tracker.string.ScriptHistoryEmpty} /></p>
    {:else}
      <ul class="task-list">
        {#each pageTasks as t (t.id)}
          <li class="task-row">
            <button class="task-btn" on:click={() => openTask(t.id)}>
              <span class="task-id">{t.identifier}</span>
              <span class="task-title">{t.title}</span>
            </button>
          </li>
        {/each}
      </ul>

      {#if pageCount > 1}
        <div class="pager">
          <Button
            icon={IconChevronLeft}
            kind="ghost"
            size="small"
            disabled={page === 0}
            on:click={() => (page = Math.max(0, page - 1))}
          />
          <span class="pager-label">
            <Label label={tracker.string.PageOf} params={{ current: page + 1, total: pageCount }} />
          </span>
          <Button
            icon={IconChevronRight}
            kind="ghost"
            size="small"
            disabled={page >= pageCount - 1}
            on:click={() => (page = Math.min(pageCount - 1, page + 1))}
          />
        </div>
      {/if}
    {/if}
  </div>
</Card>

<style lang="scss">
  .popup {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.25rem 0.5rem 0.5rem;
    min-width: 28rem;
    max-width: 36rem;
  }

  .popup-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }

  .client {
    font-weight: 600;
    color: var(--theme-caption-color);
  }

  .sep {
    color: var(--theme-dark-color);
  }

  .script {
    color: var(--theme-content-color);
  }

  .count {
    margin-left: auto;
    background-color: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.6875rem;
    color: var(--theme-content-color);
  }

  .error {
    margin: 0;
    padding: 0.5rem 0.625rem;
    color: var(--theme-error-color, #b45309);
    background-color: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 0.375rem;
    font-size: 0.75rem;
  }

  .empty {
    margin: 0;
    padding: 0.75rem;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.375rem;
    text-align: center;
  }

  .task-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 24rem;
    overflow-y: auto;
  }

  .task-row {
    display: flex;
  }

  .task-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.375rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-size: 0.8125rem;
    color: var(--theme-content-color);

    &:hover {
      background-color: var(--theme-button-hovered);
      border-color: var(--theme-divider-color);
    }
  }

  .task-id {
    flex-shrink: 0;
    color: var(--theme-dark-color);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .task-title {
    color: var(--theme-caption-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
  }

  .pager-label {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    font-variant-numeric: tabular-nums;
  }
</style>
