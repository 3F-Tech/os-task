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
  import { type Person } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { Cargo } from '@hcengineering/operational-dashboard'
  import { type IntlString } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { Label, showPopup } from '@hcengineering/ui'
  import { type IssueRow, toneForTarget } from '../metrics'
  import { computeGreen, emptyGreenResult, type GreenResult, type StageRate } from '../metricsGreen'
  import { orgStore, type OrgIndexes } from '../orgStructure'
  import { getMyPersonRef, isDashboardAdmin } from '../permissions'
  import operationalDashboard from '../plugin'
  import {
    dashboardFilters,
    markRefreshDone,
    markRefreshFailed,
    refreshState,
    refreshTrigger,
    type DashboardFilters as Filters
  } from '../stores'
  import ChangesAdjustmentsPanel from './ChangesAdjustmentsPanel.svelte'
  import ClientsAtRiskPanel from './ClientsAtRiskPanel.svelte'
  import WaitingApprovalPanel from './WaitingApprovalPanel.svelte'
  import PdcaOnTimePanel from './PdcaOnTimePanel.svelte'
  import CapacityPanel from './CapacityPanel.svelte'
  import DashboardFilters from './DashboardFilters.svelte'
  import DateRangePicker from './DateRangePicker.svelte'
  import IssueListModal from './IssueListModal.svelte'
  import MetricCard from './MetricCard.svelte'
  import OnTimePerPersonTable from './OnTimePerPersonTable.svelte'
  import OverduePerPersonTable from './OverduePerPersonTable.svelte'

  const client = getClient()

  // Org structure do 3F Core (BU/squad/cargo). idx undefined enquanto carrega.
  $: idx = $orgStore.indexes

  // User normal (não-admin) fica travado na própria visão: força userId nele e
  // o DashboardFilters esconde os seletores de usuário/equipe (lockUser).
  const admin = isDashboardAdmin()
  const myPersonRef = getMyPersonRef()
  const lockToSelf = !admin
  // Trava reativa: re-fixa userId no próprio usuário sempre que ele desviar
  // (inclusive após Reset). Sem isso, userId vazio cairia no ramo de tabelas
  // por-pessoa, vazando dados de outros. Converge em 1 ciclo. Só não-admin.
  $: if (lockToSelf && $dashboardFilters.userId !== myPersonRef) {
    dashboardFilters.update((f) => ({ ...f, userId: myPersonRef, teamId: '' }))
  }

  // Pessoa efetivamente exibida na Individual (NÃO grava no store, que é global
  // e compartilhado com as outras abas — semear userId lá vazaria o recorte
  // pessoal p/ a aba Coordenador):
  // - usuário escolhido no filtro → ele;
  // - admin sem usuário E sem BU → ele próprio (sua dash pessoal por padrão);
  // - admin com BU mas sem usuário → '' (mantém o modo admin: tabelas por-pessoa).
  // User normal já é forçado a si pelo lockToSelf acima.
  $: effectiveUserId =
    $dashboardFilters.userId !== ''
      ? $dashboardFilters.userId
      : admin && $dashboardFilters.buId === ''
        ? (myPersonRef as string)
        : ''

  // Cargo da pessoa selecionada (position do 3F Core → Cargo) → libera os
  // blocos específicos do cargo.
  $: selectedCargo =
    idx != null && effectiveUserId !== '' ? (idx.cargoByPersonRef.get(effectiveUserId as Ref<Person>) ?? '') : ''
  $: isSocialMedia = selectedCargo === Cargo.SocialMedia
  // Designer e Editor de Vídeo compartilham o mesmo bloco: % alterações + Eficiência.
  $: isDesignerOrEditor = selectedCargo === Cargo.Designer || selectedCargo === Cargo.Editor
  $: cargoLabel =
    selectedCargo === Cargo.Designer ? operationalDashboard.string.CargoDesigner : operationalDashboard.string.CargoEditor

  // Seção de SQUAD na Individual: aparece p/ quem LIDERA ao menos um squad no 3F
  // Core (squad.leader_id == logado). Esse é o sinal real de "coordenador de
  // squad". Quem não lidera squad não vê a seção. Gate e resolução usam o store.
  function resolveSquad (indexes: OrgIndexes, person: Ref<Person>): Array<Ref<Person>> {
    const set = new Set<Ref<Person>>()
    for (const s of indexes.squadsByLeaderPersonRef.get(person) ?? []) {
      const leaderRef = s.leader_id != null ? indexes.personRefByCoreUserId.get(s.leader_id) : undefined
      if (leaderRef != null) set.add(leaderRef)
      for (const m of indexes.memberRefsBySquadId.get(s.id) ?? []) set.add(m)
    }
    return [...set]
  }
  // Gate: o LOGADO lidera algum squad?
  $: isSquadLead = idx != null && (idx.squadsByLeaderPersonRef.get(myPersonRef)?.length ?? 0) > 0
  // Squad do LOGADO. Só ativa o modo-squad quando há pessoa em foco
  // (effectiveUserId): assim o memberSet do squad NÃO contamina as tabelas
  // por-pessoa do modo admin (admin que escolhe BU sem usuário).
  $: squadMembers = idx != null && isSquadLead && effectiveUserId !== '' ? resolveSquad(idx, myPersonRef) : []

  let green: GreenResult = emptyGreenResult()
  let isLoading = false
  let pendingToken = 0

  $: $refreshTrigger,
  idx,
  squadMembers,
  effectiveUserId,
  void load({ ...$dashboardFilters, userId: effectiveUserId }, squadMembers)

  // Admin vendo uma BU específica sem usuário: além das tabelas da BU inteira
  // (green), mostramos TAMBÉM os cards pessoais do próprio admin. Isso exige um
  // recorte separado (green desse ramo é da BU toda; myGreen é só do admin,
  // limitado à BU selecionada). Não roda nos demais estados.
  $: showBoth = admin && $dashboardFilters.userId === '' && $dashboardFilters.buId !== ''
  let myGreen: GreenResult = emptyGreenResult()
  let myPendingToken = 0
  $: $refreshTrigger, idx, showBoth, void loadMe(showBoth, { ...$dashboardFilters, userId: myPersonRef })

  async function loadMe (active: boolean, filters: Filters): Promise<void> {
    if (!active || idx == null) {
      myGreen = emptyGreenResult()
      return
    }
    const token = ++myPendingToken
    try {
      const result = await computeGreen(client, filters, idx, [])
      if (token === myPendingToken) myGreen = result
    } catch (e) {
      console.error('[operational-dashboard] personal green computation failed', e)
    }
  }

  async function load (filters: Filters, squad: Ref<Person>[]): Promise<void> {
    const token = ++pendingToken
    // Org structure ainda carregando → nada a computar (o gate de cargo/squad
    // depende dela). Recarrega quando idx muda.
    if (idx == null) {
      isLoading = false
      return
    }
    // Sem usuário E sem BU: nada a computar (admin no estado inicial). Com
    // usuário (caso normal), computa mesmo sem BU = todos os projetos/BUs.
    if (filters.buId === '' && filters.userId === '') {
      green = emptyGreenResult()
      isLoading = false
      refreshState.set('idle')
      return
    }
    isLoading = true
    refreshState.set('loading')
    try {
      const result = await computeGreen(client, filters, idx, squad)
      if (token === pendingToken) {
        green = result
        markRefreshDone()
      }
    } catch (e) {
      console.error('[operational-dashboard] green metrics computation failed', e)
      if (token === pendingToken) markRefreshFailed()
    } finally {
      if (token === pendingToken) isLoading = false
    }
  }

  function rateValue (r: StageRate): string {
    return r.pct == null ? '—' : `${r.pct}%`
  }
  function hours (ms: number): string {
    return `${(ms / 3_600_000).toFixed(1)}h`
  }
  function rateSubtitle (r: StageRate): string {
    return r.withDue === 0 ? 'sem entregas no período' : `${r.onTime}/${r.withDue} no prazo`
  }
  function rateTone (r: StageRate, target: number | undefined): 'positive' | 'negative' | 'neutral' {
    return r.pct == null ? 'neutral' : toneForTarget(r.pct, target)
  }
  // Eficiência: verde ≥ meta, vermelho abaixo, sem teto (>100% segue verde).
  function efficiencyTone (pct: number | null, target: number): 'positive' | 'negative' | 'neutral' {
    return pct == null ? 'neutral' : pct >= target ? 'positive' : 'negative'
  }

  // Clique no card → lista paginada das tarefas que compõem a métrica.
  function openList (title: IntlString, rows: IssueRow[]): void {
    if (rows.length === 0) return
    showPopup(IssueListModal, { title, rows }, 'center')
  }

  // Drill-down das tabelas por-pessoa (squad/admin): a linha emite as issues +
  // o título (nome da pessoa em texto puro, ou IntlString "Total" no agregado).
  function openPerPerson (
    e: CustomEvent<{ issues: IssueRow[], titleText?: string, title?: IntlString }>
  ): void {
    const { issues, titleText, title } = e.detail
    if (issues == null || issues.length === 0) return
    showPopup(IssueListModal, { rows: issues, titleText, title }, 'center')
  }
