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
  import { Label } from '@hcengineering/ui'
  import operationalDashboard from '../plugin'
  import BUManagement from './BUManagement.svelte'
  import MetricsConfig from './MetricsConfig.svelte'
  import OverviewMetrics from './OverviewMetrics.svelte'

  type Tab = 'overview' | 'businessUnits' | 'metricsConfig'
  let activeTab: Tab = 'overview'
</script>

<div class="dashboard-root">
  <header class="dashboard-header">
    <h1><Label label={operationalDashboard.string.OperationalDashboard} /></h1>
  </header>

  <nav class="dashboard-tabs">
    <button class:active={activeTab === 'overview'} on:click={() => (activeTab = 'overview')}>
      <Label label={operationalDashboard.string.Overview} />
    </button>
    <button class:active={activeTab === 'businessUnits'} on:click={() => (activeTab = 'businessUnits')}>
      <Label label={operationalDashboard.string.BusinessUnits} />
    </button>
    <button class:active={activeTab === 'metricsConfig'} on:click={() => (activeTab = 'metricsConfig')}>
      <Label label={operationalDashboard.string.MetricsConfig} />
    </button>
  </nav>

  <section class="dashboard-content">
    {#if activeTab === 'overview'}
      <OverviewMetrics />
    {:else if activeTab === 'businessUnits'}
      <BUManagement />
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
  }

  .dashboard-tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0 2rem;
    border-bottom: 1px solid var(--theme-divider-color);

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
