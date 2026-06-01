<!--
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import type { Person } from '@hcengineering/contact'
  import { AssigneeBox } from '@hcengineering/contact-resources'
  import { type Ref } from '@hcengineering/core'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import tags, { type TagElement } from '@hcengineering/tags'
  import task from '@hcengineering/task'
  import type {
    AutomationScript,
    AutomationScriptStep,
    Issue,
    IssueTemplate,
    PdcaFrequency,
    Project
  } from '@hcengineering/tracker'
  import { Button, CheckBox, EditBox, Label } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'

  import tracker from '../../plugin'

  export let scriptId: Ref<AutomationScript>
  export let onComplete: (entry: { scriptName: string, clientName: string, count: number }) => void = () => {}

  const client = getClient()
  const dispatch = createEventDispatcher()

  let script: AutomationScript | undefined
  let steps: AutomationScriptStep[] = []
  let templatesById = new Map<Ref<IssueTemplate>, IssueTemplate>()
  let projectsById = new Map<Ref<Project>, Project>()
  let labelsById = new Map<Ref<TagElement>, TagElement>()
  let loaded = false

  let clientName = ''
  let activeVariants = new Set<string>()
  let labelAssignees: Record<string, Ref<Person> | null> = {}
  let executando = false
  let concluido = false
  let progresso: Array<{ label: string, ok: boolean }> = []

  // ─── Carregamento inicial (uma única vez no mount) ──────────────────────────
  onMount(async () => {
    if (scriptId === undefined) {
      loaded = true
      return
    }
    try {
      script = await client.findOne(tracker.class.AutomationScript, { _id: scriptId })
      if (script === undefined) {
        loaded = true
        return
      }
      const foundSteps = await client.findAll(
        tracker.class.AutomationScriptStep,
        { attachedTo: scriptId },
        { sort: { order: 1 } }
      )
      const templateIds = Array.from(new Set(foundSteps.map((s) => s.template)))
      const projectIds = Array.from(new Set(foundSteps.map((s) => s.project)))
      if (templateIds.length > 0) {
        const fetched = await client.findAll(tracker.class.IssueTemplate, { _id: { $in: templateIds } })
        templatesById = new Map(fetched.map((t) => [t._id, t]))
      }
      if (projectIds.length > 0) {
        const fetched = await client.findAll(tracker.class.Project, { _id: { $in: projectIds } })
        projectsById = new Map(fetched.map((p) => [p._id, p]))
      }
      // Coleta TODAS as labels referenciadas pelos templates (incluindo dos children)
      const labelIds = new Set<Ref<TagElement>>()
      for (const tpl of templatesById.values()) {
        for (const labelId of ((tpl as any).labels ?? []) as Ref<TagElement>[]) {
          labelIds.add(labelId)
        }
        for (const child of ((tpl as any).children ?? []) as Array<{ labels?: Ref<TagElement>[] }>) {
          for (const labelId of child.labels ?? []) {
            labelIds.add(labelId)
          }
        }
      }
      if (labelIds.size > 0) {
        const fetchedLabels = await client.findAll(tags.class.TagElement, { _id: { $in: Array.from(labelIds) } })
        labelsById = new Map(fetchedLabels.map((l) => [l._id, l]))
      }
      steps = foundSteps as AutomationScriptStep[]
    } catch (err) {
      console.error('RunAutomationScript load failed:', err)
    } finally {
      loaded = true
    }
  })

  // ─── Filtragem por variantes ────────────────────────────────────────────────
  $: filteredSteps = steps.filter((s) => {
    const all = (s.requireAll ?? []).every((v) => activeVariants.has(v))
    const none = !(s.requireNone ?? []).some((v) => activeVariants.has(v))
    return all && none
  })

  // ─── Labels únicas usadas pelos templates dos steps filtrados ───────────────
  $: labelsInUse = ((): TagElement[] => {
    const ids = new Set<Ref<TagElement>>()
    for (const step of filteredSteps) {
      const tpl = templatesById.get(step.template)
      if (tpl === undefined) continue
      for (const labelId of ((tpl as any).labels ?? []) as Ref<TagElement>[]) {
        ids.add(labelId)
      }
      for (const child of ((tpl as any).children ?? []) as Array<{ labels?: Ref<TagElement>[] }>) {
        for (const labelId of child.labels ?? []) {
          ids.add(labelId)
        }
      }
    }
    const arr: TagElement[] = []
    for (const id of ids) {
      const tag = labelsById.get(id)
      if (tag !== undefined) arr.push(tag)
    }
    return arr.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
  })()

  $: canStart = !executando && !concluido && clientName.trim().length > 0 && filteredSteps.length > 0

  // Para uma lista de labels de uma tarefa, retorna:
  // - assignee: o da PRIMEIRA label com mapping (a regra escolhida)
  // - conflict: true se >=2 labels têm mappings para pessoas diferentes
  function resolveAssignee (labels: Ref<TagElement>[] | undefined): {
    assignee: Ref<Person> | null
    conflict: boolean
  } {
    if (labels === undefined) return { assignee: null, conflict: false }
    let assignee: Ref<Person> | null = null
    let conflict = false
    for (const labelId of labels) {
      const a = labelAssignees[labelId as unknown as string]
      if (a !== undefined && a !== null) {
        if (assignee === null) {
          assignee = a
        } else if (a !== assignee) {
          conflict = true
        }
      }
    }
    return { assignee, conflict }
  }

  function pickAssignee (labels: Ref<TagElement>[] | undefined): Ref<Person> | null {
    return resolveAssignee(labels).assignee
  }

  // Para um step do preview, indica se a tarefa raiz OU algum child tem múltiplas
  // labels mapeadas que apontam para assignees diferentes.
  function stepHasConflict (step: AutomationScriptStep): boolean {
    const tpl = templatesById.get(step.template)
    if (tpl === undefined) return false
    const tplLabels = ((tpl as any).labels ?? []) as Ref<TagElement>[]
    if (resolveAssignee(tplLabels).conflict) return true
    const children = ((tpl as any).children ?? []) as Array<{ labels?: Ref<TagElement>[] }>
    for (const child of children) {
      if (resolveAssignee(child.labels).conflict) return true
    }
    return false
  }

  function tagBackground (tag: TagElement): string {
    const c = (tag as any).color
    if (typeof c === 'number' && c >= 0) {
      return `#${(c >>> 0).toString(16).padStart(6, '0')}`
    }
    return 'var(--theme-button-default)'
  }

  function getAssigneeForLabel (tag: TagElement): Ref<Person> | null {
    return labelAssignees[tag._id as unknown as string] ?? null
  }

  function setAssigneeForLabel (tag: TagElement, val: Ref<Person> | null): void {
    const next = { ...labelAssignees }
    next[tag._id as unknown as string] = val
    labelAssignees = next
  }

  function toggleVariant (v: string): void {
    const next = new Set(activeVariants)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    activeVariants = next
  }

  function cancel (): void {
    dispatch('close')
  }

  // ─── PDCA: data do ciclo *atual* (idêntica ao modal legado) ─────────────────
  function calculateCurrentCycleDueDate (
    frequency: PdcaFrequency | undefined,
    dueDays: number[] | undefined
  ): number | null {
    if (frequency === undefined || dueDays === undefined || dueDays.length === 0) return null
    const now = new Date()

    if (frequency === 'weekly') {
      const targetWeekday = dueDays[0]
      const diff = targetWeekday - now.getDay()
      const due = new Date(now)
      due.setDate(now.getDate() + diff)
      due.setHours(23, 59, 0, 0)
      return due.getTime()
    }

    if (frequency === 'monthly' || frequency === 'quarterly') {
      const targetDay = dueDays[0]
      return new Date(now.getFullYear(), now.getMonth(), targetDay, 23, 59, 0, 0).getTime()
    }

    if (frequency === 'biweekly') {
      const sorted = [...dueDays].sort((a, b) => a - b)
      const todayDay = now.getDate()
      const past = [...sorted].reverse().find((d) => d <= todayDay)
      const target = past ?? sorted[0]
      return new Date(now.getFullYear(), now.getMonth(), target, 23, 59, 0, 0).getTime()
    }

    return null
  }

  // ─── Execução ───────────────────────────────────────────────────────────────
  async function execute (): Promise<void> {
    if (!canStart || script === undefined) return
    executando = true
    progresso = []

    const tagElements = await client.findAll(tags.class.TagElement, {})
    const tagCache = new Map<string, { title: string, color?: number }>()
    for (const tag of tagElements) {
      tagCache.set(tag._id as unknown as string, { title: tag.title ?? '', color: (tag as any).color })
    }

    const kindCache = new Map<string, string>()
    const cliente = clientName.trim()
    let sucessos = 0

    for (const step of filteredSteps) {
      const projeto = projectsById.get(step.project)
      if (projeto === undefined) {
        progresso = [...progresso, { label: `Projeto não encontrado: ${step.project}`, ok: false }]
        continue
      }
      const template = templatesById.get(step.template)
      if (template === undefined) {
        progresso = [...progresso, { label: `Template não encontrado: ${step.template}`, ok: false }]
        continue
      }

      const projetoIdStr = step.project as unknown as string
      if (!kindCache.has(projetoIdStr)) {
        const kindDoTemplate = (template as any).kind
        if (kindDoTemplate !== undefined && kindDoTemplate !== null) {
          kindCache.set(projetoIdStr, kindDoTemplate)
        } else {
          const issueExistente = await client.findOne(tracker.class.Issue, { space: step.project })
          if (issueExistente?.kind !== undefined && issueExistente.kind !== null) {
            kindCache.set(projetoIdStr, issueExistente.kind as unknown as string)
          } else {
            const taskTypes = await client.findAll(task.class.TaskType, {
              parent: (projeto as any).type
            })
            if (taskTypes.length > 0) {
              kindCache.set(projetoIdStr, taskTypes[0]._id as unknown as string)
            }
          }
        }
      }
      const kind = kindCache.get(projetoIdStr)

      const inc = await client.updateDoc(
        tracker.class.Project,
        'space:class:Space' as any,
        step.project,
        { $inc: { sequence: 1 } } as any,
        true
      )
      const number = (inc as any).object.sequence as number
      const identifier = `${projeto.identifier}-${number}`

      const pdcaActive = (template as any).pdcaCycleActive === true
      const pdcaFrequency = (template as any).pdcaCycleFrequency
      const pdcaDueDays = (template as any).pdcaCycleDueDays
      const pdcaDueDate = pdcaActive ? calculateCurrentCycleDueDate(pdcaFrequency, pdcaDueDays) : null
      // dueInDays do step sobrescreve o cálculo PDCA (admin definiu explicitamente)
      const dueDateFromStep =
        step.dueInDays !== undefined && step.dueInDays >= 0
          ? Date.now() + step.dueInDays * 86_400_000
          : null
      const finalDueDate = dueDateFromStep ?? pdcaDueDate
      const clientStage = (template as any).clientStage ?? 'onboarding'

      const tplLabels = ((template as any).labels ?? []) as Ref<TagElement>[]
      const tplAssignee = pickAssignee(tplLabels) ?? (template as any).assignee ?? null

      const tarefaId = await client.addCollection(
        tracker.class.Issue,
        step.project,
        tracker.ids.NoParent,
        tracker.class.Issue,
        'subIssues',
        {
          title: template.title,
          identifier,
          number,
          rank: '0|hzzzzz:',
          priority: template.priority ?? 0,
          kind: kind as any,
          status: ((template as any).status ?? projeto.defaultIssueStatus) as any,
          estimation: (template as any).estimation ?? 0,
          assignee: tplAssignee,
          clientName: cliente,
          clientStage,
          pdcaCycleActive: pdcaActive,
          pdcaCycleFrequency: pdcaFrequency,
          pdcaCycleDueDays: pdcaDueDays,
          pdcaCycleResetStatus: (template as any).pdcaCycleResetStatus,
          dueDate: finalDueDate,
          template: { template: step.template }
        } as any
      )

      for (const labelId of (template as any).labels ?? []) {
        const tagInfo = tagCache.get(labelId as string) ?? { title: '' }
        await client.addCollection(
          tags.class.TagReference,
          step.project,
          tarefaId as unknown as Ref<Issue>,
          tracker.class.Issue,
          'labels',
          { tag: labelId, title: tagInfo.title, color: tagInfo.color } as any
        )
      }

      for (const child of (template as any).children ?? []) {
        const subInc = await client.updateDoc(
          tracker.class.Project,
          'space:class:Space' as any,
          step.project,
          { $inc: { sequence: 1 } } as any,
          true
        )
        const subNumber = (subInc as any).object.sequence as number
        const subIdentifier = `${projeto.identifier}-${subNumber}`

        const childLabels = (child.labels ?? []) as Ref<TagElement>[]
        const childAssignee = pickAssignee(childLabels) ?? child.assignee ?? null
        const childId = (child as any).id as string | undefined
        const childDueDays = childId !== undefined ? step.childDueInDays?.[childId] : undefined
        const childDueDate =
          childDueDays !== undefined && childDueDays >= 0
            ? Date.now() + childDueDays * 86_400_000
            : null

        const subId = await client.addCollection(
          tracker.class.Issue,
          step.project,
          tarefaId as unknown as Ref<Issue>,
          tracker.class.Issue,
          'subIssues',
          {
            title: child.title,
            identifier: subIdentifier,
            number: subNumber,
            rank: '0|hzzzzz:',
            priority: child.priority ?? 0,
            kind: (child.kind ?? kind) as any,
            status: (child.status ?? projeto.defaultIssueStatus) as any,
            estimation: child.estimation ?? 0,
            assignee: childAssignee,
            clientName: cliente,
            clientStage,
            dueDate: childDueDate
          } as any
        )

        for (const labelId of child.labels ?? []) {
          const tagInfo = tagCache.get(labelId as string) ?? { title: '' }
          await client.addCollection(
            tags.class.TagReference,
            step.project,
            subId as unknown as Ref<Issue>,
            tracker.class.Issue,
            'labels',
            { tag: labelId, title: tagInfo.title, color: tagInfo.color } as any
          )
        }
      }

      progresso = [...progresso, { label: `${identifier} — ${template.title}`, ok: true }]
      sucessos++
    }

    executando = false
    concluido = true
    onComplete({
      scriptName: script.name,
      clientName: cliente,
      count: sucessos
    })
  }

  $: variantOptions = script?.variantOptions ?? []
