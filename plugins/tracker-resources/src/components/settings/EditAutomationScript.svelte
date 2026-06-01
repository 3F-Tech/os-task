<!--
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import presentation, { Card, createQuery, getClient } from '@hcengineering/presentation'
  import type {
    AutomationScript,
    AutomationScriptStep,
    IssueTemplate,
    Project
  } from '@hcengineering/tracker'
  import core from '@hcengineering/core'
  import {
    Button,
    CheckBox,
    EditBox,
    IconAdd,
    IconClose,
    IconDelete,
    Label,
    SelectPopup,
    eventToHTMLElement,
    showPopup
  } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'

  import tracker from '../../plugin'

  export let script: AutomationScript | undefined = undefined

  interface StepDraft {
    _id?: Ref<AutomationScriptStep>
    project?: Ref<Project>
    template?: Ref<IssueTemplate>
    order: number
    requireAll: string[]
    requireNone: string[]
    dueInDays?: number
  }

  interface ProjectGroup {
    project: Ref<Project>
    steps: StepDraft[]
  }

  const client = getClient()
  const dispatch = createEventDispatcher()
  const isNew = script === undefined

  let name: string = script?.name ?? ''
  let description: string = script?.description ?? ''
  let variantOptions: string[] = [...(script?.variantOptions ?? [])]
  let newVariant: string = ''
  let steps: StepDraft[] = []
  let removedStepIds: Ref<AutomationScriptStep>[] = []
  let saving = false
  let loaded = isNew

  // ─── Project / Template caches ──────────────────────────────────────────────
  let projects: Project[] = []
  let templates: IssueTemplate[] = []
  const projectQuery = createQuery()
  const templateQuery = createQuery()

  $: projectQuery.query(tracker.class.Project, {}, (res) => {
    projects = res
  })
  $: templateQuery.query(tracker.class.IssueTemplate, {}, (res) => {
    templates = res
  })

  $: projectMap = new Map(projects.map((p) => [p._id, p]))
  $: templateMap = new Map(templates.map((t) => [t._id, t]))

  // ─── Load existing steps (uma única vez no mount) ──────────────────────────
  onMount(async () => {
    if (script === undefined) return
    try {
      const found = await client.findAll(
        tracker.class.AutomationScriptStep,
        { attachedTo: script._id },
        { sort: { order: 1 } }
      )
      steps = found.map((s) => ({
        _id: s._id,
        project: s.project,
        template: s.template,
        order: s.order,
        requireAll: [...(s.requireAll ?? [])],
        requireNone: [...(s.requireNone ?? [])],
        dueInDays: s.dueInDays
      }))
    } catch (err) {
      console.error('EditAutomationScript load failed:', err)
    } finally {
      loaded = true
    }
  })

  // ─── Agrupamento visual por projeto ─────────────────────────────────────────
  // Mantém a ordem em que cada projeto aparece (ordem do menor `order` dentro do grupo).
  $: groups = ((): ProjectGroup[] => {
    const sorted = [...steps].sort((a, b) => a.order - b.order)
    const map = new Map<string, ProjectGroup>()
    const orphans: StepDraft[] = []
    for (const s of sorted) {
      if (s.project === undefined) {
        orphans.push(s)
        continue
      }
      const key = s.project as unknown as string
      let g = map.get(key)
      if (g === undefined) {
        g = { project: s.project, steps: [] }
        map.set(key, g)
      }
      g.steps.push(s)
    }
    const arr = Array.from(map.values())
    if (orphans.length > 0) {
      // orphans ficam num "grupo" sem projeto, no fim
      arr.push({ project: undefined as unknown as Ref<Project>, steps: orphans })
    }
    return arr
  })()

  // ─── Variant management ─────────────────────────────────────────────────────
  function addVariant (): void {
    const v = newVariant.trim()
    if (v === '' || variantOptions.includes(v)) return
    variantOptions = [...variantOptions, v]
    newVariant = ''
  }

  function removeVariant (v: string): void {
    variantOptions = variantOptions.filter((x) => x !== v)
    steps = steps.map((s) => ({
      ...s,
      requireAll: s.requireAll.filter((x) => x !== v),
      requireNone: s.requireNone.filter((x) => x !== v)
    }))
  }

  // ─── Project group management ───────────────────────────────────────────────
  function openProjectPicker (event: MouseEvent): void {
    const items = projects.map((p) => ({
      id: p._id,
      label: p.name,
      isSelected: false
    }))
    showPopup(SelectPopup, { value: items, searchable: true }, eventToHTMLElement(event), (selected) => {
      if (selected === undefined) return
      const projectId = selected as Ref<Project>
      // Se já existe grupo desse projeto, adiciona template lá. Senão, cria grupo novo.
      addTemplateToProject(projectId)
    })
  }

  function addTemplateToProject (projectId: Ref<Project>): void {
    const groupSteps = steps.filter((s) => s.project === projectId)
    const maxOrder = groupSteps.reduce(
      (m, s) => (s.order > m ? s.order : m),
      steps.reduce((m, s) => (s.order > m ? s.order : m), 0)
    )
    steps = [
      ...steps,
      {
        project: projectId,
        template: undefined,
        order: maxOrder + 10,
        requireAll: [],
        requireNone: [],
        dueInDays: undefined
      }
    ]
  }

  function removeProjectGroup (projectId: Ref<Project>): void {
    const groupSteps = steps.filter((s) => s.project === projectId)
    const count = groupSteps.length
    if (count > 0) {
      const projectName = projectMap.get(projectId)?.name ?? ''
      if (!window.confirm(`${projectName}\n\nRemover este projeto e todos os ${count} template(s) dele?`)) return
    }
    for (const s of groupSteps) {
      if (s._id !== undefined) removedStepIds = [...removedStepIds, s._id]
    }
    steps = steps.filter((s) => s.project !== projectId)
  }

  // ─── Step management dentro do grupo ────────────────────────────────────────
  function removeStep (step: StepDraft): void {
    if (step._id !== undefined) removedStepIds = [...removedStepIds, step._id]
    steps = steps.filter((s) => s !== step)
  }

  function moveStepWithinGroup (step: StepDraft, delta: -1 | 1): void {
    const group = groups.find((g) => g.project === step.project)
    if (group === undefined) return
    const idx = group.steps.indexOf(step)
    const target = idx + delta
    if (target < 0 || target >= group.steps.length) return
    // troca as `order` entre os dois steps no mesmo grupo
    const a = group.steps[idx]
    const b = group.steps[target]
    const tmp = a.order
    a.order = b.order
    b.order = tmp
    steps = [...steps]
  }

  function openTemplateSelector (event: MouseEvent, step: StepDraft): void {
    if (step.project === undefined) return
    const items = templates
      .filter((t) => t.space === step.project)
      .map((t) => ({
        id: t._id,
        label: t.title,
        isSelected: t._id === step.template
      }))
    showPopup(SelectPopup, { value: items, searchable: true }, eventToHTMLElement(event), (selected) => {
      if (selected !== undefined) {
        step.template = selected as Ref<IssueTemplate>
        steps = [...steps]
      }
    })
  }

  function getDueInDaysString (step: StepDraft): string {
    return step.dueInDays === undefined ? '' : String(step.dueInDays)
  }

  function setDueInDaysFromInput (step: StepDraft, raw: string): void {
    const trimmed = raw.trim()
    if (trimmed === '') {
      step.dueInDays = undefined
    } else {
      const n = parseInt(trimmed, 10)
      step.dueInDays = Number.isFinite(n) && n >= 0 ? n : undefined
    }
    steps = [...steps]
  }

  function toggleRequire (step: StepDraft, list: 'requireAll' | 'requireNone', variant: string): void {
    const current = step[list]
    if (current.includes(variant)) {
      step[list] = current.filter((v) => v !== variant)
    } else {
      step[list] = [...current, variant]
      const other = list === 'requireAll' ? 'requireNone' : 'requireAll'
      step[other] = step[other].filter((v) => v !== variant)
    }
    steps = [...steps]
  }

  // ─── Save ───────────────────────────────────────────────────────────────────
  $: canSave =
    !saving &&
    name.trim().length > 0 &&
    steps.every((s) => s.project !== undefined && s.template !== undefined)

  async function save (): Promise<void> {
    if (!canSave) return
    saving = true

    let scriptId: Ref<AutomationScript>
    if (isNew) {
      scriptId = await client.createDoc(tracker.class.AutomationScript, core.space.Workspace, {
        name: name.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        variantOptions: variantOptions.length > 0 ? variantOptions : undefined,
        steps: 0
      })
    } else {
      scriptId = script!._id
      await client.updateDoc(tracker.class.AutomationScript, script!.space, scriptId, {
        name: name.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        variantOptions: variantOptions.length > 0 ? variantOptions : undefined
      })
    }

    for (const stepId of removedStepIds) {
      const existing = await client.findOne(tracker.class.AutomationScriptStep, { _id: stepId })
      if (existing !== undefined) {
        await client.removeCollection(
          tracker.class.AutomationScriptStep,
          existing.space,
          stepId,
          scriptId,
          tracker.class.AutomationScript,
          'steps'
        )
      }
    }

    for (const step of steps) {
      if (step.project === undefined || step.template === undefined) continue
      const payload = {
        project: step.project,
        template: step.template,
        order: step.order,
        requireAll: step.requireAll.length > 0 ? step.requireAll : undefined,
        requireNone: step.requireNone.length > 0 ? step.requireNone : undefined,
        dueInDays: step.dueInDays !== undefined && step.dueInDays >= 0 ? step.dueInDays : undefined
      }
      if (step._id === undefined) {
        await client.addCollection(
          tracker.class.AutomationScriptStep,
          core.space.Workspace,
          scriptId,
          tracker.class.AutomationScript,
          'steps',
          payload
        )
      } else {
        await client.updateCollection(
          tracker.class.AutomationScriptStep,
          core.space.Workspace,
          step._id,
          scriptId,
          tracker.class.AutomationScript,
          'steps',
          payload
        )
      }
    }

    saving = false
    dispatch('close')
  }

  function cancel (): void {
    dispatch('close')
  }
