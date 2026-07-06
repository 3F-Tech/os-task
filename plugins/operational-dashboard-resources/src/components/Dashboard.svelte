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
  import { Cargo } from '@hcengineering/operational-dashboard'
  import { Label } from '@hcengineering/ui'
  import { getMyPersonRef, isDashboardAdmin } from '../permissions'
  import operationalDashboard from '../plugin'
  import IndividualView from './IndividualView.svelte'
  import EfficiencyView from './EfficiencyView.svelte'
  import QGView from './QGView.svelte'
  import MetricsConfig from './MetricsConfig.svelte'
  import OverviewMetrics from './OverviewMetrics.svelte'
  import ProjectBUAssignment from './ProjectBUAssignment.svelte'
  import { ensureOrgStructure, orgStore } from '../orgStructure'

  // Carrega a org structure da 3F Core (BU/squad/cargo) uma vez.
  void ensureOrgStructure()

  type Tab =
    | 'overview'
    | 'individual'
    | 'efficiency'
    | 'qgLeader'
    | 'projectsBU'
    | 'metricsConfig'

  const admin = isDashboardAdmin()
  const myPersonRef = getMyPersonRef()

  // Cargo do usuário logado (position do 3F Core → Cargo) libera as abas extras
  // (Líder QG). Vem do store de org structure.
  $: myCargo = $orgStore.indexes?.cargoByPersonRef.get(myPersonRef) ?? ''

  // Visibilidade das abas por nível (Cargo + AccountRole). User normal → só
  // Individual; Líder QG → sua aba; Maintainer+ → tudo + admin. A visão do
  // Coordenador NÃO é mais aba: vive dentro da Individual (seção de squad),
  // liberada pelo cargo do logado.
  $: visible = {
    overview: admin,
    individual: true,
    efficiency: admin,
    qgLeader: admin || myCargo === Cargo.QGLeader,
    projectsBU: admin,
    metricsConfig: admin
  }

  let activeTab: Tab = admin ? 'overview' : 'individual'
  // Se a aba ativa deixar de ser visível (ex.: cargo carregou depois), cai para
  // a Individual, que é sempre visível.
  $: if (!visible[activeTab]) activeTab = 'individual'
</script>

<div class="dashboard-root">
  <header class="dashboard-header">
    <h1><Label label={operationalDashboard.string.OperationalDashboard} /></h1>
    {#if $orgStore.status === 'error'}
      <div class="diag err"><Label label={operationalDashboard.string.OrgError} /> — {$orgStore.error}</div>
    {/if}
  </header>

  <nav class="dashboard-tabs">
    {#if visible.overview}
      <button class:active={activeTab === 'overview'} on:click={() => (activeTab = 'overview')}>
        <Label label={operationalDashboard.string.Overview} />
      </button>
    {/if}
    <button class:active={activeTab === 'individual'} on:click={() => (activeTab = 'individual')}>
      <Label label={operationalDashboard.string.Individual} />
    </button>
    {#if visible.efficiency}
      <button class:active={activeTab === 'efficiency'} on:click={() => (activeTab = 'efficiency')}>
        <Label label={operationalDashboard.string.EfficiencyTitle} />
      </button>
    {/if}
    {#if visible.qgLeader}
      <button class:active={activeTab === 'qgLeader'} on:click={() => (activeTab = 'qgLeader')}>
        <Label label={operationalDashboard.string.QGLeader} />
      </button>
    {/if}
    {#if admin}
      <div class="nav-spacer" />
      <button class:active={activeTab === 'projectsBU'} on:click={() => (activeTab = 'projectsBU')}>
        <Label label={operationalDashboard.string.ProjectsBU} />
      </button>
      <button class:active={activeTab === 'metricsConfig'} on:click={() => (activeTab = 'metricsConfig')}>
        <Label label={operationalDashboard.string.MetricsConfig} />
      </button>
    {/if}
  </nav>

  <section class="dashboard-content">
    {#if activeTab === 'overview'}
      <OverviewMetrics />
    {:else if activeTab === 'individual'}
      <IndividualView />
    {:else if activeTab === 'efficiency'}
      <EfficiencyView />
    {:else if activeTab === 'qgLeader'}
      <QGView />
    {:else if activeTab === 'projectsBU'}
      <ProjectBUAssignment />
    {:else if activeTab === 'metricsConfig'}
      <MetricsConfig />
    {/if}
  </section>
</div>

<style lang="scss">
  .dashboard-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    flex: 1;
    min-width: 0;
    background: var(--theme-bg-color);
  }

  .dashboard-header {
    padding: 2rem 2rem 1rem;

    h1 {
      margin: 0;
      font-size: 1.5rem;
      color: var(--theme-caption-color);
    }

    .diag {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      font-family: var(--mono-font, monospace);
      color: var(--theme-dark-color);

      &.err {
        color: var(--theme-error-color, #c4314b);
      }
    }
  }

  .dashboard-tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0 2rem;
    border-bottom: 1px solid var(--theme-divider-color);

    .nav-spacer {
      flex: 1;
    }

    button {
      background: none;
      border: none;
      padding: 0.625rem 1rem;
      color: var(--theme-content-color);
      cursor: pointer;
      font-weight: 500;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color 0.15s ease, border-color 0.15s ease;

      &.active {
        color: var(--theme-caption-color);
        border-bottom-color: var(--theme-caption-color);
      }

      &:hover:not(.active) {
        color: var(--theme-caption-color);
      }
    }
  }

  .dashboard-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 2rem;
  }
</style>
