<!--
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import tags from '@hcengineering/tags'
  import task from '@hcengineering/task'
  import tracker, { type Issue, type IssueTemplate, type Project } from '@hcengineering/tracker'
  import { Button, EditBox, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import trackerRes from '../../plugin'
  import { type BU, type SmVariant, type BommaScenario, type OnboardingEntry, getTarefas } from './onboarding-config'

  type PdcaFreq = 'weekly' | 'biweekly' | 'monthly' | 'quarterly'

  // Due date do ciclo PDCA *atual* — diferente do worker, que calcula o PRÓXIMO ciclo.
  // Aqui aceitamos datas já passadas (ex.: terça desta semana, mesmo se hoje for sexta),
  // pois ao criar o cliente o vencimento do ciclo corrente deve ser registrado.
  function calculateCurrentCycleDueDate (frequency: PdcaFreq | undefined, dueDays: number[] | undefined): number | null {
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

  export let onClose: () => void = () => {}
  export let onComplete: (entry: { clientName: string, bu: BU, variant?: SmVariant, cenario?: BommaScenario, count: number }) => void = () =>
    {}

  const dispatch = createEventDispatcher()

  let nomeCliente = ''
  let buSelecionada: BU | null = null
  let smVariant: SmVariant = 'com SM'
  let bommaScenario: BommaScenario = '1e2'
  let executando = false
  let concluido = false
  let progresso: Array<{ label: string, ok: boolean }> = []

  $: needsScenario = buSelecionada === 'Bomma'

  $: canStart =
    !executando &&
    !concluido &&
    nomeCliente.trim().length > 0 &&
    buSelecionada !== null &&
    smVariant !== undefined &&
    (!needsScenario || bommaScenario !== undefined)

  function cancel (): void {
    onClose()
    dispatch('close')
  }

  async function executarOnboarding (): Promise<void> {
    if (!canStart || buSelecionada === null) return
    executando = true
    progresso = []

    const client = getClient()
    const tarefas: OnboardingEntry[] = getTarefas(
      buSelecionada,
      smVariant,
      buSelecionada === 'Bomma' ? bommaScenario : undefined
    )

    const tagElements = await client.findAll(tags.class.TagElement, {})
    const tagCache = new Map<string, { title: string, color?: number }>()
    for (const tag of tagElements) {
      tagCache.set(tag._id as unknown as string, { title: tag.title ?? '', color: (tag as any).color })
    }

    const projetoCache = new Map<string, Project>()
    const kindCache = new Map<string, string>()
    let sucessos = 0

    for (const { projetoId, templateId, label } of tarefas) {
      if (!projetoCache.has(projetoId)) {
        const p = await client.findOne(tracker.class.Project, { _id: projetoId as unknown as Ref<Project> })
        if (p === undefined) {
          progresso = [...progresso, { label: `Projeto não encontrado: ${projetoId}`, ok: false }]
          continue
        }
        projetoCache.set(projetoId, p)
      }
      const projeto = projetoCache.get(projetoId) as Project

      const template = await client.findOne(tracker.class.IssueTemplate, {
        _id: templateId as unknown as Ref<IssueTemplate>
      })
      if (template === undefined) {
        progresso = [...progresso, { label: `Template não encontrado: ${label}`, ok: false }]
        continue
      }

      if (!kindCache.has(projetoId)) {
        const kindDoTemplate = (template as any).kind
        if (kindDoTemplate !== undefined && kindDoTemplate !== null) {
          kindCache.set(projetoId, kindDoTemplate)
        } else {
          const issueExistente = await client.findOne(tracker.class.Issue, {
            space: projetoId as unknown as Ref<Project>
          })
          if (issueExistente?.kind !== undefined && issueExistente.kind !== null) {
            kindCache.set(projetoId, issueExistente.kind as unknown as string)
          } else {
            const taskTypes = await client.findAll(task.class.TaskType, {
              parent: (projeto as any).type
            })
            if (taskTypes.length > 0) {
              kindCache.set(projetoId, taskTypes[0]._id as unknown as string)
            }
          }
        }
      }
      const kind = kindCache.get(projetoId)

      const inc = await client.updateDoc(
        tracker.class.Project,
        'space:class:Space' as any,
        projetoId as unknown as Ref<Project>,
        { $inc: { sequence: 1 } } as any,
        true
      )
      const number = (inc as any).object.sequence as number
      const identifier = `${projeto.identifier}-${number}`

      const pdcaActive = (template as any).pdcaCycleActive === true
      const pdcaFrequency = (template as any).pdcaCycleFrequency
      const pdcaDueDays = (template as any).pdcaCycleDueDays
      const pdcaDueDate = pdcaActive ? calculateCurrentCycleDueDate(pdcaFrequency, pdcaDueDays) : null

      const tarefaId = await client.addCollection(
        tracker.class.Issue,
        projetoId as unknown as Ref<Project>,
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
          clientName: nomeCliente.trim(),
          clientStage: 'onboarding',
          pdcaCycleActive: pdcaActive,
          pdcaCycleFrequency: pdcaFrequency,
          pdcaCycleDueDays: pdcaDueDays,
          pdcaCycleResetStatus: (template as any).pdcaCycleResetStatus,
          dueDate: pdcaDueDate,
          template: { template: templateId as unknown as Ref<IssueTemplate> }
        } as any
      )

      for (const labelId of (template as any).labels ?? []) {
        const tagInfo = tagCache.get(labelId as string) ?? { title: '' }
        await client.addCollection(
          tags.class.TagReference,
          projetoId as unknown as Ref<Project>,
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
          projetoId as unknown as Ref<Project>,
          { $inc: { sequence: 1 } } as any,
          true
        )
        const subNumber = (subInc as any).object.sequence as number
        const subIdentifier = `${projeto.identifier}-${subNumber}`

        const subId = await client.addCollection(
          tracker.class.Issue,
          projetoId as unknown as Ref<Project>,
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
            estimation: child.estimation ?? 0
          } as any
        )

        for (const labelId of child.labels ?? []) {
          const tagInfo = tagCache.get(labelId as string) ?? { title: '' }
          await client.addCollection(
            tags.class.TagReference,
            projetoId as unknown as Ref<Project>,
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
      clientName: nomeCliente.trim(),
      bu: buSelecionada,
      variant: smVariant,
      cenario: buSelecionada === 'Bomma' ? bommaScenario : undefined,
      count: sucessos
    })
  }
</script>

<Card
  label={trackerRes.string.NewClientOnboarding}
  okAction={async () => {}}
  canSave={false}
  hideFooter
  width="medium"
  on:close
  on:changeContent
>
  <div class="onboarding-form">
    {#if !concluido}
      <section class="form-section">
        <h3 class="section-title"><Label label={trackerRes.string.ClientName} /></h3>
        <EditBox bind:value={nomeCliente} placeholder={trackerRes.string.ClientNamePlaceholder} kind="default" />
      </section>

      <section class="form-section">
        <h3 class="section-title"><Label label={trackerRes.string.BusinessUnit} /></h3>
        <div class="bu-buttons">
          <Button
            label={trackerRes.string.BuSeed}
            kind={buSelecionada === 'Seed' ? 'primary' : 'regular'}
            size="medium"
            disabled={executando}
            on:click={() => (buSelecionada = 'Seed')}
          />
          <Button
            label={trackerRes.string.BuImpulse}
            kind={buSelecionada === 'Impulse' ? 'primary' : 'regular'}
            size="medium"
            disabled={executando}
            on:click={() => (buSelecionada = 'Impulse')}
          />
          <Button
            label={trackerRes.string.BuBomma}
            kind={buSelecionada === 'Bomma' ? 'primary' : 'regular'}
            size="medium"
            disabled={executando}
            on:click={() => (buSelecionada = 'Bomma')}
          />
        </div>
      </section>

      {#if buSelecionada !== null}
        <section class="form-section">
          <h3 class="section-title"><Label label={trackerRes.string.SocialMediaVariant} /></h3>
          <div class="bu-buttons">
            <Button
              label={trackerRes.string.WithSocialMedia}
              kind={smVariant === 'com SM' ? 'primary' : 'regular'}
              size="medium"
              disabled={executando}
              on:click={() => (smVariant = 'com SM')}
            />
            <Button
              label={trackerRes.string.WithoutSocialMedia}
              kind={smVariant === 'sem SM' ? 'primary' : 'regular'}
              size="medium"
              disabled={executando}
              on:click={() => (smVariant = 'sem SM')}
            />
          </div>
        </section>
      {/if}

      {#if needsScenario}
        <section class="form-section">
          <h3 class="section-title"><Label label={trackerRes.string.BommaScenario} /></h3>
          <div class="bu-buttons">
            <Button
              label={trackerRes.string.Scenario1e2}
              kind={bommaScenario === '1e2' ? 'primary' : 'regular'}
              size="medium"
              disabled={executando}
              on:click={() => (bommaScenario = '1e2')}
            />
            <Button
              label={trackerRes.string.Scenario3}
              kind={bommaScenario === '3' ? 'primary' : 'regular'}
              size="medium"
              disabled={executando}
              on:click={() => (bommaScenario = '3')}
            />
          </div>
        </section>
      {/if}
    {/if}

    {#if progresso.length > 0}
      <section class="form-section">
        <h3 class="section-title"><Label label={trackerRes.string.OnboardingProgress} /></h3>
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
        <p class="success-message">
          <Label label={trackerRes.string.OnboardingSuccess} />
        </p>
      </section>
    {/if}

    <div class="footer">
      {#if !concluido}
        <Button label={presentation.string.Cancel} kind="regular" size="medium" on:click={cancel} disabled={executando} />
        <Button
          label={trackerRes.string.StartOnboarding}
          kind="primary"
          size="medium"
          disabled={!canStart}
          loading={executando}
          on:click={executarOnboarding}
        />
      {:else}
        <Button label={presentation.string.Close} kind="primary" size="medium" on:click={cancel} />
      {/if}
    </div>
  </div>
</Card>

<style lang="scss">
  .onboarding-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 0.25rem 0.5rem 0.5rem;
    min-width: 24rem;
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

  .bu-buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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