</script>

<Card
  label={isNew ? tracker.string.NewScript : tracker.string.EditScript}
  okAction={async () => {}}
  canSave={false}
  hideFooter
  width="medium"
  on:close
  on:changeContent
>
  <div class="editor">
    <section class="form-section">
      <h4 class="section-title"><Label label={tracker.string.AutomationScriptName} /></h4>
      <EditBox bind:value={name} kind="default" autoFocus />
    </section>

    <section class="form-section">
      <h4 class="section-title"><Label label={tracker.string.AutomationScriptDescriptionField} /></h4>
      <EditBox bind:value={description} kind="default" />
    </section>

    <section class="form-section">
      <h4 class="section-title"><Label label={tracker.string.AutomationVariants} /></h4>
      <div class="chip-row">
        {#each variantOptions as v (v)}
          <span class="chip variant-chip">
            {v}
            <button class="chip-remove" on:click={() => removeVariant(v)} aria-label="remove">
              <IconClose size="x-small" />
            </button>
          </span>
        {/each}
        <div class="variant-add">
          <EditBox bind:value={newVariant} placeholder={tracker.string.VariantOptionPlaceholder} kind="default" />
          <Button
            icon={IconAdd}
            kind="ghost"
            size="small"
            disabled={newVariant.trim() === ''}
            on:click={addVariant}
          />
        </div>
      </div>
    </section>

    <section class="form-section">
      <div class="steps-header">
        <h4 class="section-title"><Label label={tracker.string.AutomationScriptSteps} /></h4>
        <Button
          label={tracker.string.AddProjectGroup}
          icon={IconAdd}
          kind="regular"
          size="small"
          on:click={openProjectPicker}
        />
      </div>

      {#if groups.length === 0}
        <p class="empty-steps"><Label label={tracker.string.NoStepsConfigured} /></p>
      {:else}
        <ul class="group-list">
          {#each groups as group (group.project ?? 'orphan')}
            {@const projectName = group.project !== undefined ? projectMap.get(group.project)?.name : undefined}
            <li class="project-group">
              <header class="project-header">
                <div class="project-title">
                  <span class="project-label"><Label label={tracker.string.Project} /></span>
                  <span class="project-name">{projectName ?? '(projeto)'}</span>
                  <span class="project-count">
                    <Label
                      label={tracker.string.TemplatesInProjectCount}
                      params={{ count: group.steps.length }}
                    />
                  </span>
                </div>
                <Button
                  icon={IconDelete}
                  kind="ghost"
                  size="small"
                  showTooltip={{ label: tracker.string.RemoveProjectGroup }}
                  on:click={() => removeProjectGroup(group.project)}
                />
              </header>

              <ul class="template-list">
                {#each group.steps as step, idx (step._id ?? `new-${idx}-${step.order}`)}
                  {@const templateTitle = step.template !== undefined ? templateMap.get(step.template)?.title : undefined}
                  <li class="template-card">
                    <div class="template-card-header">
                      <span class="template-order">#{idx + 1}</span>
                      <div class="template-actions">
                        <Button
                          label={'↑'}
                          kind="ghost"
                          size="small"
                          disabled={idx === 0}
                          on:click={() => moveStepWithinGroup(step, -1)}
                        />
                        <Button
                          label={'↓'}
                          kind="ghost"
                          size="small"
                          disabled={idx === group.steps.length - 1}
                          on:click={() => moveStepWithinGroup(step, 1)}
                        />
                        <Button
                          icon={IconDelete}
                          kind="ghost"
                          size="small"
                          on:click={() => removeStep(step)}
                        />
                      </div>
                    </div>

                    <div class="template-fields">
                      <div class="template-field">
                        <span class="field-label"><Label label={tracker.string.ScriptStepTemplate} /></span>
                        {#if templateTitle !== undefined}
                          <Button
                            label={templateTitle}
                            kind="regular"
                            size="small"
                            justify="left"
                            width="100%"
                            on:click={(e) => openTemplateSelector(e, step)}
                          />
                        {:else}
                          <Button
                            label={tracker.string.SelectTemplatePlaceholder}
                            kind="regular"
                            size="small"
                            justify="left"
                            width="100%"
                            on:click={(e) => openTemplateSelector(e, step)}
                          />
                        {/if}
                      </div>

                      <div class="template-field">
                        <span class="field-label">
                          <Label label={tracker.string.DueInDays} />
                          <span class="hint"><Label label={tracker.string.DueInDaysHint} /></span>
                        </span>
                        <div class="due-row">
                          <input
                            type="number"
                            class="due-input"
                            min="0"
                            step="1"
                            placeholder="Ex: 7"
                            value={getDueInDaysString(step)}
                            on:input={(e) => setDueInDaysFromInput(step, e.currentTarget.value)}
                          />
                          <span class="due-suffix"><Label label={tracker.string.DueInDaysSuffix} /></span>
                        </div>
                      </div>

                      {#if variantOptions.length > 0}
                        <div class="template-field">
                          <span class="field-label">
                            <Label label={tracker.string.RequireAll} />
                            <span class="hint"><Label label={tracker.string.RequireAllHint} /></span>
                          </span>
                          <div class="variant-toggle-row">
                            {#each variantOptions as v (v)}
                              <label class="variant-toggle">
                                <CheckBox
                                  checked={step.requireAll.includes(v)}
                                  on:value={() => toggleRequire(step, 'requireAll', v)}
                                />
                                <span>{v}</span>
                              </label>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>

              {#if group.project !== undefined}
                <div class="add-template-row">
                  <Button
                    label={tracker.string.AddTemplateToProject}
                    icon={IconAdd}
                    kind="ghost"
                    size="small"
                    on:click={() => addTemplateToProject(group.project)}
                  />
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <div class="footer">
      <Button label={presentation.string.Cancel} kind="regular" size="medium" on:click={cancel} disabled={saving} />
      <Button
        label={tracker.string.SaveScript}
        kind="primary"
        size="medium"
        disabled={!canSave}
        loading={saving}
        on:click={save}
      />
    </div>
  </div>
</Card>

<style lang="scss">
  .editor {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.25rem 0.5rem 0.5rem;
    min-width: 32rem;
    max-width: 44rem;
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
  }

  .steps-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    background-color: var(--theme-button-default);
    border: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
  }

  .chip-remove {
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    color: var(--theme-dark-color);
  }

  .variant-add {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 12rem;
  }

  .empty-steps {
    margin: 0;
    padding: 1rem;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.375rem;
    text-align: center;
  }

  .group-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .project-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background-color: var(--theme-comp-header-color);
  }

  .project-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .project-title {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .project-label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .project-name {
    font-weight: 600;
    color: var(--theme-caption-color);
    font-size: 0.875rem;
  }

  .project-count {
    color: var(--theme-dark-color);
    font-size: 0.75rem;
  }

  .template-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .template-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background-color: var(--theme-bg-color);
  }

  .template-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .template-order {
    font-weight: 600;
    font-size: 0.6875rem;
    color: var(--theme-dark-color);
  }

  .template-actions {
    display: flex;
    gap: 0.125rem;
  }

  .template-fields {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .template-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field-label {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.6875rem;
    color: var(--theme-dark-color);
  }

  .variant-toggle-row {
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

  .due-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .due-input {
    width: 5rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    background-color: var(--theme-bg-color);
    color: var(--theme-caption-color);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;

    &:focus {
      outline: none;
      border-color: var(--theme-button-focused-border, var(--primary-button-color));
    }
  }

  .due-suffix {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }

  .add-template-row {
    display: flex;
    justify-content: flex-start;
    padding-top: 0.25rem;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--theme-divider-color);
  }
</style>