</script>

<div class="individual">
  <div class="filters-row">
    <DashboardFilters hideClientStage lockUser={lockToSelf} allowAllBU />
    <DateRangePicker />
  </div>

  {#if effectiveUserId !== ''}
    <!-- Padrão para todos: 4 métricas da tabela. Por padrão TODOS os projetos/
         BUs do usuário; BU/Projeto estreitam. Atraso = atual; taxas = período.
         Cada card abre a lista paginada das tarefas que o compõem. -->
    <div class="metrics-grid" class:loading={isLoading}>
      <MetricCard
        title={operationalDashboard.string.OnTimeOverall}
        value={rateValue(green.overall)}
        subtitle={rateSubtitle(green.overall)}
        tone={rateTone(green.overall, green.onTimeTarget)}
        clickable={green.overallIssues.length > 0}
        on:click={() => openList(operationalDashboard.string.OnTimeOverall, green.overallIssues)}
      />
      <MetricCard
        title={operationalDashboard.string.Onboarding}
        value={rateValue(green.onboarding)}
        subtitle={rateSubtitle(green.onboarding)}
        tone={rateTone(green.onboarding, green.onTimeTarget)}
        clickable={green.onboardingIssues.length > 0}
        on:click={() => openList(operationalDashboard.string.Onboarding, green.onboardingIssues)}
      />
      <MetricCard
        title={operationalDashboard.string.Retention}
        value={rateValue(green.retention)}
        subtitle={rateSubtitle(green.retention)}
        tone={rateTone(green.retention, green.onTimeTarget)}
        clickable={green.retentionIssues.length > 0}
        on:click={() => openList(operationalDashboard.string.Retention, green.retentionIssues)}
      />
      <MetricCard
        title={operationalDashboard.string.OverdueTasks}
        value={String(green.overdueCount)}
        subtitle={green.activeCount > 0 ? `de ${green.activeCount} ativas` : 'nenhuma ativa'}
        tone={green.overdueCount === 0 ? 'positive' : 'negative'}
        clickable={green.overdueIssues.length > 0}
        on:click={() => openList(operationalDashboard.string.OverdueTasks, green.overdueIssues)}
      />
    </div>

    <!-- Bloco Social Media (verde da spec): aguardando aprovação + % alterações.
         Mesmos cards-quadrado dos demais; clique abre a lista paginada. Config
         (status de aprovação/revisão/ajustes) na aba Config. de Métricas. -->
    {#if isSocialMedia}
      <div class="section-title"><Label label={operationalDashboard.string.CargoSocialMedia} /></div>
      <div class="metrics-grid" class:loading={isLoading}>
        <MetricCard
          title={operationalDashboard.string.WaitingApprovalTitle}
          value={green.waitingApprovalConfigured ? String(green.waitingApprovalCount) : '—'}
          subtitle={green.waitingApprovalConfigured
            ? `de ${green.activeCount} ativas`
            : 'configure os status de aprovação'}
          clickable={green.waitingApprovalIssues.length > 0}
          on:click={() => openList(operationalDashboard.string.WaitingApprovalTitle, green.waitingApprovalIssues)}
        />
        <MetricCard
          title={operationalDashboard.string.ChangesAdjustments}
          value={green.changes.pct == null ? '—' : `${green.changes.pct}%`}
          subtitle={green.changes.configured
            ? `${hours(green.changes.reworkMs)} em ajustes · ${green.changes.issueCount} tarefas`
            : 'configure os status de revisão'}
          clickable={green.changesIssues.length > 0}
          on:click={() => openList(operationalDashboard.string.ChangesAdjustments, green.changesIssues)}
        />
      </div>
    {/if}

    <!-- Bloco Designer/Editor de Vídeo (spec "Padrão para todos +"): % alterações
         + Eficiência de tempo (estimativa vs tempo gasto). Mesmos cards-quadrado;
         clique abre a lista paginada com colunas estimativa/gasto/%. -->
    {#if isDesignerOrEditor}
      <div class="section-title"><Label label={cargoLabel} /></div>
      <div class="metrics-grid" class:loading={isLoading}>
        <MetricCard
          title={operationalDashboard.string.ChangesAdjustments}
          value={green.changes.pct == null ? '—' : `${green.changes.pct}%`}
          subtitle={green.changes.configured
            ? `${hours(green.changes.reworkMs)} em ajustes · ${green.changes.issueCount} tarefas`
            : 'configure os status de revisão'}
          clickable={green.changesIssues.length > 0}
          on:click={() => openList(operationalDashboard.string.ChangesAdjustments, green.changesIssues)}
        />
        <MetricCard
          title={operationalDashboard.string.EfficiencyTimeTitle}
          value={green.efficiency.pct == null ? '—' : `${green.efficiency.pct}%`}
          subtitle={green.efficiency.hasData
            ? `${green.efficiency.estimationHours.toFixed(1)}h est · ${green.efficiency.spentHours.toFixed(1)}h gastas · ${green.efficiency.issueCount} tarefas`
            : 'sem tarefas com estimativa e tempo'}
          tone={efficiencyTone(green.efficiency.pct, green.efficiencyTarget)}
          clickable={green.efficiencyIssues.length > 0}
          on:click={() => openList(operationalDashboard.string.EfficiencyTimeTitle, green.efficiencyIssues)}
        />
      </div>
    {/if}

    <!-- Bloco Coordenador/Líder QG (spec "todos os coordenadores de squad"):
         desempenho do SQUAD inteiro, não só o pessoal. Métrica #1 = taxa no prazo
         por pessoa, Onboarding/Retenção separados (showStages). Squad = união dos
         membros dos times que a pessoa lidera. #2/#3 da spec ficaram para depois. -->
    {#if isSquadLead}
      <div class="section-title"><Label label={operationalDashboard.string.SquadSection} /></div>
      {#if squadMembers.length === 0}
        <div class="empty-state"><Label label={operationalDashboard.string.NoSquad} /></div>
      {:else}
        <div class="tables" class:loading={isLoading}>
          <OnTimePerPersonTable
            rows={green.onTimePerPerson}
            target={green.onTimeTarget}
            total={green.onTimePerPersonTotal}
            totalIssues={green.onTimeScopeIssues}
            showStages
            on:select={openPerPerson}
          />
          <OverduePerPersonTable
            rows={green.overduePerPerson}
            total={green.overduePerPersonTotal}
            totalIssues={green.overdueScopeIssues}
            on:select={openPerPerson}
          />
        </div>
        <div class="panels-section" class:loading={isLoading}>
          <ClientsAtRiskPanel
            rows={green.clientsAtRisk}
            alertDays={green.retentionAlertDays}
            on:select={openPerPerson}
          />
          <ChangesAdjustmentsPanel result={green.squadChanges} />
        </div>
      {/if}
    {/if}
  {:else if $dashboardFilters.buId === ''}
    <div class="empty-state">
      <Label label={operationalDashboard.string.SelectBUFirst} />
    </div>
  {:else}
    <!-- Admin com BU sem pessoa: meus cards pessoais (myGreen, só eu na BU) +
         tabelas/painéis consolidados da BU inteira (green). -->
    <div class="section-title"><Label label={operationalDashboard.string.MyView} /></div>
    <div class="metrics-grid" class:loading={isLoading}>
      <MetricCard
        title={operationalDashboard.string.OnTimeOverall}
        value={rateValue(myGreen.overall)}
        subtitle={rateSubtitle(myGreen.overall)}
        tone={rateTone(myGreen.overall, myGreen.onTimeTarget)}
        clickable={myGreen.overallIssues.length > 0}
        on:click={() => openList(operationalDashboard.string.OnTimeOverall, myGreen.overallIssues)}
      />
      <MetricCard
        title={operationalDashboard.string.Onboarding}
        value={rateValue(myGreen.onboarding)}
        subtitle={rateSubtitle(myGreen.onboarding)}
        tone={rateTone(myGreen.onboarding, myGreen.onTimeTarget)}
        clickable={myGreen.onboardingIssues.length > 0}
        on:click={() => openList(operationalDashboard.string.Onboarding, myGreen.onboardingIssues)}
      />
      <MetricCard
        title={operationalDashboard.string.Retention}
        value={rateValue(myGreen.retention)}
        subtitle={rateSubtitle(myGreen.retention)}
        tone={rateTone(myGreen.retention, myGreen.onTimeTarget)}
        clickable={myGreen.retentionIssues.length > 0}
        on:click={() => openList(operationalDashboard.string.Retention, myGreen.retentionIssues)}
      />
      <MetricCard
        title={operationalDashboard.string.OverdueTasks}
        value={String(myGreen.overdueCount)}
        subtitle={myGreen.activeCount > 0 ? `de ${myGreen.activeCount} ativas` : 'nenhuma ativa'}
        tone={myGreen.overdueCount === 0 ? 'positive' : 'negative'}
        clickable={myGreen.overdueIssues.length > 0}
        on:click={() => openList(operationalDashboard.string.OverdueTasks, myGreen.overdueIssues)}
      />
    </div>

    <div class="section-title"><Label label={operationalDashboard.string.BuTeamSection} /></div>
    <!-- Admin sem pessoa selecionada: tabelas + painéis consolidados -->
    <div class="tables" class:loading={isLoading}>
      <OnTimePerPersonTable
        rows={green.onTimePerPerson}
        target={green.onTimeTarget}
        total={green.onTimePerPersonTotal}
        totalIssues={green.onTimeScopeIssues}
        on:select={openPerPerson}
      />
      <OverduePerPersonTable
        rows={green.overduePerPerson}
        total={green.overduePerPersonTotal}
        totalIssues={green.overdueScopeIssues}
        on:select={openPerPerson}
      />
    </div>

    <div class="panels-section" class:loading={isLoading}>
      <ChangesAdjustmentsPanel result={green.changes} />
      <WaitingApprovalPanel
        count={green.waitingApprovalCount}
        configured={green.waitingApprovalConfigured}
        activeCount={green.activeCount}
      />
      <PdcaOnTimePanel result={green.pdcaOnTime} target={green.onTimeTarget} />
      <CapacityPanel result={green.capacity} />
    </div>
  {/if}
</div>

<style lang="scss">
  .individual {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .panels-section {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    transition: opacity 0.15s ease;

    &.loading {
      opacity: 0.6;
    }
  }

  .filters-row {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }

  .section-title {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    transition: opacity 0.15s ease;

    &.loading {
      opacity: 0.6;
    }

    @media (max-width: 900px) {
      grid-template-columns: repeat(2, 1fr);
    }

    @media (max-width: 600px) {
      grid-template-columns: 1fr;
    }
  }

  .tables {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    transition: opacity 0.15s ease;

    &.loading {
      opacity: 0.6;
    }

    @media (max-width: 900px) {
      grid-template-columns: 1fr;
    }
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.5rem;
    color: var(--theme-dark-color);
    font-size: 0.95rem;
    text-align: center;
  }
</style>
