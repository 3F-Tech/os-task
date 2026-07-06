<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import contact, { formatName, type Person } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { type ProjectWithBU } from '@hcengineering/operational-dashboard'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { ClientStage, type Project } from '@hcengineering/tracker'
  import { Button, Label } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import operationalDashboard from '../plugin'
  import { orgStore } from '../orgStructure'
  import {
    dashboardFilters,
    lastRefreshedAt,
    refreshState,
    resetFilters,
    triggerRefresh
  } from '../stores'
  import IconCheck from './IconCheck.svelte'
  import IconRefresh from './IconRefresh.svelte'

  const client = getClient()
  const hierarchy = client.getHierarchy()

  // Quando true, oculta o seletor de Etapa. Usado na aba Individual, que já
  // separa as métricas por etapa nos próprios cards — o filtro global seria
  // redundante/confuso lá (e o computeGreen o ignora de propósito).
  export let hideClientStage = false
  // Quando true, oculta os seletores de Usuário e Equipe (o chamador trava o
  // userId no próprio usuário). Usado na Individual para que o user normal não
  // consiga trocar o filtro e ver dados de outra pessoa.
  export let lockUser = false
  // Quando true, o seletor de BU ganha a opção "— Todos —" (value vazio = todas
  // as BUs). Usado na Individual, cujo cálculo suporta buId vazio.
  export let allowAllBU = false

  const projectsQuery = createQuery()
  const personsQuery = createQuery()

  let allProjects: Project[] = []
  let persons: Person[] = []

  // BUs e squads vêm do 3F Core (read-through) via store; value do <select> = id (string).
  $: bus = ($orgStore.indexes?.busList ?? [])
    .filter((b) => b.is_active)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
  $: teams = ($orgStore.indexes?.raw.squads ?? [])
    .filter((s) => s.is_active)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  $: projectsQuery.query(tracker.class.Project, { archived: false }, (res) => {
    allProjects = res
  })

  $: personsQuery.query(contact.class.Person, {}, (res) => {
    persons = res.slice().sort((a, b) => formatName(a.name ?? '').localeCompare(formatName(b.name ?? '')))
  })

  // Cascata: só projetos da BU selecionada. Sem BU → lista vazia.
  $: filteredProjects =
    $dashboardFilters.buId === ''
      ? []
      : allProjects.filter((p) => {
        if (!hierarchy.hasMixin(p, operationalDashboard.mixin.ProjectWithBU)) return false
        const m = hierarchy.as(p, operationalDashboard.mixin.ProjectWithBU) as ProjectWithBU
        return m.coreBuId === Number($dashboardFilters.buId)
      })

  // Ao trocar BU, limpa o projeto selecionado se ele não pertence à nova BU.
  let prevBuId = $dashboardFilters.buId
  $: if ($dashboardFilters.buId !== prevBuId) {
    prevBuId = $dashboardFilters.buId
    if ($dashboardFilters.projectId !== '') {
      $dashboardFilters.projectId = ''
    }
  }

  // Com squad selecionado, o select de usuário lista só os membros (refs do store).
  $: selectedSquadMembers =
    $dashboardFilters.teamId !== '' && $orgStore.indexes != null
      ? new Set($orgStore.indexes.memberRefsBySquadId.get(Number($dashboardFilters.teamId)) ?? [])
      : undefined
  $: filteredPersons =
    selectedSquadMembers != null ? persons.filter((p) => selectedSquadMembers?.has(p._id)) : persons

  // Ao trocar de equipe, limpa o usuário se não for membro da nova equipe.
  // Busca a equipe localmente (não via selectedTeam) para não criar ciclo
  // reativo: este bloco escreve em $dashboardFilters.
  let prevTeamId = $dashboardFilters.teamId
  $: if ($dashboardFilters.teamId !== prevTeamId) {
    prevTeamId = $dashboardFilters.teamId
    const memberRefs =
      $dashboardFilters.teamId !== '' && $orgStore.indexes != null
        ? new Set($orgStore.indexes.memberRefsBySquadId.get(Number($dashboardFilters.teamId)) ?? [])
        : undefined
    if (
      $dashboardFilters.userId !== '' &&
      memberRefs != null &&
      !memberRefs.has($dashboardFilters.userId as Ref<Person>)
    ) {
      $dashboardFilters.userId = ''
    }
  }

  const stages: Array<{ value: ClientStage, label: string }> = [
    { value: ClientStage.Onboarding, label: 'Onboarding' },
    { value: ClientStage.Expansion, label: 'Expansão' },
    { value: ClientStage.Retention, label: 'Retenção' },
    { value: ClientStage.Churned, label: 'Churn' }
  ]

  // Tick que força recálculo do "atualizado há Xs" a cada 5s sem provocar reload de dados.
  let nowTick = Date.now()
  const tickInterval = setInterval(() => {
    nowTick = Date.now()
  }, 5000)
  onDestroy(() => clearInterval(tickInterval))

  function formatAge (last: number | null, now: number): string {
    if (last == null) return ''
    const diffSec = Math.max(0, Math.floor((now - last) / 1000))
    if (diffSec < 5) return 'agora mesmo'
    if (diffSec < 60) return `há ${diffSec}s`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `há ${diffMin}min`
    const diffH = Math.floor(diffMin / 60)
    return `há ${diffH}h`
  }

  $: ageLabel = formatAge($lastRefreshedAt, nowTick)
  $: refreshDisabled = $refreshState !== 'idle' || $dashboardFilters.buId === ''
  $: projectDisabled = $dashboardFilters.buId === ''
  $: refreshLabel =
    $refreshState === 'loading'
      ? operationalDashboard.string.Refreshing
      : $refreshState === 'done'
        ? operationalDashboard.string.Refreshed
        : operationalDashboard.string.Refresh
  $: refreshIcon = $refreshState === 'done' ? IconCheck : IconRefresh