</script>

<Card
  label={tracker.string.RunAutomationScript}
  okAction={async () => {}}
  canSave={false}
  hideFooter
  width="medium"
  on:close
  on:changeContent
>
  <div class="runner">
    {#if !loaded}
      <p class="muted">Carregando...</p>
    {:else if script === undefined}
      <p class="muted">Script não encontrado.</p>
    {:else}
      <div class="script-header">
        <h3 class="script-name">{script.name}</h3>
        {#if script.description !== undefined && script.description !== ''}
          <p class="script-desc">{script.description}</p>
        {/if}
      </div>

      {#if !concluido}
        <section class="form-section">
          <h4 class="section-title"><Label label={tracker.string.ClientName} /></h4>
          <EditBox bind:value={clientName} placeholder={tracker.string.ClientNamePlaceholder} kind="default" />
        </section>

        {#if variantOptions.length > 0}
          <section class="form-section">
            <h4 class="section-title"><Label label={tracker.string.SelectVariantOptions} /></h4>
            <div class="variant-row">
              {#each variantOptions as v (v)}
                <label class="variant-toggle">
                  <CheckBox
                    checked={activeVariants.has(v)}
                    on:value={() => toggleVariant(v)}
                  />
                  <span>{v}</span>
                </label>
              {/each}
            </div>
          </section>
        {/if}

        <section class="form-section">
          <h4 class="section-title">
            <Label label={tracker.string.AssigneeByLabel} />
            <span class="hint"><Label label={tracker.string.AssigneeByLabelHint} /></span>
          </h4>
          {#if labelsInUse.length === 0}
            <p class="empty"><Label label={tracker.string.NoLabelsInScript} /></p>
          {:else}
            <ul class="label-assignee-list">
              {#each labelsInUse as tag (tag._id)}
                <li class="label-assignee-row">
                  <span class="label-chip" style:background-color={tagBackground(tag)}>
                    {tag.title}
                  </span>
                  <div class="label-assignee-picker">
                    <AssigneeBox
                      label={tracker.string.AssigneeByLabel}
                      placeholder={tracker.string.LabelNoAssignee}
                      value={getAssigneeForLabel(tag)}
                      kind="regular"
                      size="small"
                      width="100%"
                      justify="left"
                      showNavigate={false}
                      on:change={(e) => setAssigneeForLabel(tag, e.detail ?? null)}
                    />
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="form-section">
          <h4 class="section-title">
            <Label label={tracker.string.StepsThatWillRun} />
            <span class="count-badge">{filteredSteps.length}</span>
          </h4>
          {#if filteredSteps.length === 0}
            <p class="empty"><Label label={tracker.string.NoStepsForVariants} /></p>
          {:else}
            <ul class="preview-list">
              {#each filteredSteps as step (step._id)}
                {@const template = templatesById.get(step.template)}
                {@const projeto = projectsById.get(step.project)}
                {@const hasConflict = stepHasConflict(step)}
                <li class="preview-row" class:warn={hasConflict}>
                  {#if hasConflict}
                    <span class="warn-icon" title="Múltiplas etiquetas com responsável — será usado o da primeira etiqueta">⚠</span>
                  {/if}
                  <span class="preview-title">{template?.title ?? '(template ausente)'}</span>
                  <span class="preview-project">{projeto?.name ?? '(projeto ausente)'}</span>
                </li>
              {/each}
            </ul>
            {#if filteredSteps.some(stepHasConflict)}
              <p class="warn-note">
                ⚠ <Label label={tracker.string.MultipleLabelsTooltip} />
              </p>
            {/if}
          {/if}
        </section>
      {/if}

      {#if progresso.length > 0}
        <section class="form-section">
          <h4 class="section-title"><Label label={tracker.string.OnboardingProgress} /></h4>
          <ul class="progress-list">
            {#each progresso as item, i (i)}
              <li class="progress-row" class:error={!item.ok}>
                <span class="progress-icon">{item.ok ? '✅' : '⚠️'}</span>
                <span class="progress-label">{item.label}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if concluido}
        <section class="form-section">
          <p class="success-message"><Label label={tracker.string.OnboardingSuccess} /></p>
        </section>
      {/if}

      <div class="footer">
        {#if !concluido}
          <Button
            label={presentation.string.Cancel}
            kind="regular"
            size="medium"
            on:click={cancel}
            disabled={executando}
          />
          <Button
            label={tracker.string.RunScript}
            kind="primary"
            size="medium"
            disabled={!canStart}
            loading={executando}
            on:click={execute}
          />
        {:else}
          <Button label={presentation.string.Close} kind="primary" size="medium" on:click={cancel} />
        {/if}
      </div>
    {/if}
  </div>
</Card>

<style lang="scss">
  .runner {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.25rem 0.5rem 0.5rem;
    min-width: 28rem;
    max-width: 40rem;
  }

  .muted {
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
    margin: 0;
  }

  .script-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .script-name {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }

  .script-desc {
    margin: 0;
    color: var(--theme-content-color);
    font-size: 0.8125rem;
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .section-title {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--theme-caption-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .count-badge {
    background-color: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.6875rem;
    color: var(--theme-content-color);
  }

  .variant-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
  }

  .variant-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
    cursor: pointer;
  }

  .label-assignee-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-height: 18rem;
    overflow-y: auto;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    padding: 0.5rem;
  }

  .label-assignee-row {
    display: grid;
    grid-template-columns: minmax(8rem, 16rem) 1fr;
    align-items: center;
    gap: 0.75rem;
  }

  .label-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .label-assignee-picker {
    min-width: 0;
  }

  .hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.6875rem;
    color: var(--theme-dark-color);
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

  .preview-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 14rem;
    overflow-y: auto;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    padding: 0.375rem;
  }

  .preview-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.8125rem;

    &.warn {
      background-color: rgba(251, 191, 36, 0.08);
      border: 1px solid rgba(251, 191, 36, 0.25);
    }
  }

  .warn-icon {
    flex-shrink: 0;
    color: #f59e0b;
    font-size: 0.9rem;
    cursor: help;
  }

  .preview-title {
    color: var(--theme-caption-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .preview-project {
    color: var(--theme-dark-color);
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .warn-note {
    margin: 0.5rem 0 0 0;
    padding: 0.5rem 0.625rem;
    color: #b45309;
    background-color: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 0.375rem;
    font-size: 0.75rem;
  }

  .progress-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 16rem;
    overflow-y: auto;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    padding: 0.5rem;
  }

  .progress-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
    padding: 0.25rem 0.375rem;
    border-radius: 0.25rem;

    &.error {
      color: var(--theme-error-color, var(--theme-content-color));
    }
  }

  .progress-icon {
    flex-shrink: 0;
  }

  .progress-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .success-message {
    margin: 0;
    font-size: 0.875rem;
    color: var(--theme-content-color);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--theme-divider-color);
  }
</style>
