<!--
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import contact, { type Person } from '@hcengineering/contact'
  import { PersonPresenter, UserBox } from '@hcengineering/contact-resources'
  import { type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { AutomationScript, ScriptExecution } from '@hcengineering/tracker'
  import {
    Breadcrumb,
    Button,
    EditBox,
    Header,
    IconAdd,
    IconChevronLeft,
    IconChevronRight,
    IconDelete,
    IconEdit,
    Label,
    showPopup
  } from '@hcengineering/ui'

  import tracker from '../../plugin'
  import EditAutomationScript from './EditAutomationScript.svelte'
  import RunAutomationScript from './RunAutomationScript.svelte'
  import ScriptExecutionTasksPopup from './ScriptExecutionTasksPopup.svelte'

  const PAGE_SIZE = 10

  let scripts: AutomationScript[] = []
  let executions: ScriptExecution[] = []

  const client = getClient()
  const scriptQuery = createQuery()
  const execQuery = createQuery()

  $: scriptQuery.query(
    tracker.class.AutomationScript,
    {},
    (res) => {
      scripts = res
    },
    { sort: { name: 1 } }
  )

  // Histórico global: todos os Maintainers veem todas as execuções, mais recentes primeiro.
  $: execQuery.query(
    tracker.class.ScriptExecution,
    {},
    (res) => {
      executions = res
    },
    { sort: { createdOn: -1 } }
  )

  // ─── Filtros (client-side) ─────────────────────────────────────────────────
  let filterClient = ''
  let filterScript = ''
  let filterPerson: Ref<Person> | null = null
  let filterFrom = ''
  let filterTo = ''
  let filterMinTasks: number | undefined

  let page = 0
  let prevFilterKey = ''
  let scriptPage = 0

  // ─── Paginação da lista de scripts ──────────────────────────────────────────
  $: scriptPageCount = Math.max(1, Math.ceil(scripts.length / PAGE_SIZE))
  $: if (scriptPage > scriptPageCount - 1) scriptPage = scriptPageCount - 1
  $: scriptPageItems = scripts.slice(scriptPage * PAGE_SIZE, scriptPage * PAGE_SIZE + PAGE_SIZE)

  function dayStart (s: string): number | undefined {
    if (s === '') return undefined
    const [y, m, d] = s.split('-').map(Number)
    if (y === undefined || m === undefined || d === undefined) return undefined
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  }

  function dayEnd (s: string): number | undefined {
    if (s === '') return undefined
    const [y, m, d] = s.split('-').map(Number)
    if (y === undefined || m === undefined || d === undefined) return undefined
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
  }

  function fmtDate (ts: number | undefined): string {
    if (ts === undefined) return '—'
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  $: filtered = executions.filter((e) => {
    const fc = filterClient.trim().toLowerCase()
    if (fc !== '' && !(e.clientName ?? '').toLowerCase().includes(fc)) return false
    const fs = filterScript.trim().toLowerCase()
    if (fs !== '' && !(e.scriptName ?? '').toLowerCase().includes(fs)) return false
    if (filterPerson != null && e.executedBy !== filterPerson) return false
    const ts = e.createdOn ?? e.modifiedOn
    const from = dayStart(filterFrom)
    if (from !== undefined && (ts ?? 0) < from) return false
    const to = dayEnd(filterTo)
    if (to !== undefined && (ts ?? 0) > to) return false
    if (filterMinTasks != null && (e.taskCount ?? 0) < filterMinTasks) return false
    return true
  })

  // Volta para a primeira página sempre que algum filtro muda.
  $: {
    const key = `${filterClient}|${filterScript}|${filterPerson ?? ''}|${filterFrom}|${filterTo}|${filterMinTasks ?? ''}`
    if (key !== prevFilterKey) {
      prevFilterKey = key
      page = 0
    }
  }

  $: pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  $: if (page > pageCount - 1) page = pageCount - 1
  $: pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  $: hasActiveFilters =
    filterClient !== '' ||
    filterScript !== '' ||
    filterPerson != null ||
    filterFrom !== '' ||
    filterTo !== '' ||
    filterMinTasks != null

  function clearFilters (): void {
    filterClient = ''
    filterScript = ''
    filterPerson = null
    filterFrom = ''
    filterTo = ''
    filterMinTasks = undefined
  }

  // ─── Ações ──────────────────────────────────────────────────────────────────
  function openNewScript (): void {
    showPopup(EditAutomationScript, {}, 'top')
  }

  function openEditScript (script: AutomationScript): void {
    showPopup(EditAutomationScript, { script }, 'top')
  }

  function openRunScript (script: AutomationScript): void {
    showPopup(RunAutomationScript, { scriptId: script._id }, 'top')
  }

  function openTasks (execution: ScriptExecution): void {
    showPopup(ScriptExecutionTasksPopup, { execution }, 'top')
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
        <Button label={tracker.string.NewScript} icon={IconAdd} kind="regular" size="small" on:click={openNewScript} />
      </div>

      {#if scripts.length === 0}
        <p class="empty-message">
          <Label label={tracker.string.NoCustomScripts} />
        </p>
      {:else}
        <ul class="script-list">
          {#each scriptPageItems as script (script._id)}
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

        {#if scriptPageCount > 1}
          <div class="pager">
            <Button
              icon={IconChevronLeft}
              kind="ghost"
              size="small"
              disabled={scriptPage === 0}
              on:click={() => (scriptPage = Math.max(0, scriptPage - 1))}
            />
            <span class="pager-label">
              <Label label={tracker.string.PageOf} params={{ current: scriptPage + 1, total: scriptPageCount }} />
            </span>
            <Button
              icon={IconChevronRight}
              kind="ghost"
              size="small"
              disabled={scriptPage >= scriptPageCount - 1}
              on:click={() => (scriptPage = Math.min(scriptPageCount - 1, scriptPage + 1))}
            />
          </div>
        {/if}
      {/if}
    </section>

    <div class="divider" />

    <section class="history-section">
      <div class="history-header">
        <h3 class="section-title"><Label label={tracker.string.ScriptExecutions} /></h3>
        {#if hasActiveFilters}
          <Button label={tracker.string.ClearFilters} kind="ghost" size="small" on:click={clearFilters} />
        {/if}
      </div>

      <div class="filters">
        <div class="filter-field">
          <EditBox bind:value={filterClient} placeholder={tracker.string.FilterByClient} kind="default" />
        </div>
        <div class="filter-field">
          <EditBox bind:value={filterScript} placeholder={tracker.string.FilterByScript} kind="default" />
        </div>
        <div class="filter-field">
          <UserBox
            _class={contact.class.Person}
            label={tracker.string.FilterByPerson}
            value={filterPerson}
            allowDeselect
            kind="regular"
            size="small"
            width="100%"
            on:change={(e) => (filterPerson = e.detail ?? null)}
          />
        </div>
        <div class="filter-field date">
          <span class="flt-label"><Label label={tracker.string.FilterDateFrom} /></span>
          <input type="date" bind:value={filterFrom} />
        </div>
        <div class="filter-field date">
          <span class="flt-label"><Label label={tracker.string.FilterDateTo} /></span>
          <input type="date" bind:value={filterTo} />
        </div>
        <div class="filter-field min">
          <span class="flt-label"><Label label={tracker.string.FilterMinTasks} /></span>
          <input type="number" min="0" bind:value={filterMinTasks} />
        </div>
      </div>

      {#if executions.length === 0}
        <p class="empty-history"><Label label={tracker.string.ScriptHistoryEmpty} /></p>
      {:else if filtered.length === 0}
        <p class="empty-history"><Label label={tracker.string.NoExecutionsMatch} /></p>
      {:else}
        <div class="exec-table">
          <div class="exec-head">
            <span><Label label={tracker.string.ExecutionDate} /></span>
            <span><Label label={tracker.string.ClientName} /></span>
            <span><Label label={tracker.string.ScriptLabel} /></span>
            <span><Label label={tracker.string.ScriptExecutedBy} /></span>
            <span class="num"><Label label={tracker.string.OnboardingTasksCount} /></span>
          </div>
          {#each pageItems as e (e._id)}
            <button class="exec-row" on:click={() => openTasks(e)}>
              <span class="col-date">{fmtDate(e.createdOn ?? e.modifiedOn)}</span>
              <span class="col-client">{e.clientName}</span>
              <span class="col-script">{e.scriptName}</span>
              <span class="col-who">
                <PersonPresenter value={e.executedBy} avatarSize="x-small" disabled />
              </span>
              <span class="col-tasks num">{e.taskCount ?? 0}</span>
            </button>
          {/each}
        </div>

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
    </section>
  </div>
</div>

<style lang="scss">
  .page-body {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
    max-width: 56rem;
    // Ocupa o espaço restante abaixo do Header e rola quando o conteúdo
    // (lista de scripts + histórico) ultrapassa a altura do painel.
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
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

  .custom-header,
  .history-header {
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

  /* ─── Filtros ─── */
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background-color: var(--theme-comp-header-color);
  }

  .filter-field {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 9rem;
    flex: 1 1 9rem;

    &.date,
    &.min {
      flex: 0 0 auto;
      min-width: 0;
    }
  }

  .flt-label {
    font-size: 0.6875rem;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .filter-field input[type='date'],
  .filter-field input[type='number'] {
    background-color: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    color: var(--theme-content-color);
    font-size: 0.8125rem;
    padding: 0.1875rem 0.375rem;
  }

  .filter-field input[type='number'] {
    width: 4rem;
  }

  /* ─── Tabela de execuções ─── */
  .exec-table {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .exec-head,
  .exec-row {
    display: grid;
    grid-template-columns: 6.5rem 1fr 1fr 11rem 5rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    text-align: left;
  }

  .exec-head {
    background-color: var(--theme-comp-header-color);
    border-bottom: 1px solid var(--theme-divider-color);

    span {
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--theme-dark-color);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  }

  .exec-row {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--theme-divider-color);
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--theme-content-color);

    &:last-child {
      border-bottom: none;
    }

    &:hover {
      background-color: var(--theme-button-hovered);
    }
  }

  .col-date {
    color: var(--theme-dark-color);
    font-variant-numeric: tabular-nums;
  }

  .col-client {
    font-weight: 500;
    color: var(--theme-caption-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-script {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-who {
    min-width: 0;
    overflow: hidden;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .empty-history {
    margin: 0;
    padding: 1rem;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.375rem;
    text-align: center;
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