</script>

<div class="filters-bar">
  <div class="filter">
    {#if allowAllBU}
      <span class="filter-label"><Label label={operationalDashboard.string.BusinessUnit} /></span>
    {:else}
      <span class="filter-label required"><Label label={operationalDashboard.string.BusinessUnit} /> *</span>
    {/if}
    <select bind:value={$dashboardFilters.buId} class:required-empty={!allowAllBU && $dashboardFilters.buId === ''}>
      {#if allowAllBU}
        <option value="">— Todos —</option>
      {:else}
        <option value="" disabled>— Selecione uma BU —</option>
      {/if}
      {#each bus as bu (bu.id)}
        <option value={String(bu.id)}>{bu.name}</option>
      {/each}
    </select>
  </div>

  <div class="filter">
    <span class="filter-label"><Label label={operationalDashboard.string.Project} /></span>
    <select bind:value={$dashboardFilters.projectId} disabled={projectDisabled}>
      <option value="">{projectDisabled ? '— Selecione uma BU primeiro —' : '— Todos —'}</option>
      {#each filteredProjects as p (p._id)}
        <option value={p._id}>{p.name}</option>
      {/each}
    </select>
  </div>

  {#if !hideClientStage}
    <div class="filter">
      <span class="filter-label"><Label label={operationalDashboard.string.ClientStage} /></span>
      <select bind:value={$dashboardFilters.clientStage}>
        <option value="">— Todas —</option>
        {#each stages as s (s.value)}
          <option value={s.value}>{s.label}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if !lockUser}
    <div class="filter">
      <span class="filter-label"><Label label={operationalDashboard.string.Team} /></span>
      <select bind:value={$dashboardFilters.teamId}>
        <option value="">— Todas —</option>
        {#each teams as t (t.id)}
          <option value={String(t.id)}>{t.name}</option>
        {/each}
      </select>
    </div>

    <div class="filter">
      <span class="filter-label"><Label label={operationalDashboard.string.User} /></span>
      <select bind:value={$dashboardFilters.userId}>
        <option value="">— Todos —</option>
        {#each filteredPersons as p (p._id)}
          <option value={p._id}>{formatName(p.name ?? '')}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="filter spacer">
    <span class="filter-label">
      {#if ageLabel !== ''}
        <Label label={operationalDashboard.string.LastUpdated} /> {ageLabel}
      {:else}
        &nbsp;
      {/if}
    </span>
    <div class="actions">
      <div
        class="refresh-wrap"
        class:loading={$refreshState === 'loading'}
        class:done={$refreshState === 'done'}
      >
        <Button
          icon={refreshIcon}
          label={refreshLabel}
          kind="primary"
          disabled={refreshDisabled}
          on:click={triggerRefresh}
        />
      </div>
      {#if !lockUser}
        <Button label={operationalDashboard.string.Reset} on:click={resetFilters} />
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  .filters-bar {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .filter {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    &.spacer {
      margin-left: auto;
    }
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .refresh-wrap {
    display: inline-flex;
    transition: filter 0.2s ease;

    &.loading :global(svg) {
      animation: spin 0.9s linear infinite;
    }

    &.done :global(button) {
      background: #2ecc71 !important;
      border-color: #2ecc71 !important;
      color: #fff !important;
    }

    &.done :global(svg) {
      color: #fff;
    }
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .filter-label {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    min-height: 1em;
  }

  select {
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-color);
    color: var(--theme-caption-color);
    min-width: 10rem;
    font-size: 0.875rem;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &.required-empty {
      border-color: var(--theme-warning-color, #f39c12);
    }

    option {
      background: var(--theme-popup-color);
      color: var(--theme-content-color);
    }
  }

  .filter-label.required {
    color: var(--theme-caption-color);
  }
</style>
