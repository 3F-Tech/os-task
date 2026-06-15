<!--
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import type { Person } from '@hcengineering/contact'
  import { UserBoxList } from '@hcengineering/contact-resources'
  import { type Ref } from '@hcengineering/core'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import tags, { type TagElement } from '@hcengineering/tags'
  import task from '@hcengineering/task'
  import type {
    AutomationScript,
    AutomationScriptStep,
    AutomationVariantGroup,
    Issue,
    IssueTemplate,
    PdcaFrequency,
    Project
  } from '@hcengineering/tracker'
  import { Button, EditBox, Label, tooltip } from '@hcengineering/ui'
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
  // Escolha selecionada em cada grupo de variantes (índice do grupo → valor)
  let groupChoices: Record<number, string> = {}
  // Máximo de responsáveis por etiqueta (e por tarefa) — alinhado ao limite do tracker
  const MAX_ASSIGNEES = 3
  // Cada etiqueta pode mapear até MAX_ASSIGNEES responsáveis
  let labelAssignees: Record<string, Ref<Person>[]> = {}
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
      // Inicializa cada grupo com a primeira opção
      const groups = getVariantGroups(script)
      const init: Record<number, string> = {}
      groups.forEach((g, idx) => {
        if (g.options.length > 0) init[idx] = g.options[0]
      })
      groupChoices = init
    } catch (err) {
      console.error('RunAutomationScript load failed:', err)
    } finally {
      loaded = true
    }
  })

  // Migra script legado (variantOptions) para variantGroups in-memory
  function getVariantGroups (s: AutomationScript | undefined): AutomationVariantGroup[] {
    if (s === undefined) return []
    if (s.variantGroups !== undefined && s.variantGroups.length > 0) return s.variantGroups
    if (s.variantOptions !== undefined && s.variantOptions.length > 0) {
      return [{ name: 'Variantes', options: s.variantOptions }]
    }
    return []
  }

  $: variantGroups = getVariantGroups(script)
  $: activeVariants = new Set(Object.values(groupChoices))

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
  // - assignees: a UNIÃO dos responsáveis de TODAS as labels (sem duplicar),
  //   limitada a MAX_ASSIGNEES e preservando a ordem das labels
  // - overflow: true se as labels mapeiam mais responsáveis do que o limite
  function resolveAssignees (labels: Ref<TagElement>[] | undefined): {
    assignees: Ref<Person>[]
    overflow: boolean
  } {
    if (labels === undefined) return { assignees: [], overflow: false }
    const all: Ref<Person>[] = []
    for (const labelId of labels) {
      const mapped = labelAssignees[labelId as unknown as string] ?? []
      for (const a of mapped) {
        if (a != null && !all.includes(a)) all.push(a)
      }
    }
    return { assignees: all.slice(0, MAX_ASSIGNEES), overflow: all.length > MAX_ASSIGNEES }
  }

  function pickAssignees (labels: Ref<TagElement>[] | undefined): Ref<Person>[] {
    return resolveAssignees(labels).assignees
  }

  // Resultado final do responsável de uma tarefa: usa os responsáveis derivados
  // das etiquetas se houver; senão cai para o assignee do próprio template/child.
  // Trata array vazio como "sem responsável" (null) — o contrato do schema é
  // Ref<Person>[] | null, NUNCA [] (um [] gravado no JSONB não casa com a query de
  // "não especificado" e some das views agrupadas por responsável).
  function finalAssignee (
    picked: Ref<Person>[],
    own: Ref<Person>[] | null | undefined
  ): Ref<Person>[] | null {
    if (picked.length > 0) return picked
    return Array.isArray(own) && own.length > 0 ? own : null
  }

  // Para um step do preview, indica se a tarefa raiz OU algum child mapeia mais
  // responsáveis (somando todas as labels) do que o limite — só os primeiros
  // MAX_ASSIGNEES serão aplicados.
  function stepHasOverflow (step: AutomationScriptStep): boolean {
    const tpl = templatesById.get(step.template)
    if (tpl === undefined) return false
    const tplLabels = ((tpl as any).labels ?? []) as Ref<TagElement>[]
    if (resolveAssignees(tplLabels).overflow) return true
    const children = ((tpl as any).children ?? []) as Array<{ labels?: Ref<TagElement>[] }>
    for (const child of children) {
      if (resolveAssignees(child.labels).overflow) return true
    }
    return false
  }

  // Reativo: quais steps excedem MAX_ASSIGNEES (só os primeiros serão aplicados).
  // Referencia labelAssignees e templatesById (ambos lidos dentro de
  // stepHasOverflow) para o Svelte rastrear as dependências; filteredSteps já é
  // rastreado no corpo da função.
  $: overflowStepIds = ((_deps: unknown[]) =>
    new Set(filteredSteps.filter(stepHasOverflow).map((s) => s._id)))([labelAssignees, templatesById])

  function tagBackground (tag: TagElement): string {
    const c = (tag as any).color
    if (typeof c === 'number' && c >= 0) {
      return `#${(c >>> 0).toString(16).padStart(6, '0')}`
    }
    return 'var(--theme-button-default)'
  }

  function getAssigneesForLabel (tag: TagElement): Ref<Person>[] {
    return labelAssignees[tag._id as unknown as string] ?? []
  }

  function setAssigneesForLabel (tag: TagElement, val: Ref<Person>[]): void {
    const next = { ...labelAssignees }
    next[tag._id as unknown as string] = (val ?? []).slice(0, MAX_ASSIGNEES)
    labelAssignees = next
  }

  function setGroupChoice (groupIdx: number, value: string): void {
    groupChoices = { ...groupChoices, [groupIdx]: value }
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
      const tplAssignee: Ref<Person>[] | null = finalAssignee(
        pickAssignees(tplLabels),
        (template as any).assignee
      )

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
          pdcaCycleResetSubIssues: (template as any).pdcaCycleResetSubIssues,
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
        const childAssignee: Ref<Person>[] | null = finalAssignee(pickAssignees(childLabels), child.assignee)
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

        {#if variantGroups.length > 0}
          <section class="form-section">
            <h4 class="section-title"><Label label={tracker.string.SelectVariantOptions} /></h4>
            <div class="variant-groups">
              {#each variantGroups as group, gIdx (gIdx)}
                <div class="variant-group-row">
                  <span class="variant-group-name">{group.name === '' ? '—' : group.name}:</span>
                  {#each group.options as opt (opt)}
                    <label class="radio-option">
                      <input
                        type="radio"
                        name="wizard-group-{gIdx}"
                        checked={groupChoices[gIdx] === opt}
                        on:change={() => setGroupChoice(gIdx, opt)}
                      />
                      <span>{opt}</span>
                    </label>
                  {/each}
                </div>
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
                    <UserBoxList
                      label={tracker.string.AssigneeByLabel}
                      emptyLabel={tracker.string.LabelNoAssignee}
                      items={getAssigneesForLabel(tag)}
                      kind="regular"
                      size="small"
                      width="100%"
                      justify="left"
                      on:update={(e) => setAssigneesForLabel(tag, e.detail ?? [])}
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
                {@const hasOverflow = overflowStepIds.has(step._id)}
                <li class="preview-row" class:warn={hasOverflow}>
                  {#if hasOverflow}
                    <span class="warn-icon" use:tooltip={{ label: tracker.string.MultipleLabelsTooltip }}>⚠</span>
                  {/if}
                  <span class="preview-title">{template?.title ?? '(template ausente)'}</span>
                  <span class="preview-project">{projeto?.name ?? '(projeto ausente)'}</span>
                </li>
              {/each}
            </ul>
            {#if overflowStepIds.size > 0}
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

  .variant-groups {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .variant-group-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
  }

  .variant-group-name {
    font-weight: 600;
    color: var(--theme-caption-color);
    margin-right: 0.25rem;
    min-width: 6rem;
  }

  .radio-option {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
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
