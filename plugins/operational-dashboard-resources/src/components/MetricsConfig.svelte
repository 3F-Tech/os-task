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
  import { type ProjectDashboardConfig } from '@hcengineering/operational-dashboard'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Label, showPopup } from '@hcengineering/ui'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'
  import EditProjectMetricsConfig from './EditProjectMetricsConfig.svelte'

  const canEdit = canEditDashboard()
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const query = createQuery()

  let projects: Project[] = []

  $: query.query(tracker.class.Project, { archived: false }, (res) => {
    projects = res
  })

  function isConfigured (p: Project): boolean {
    const config = hierarchy.as(p, operationalDashboard.mixin.ProjectDashboardConfig) as ProjectDashboardConfig
    return (config.approvedStatuses?.length ?? 0) > 0 || (config.reworkStatuses?.length ?? 0) > 0
  }

  function editConfig (project: Project): void {
    if (!canEdit) return
    showPopup(EditProjectMetricsConfig, { project }, 'top')
  }
</script>

<div class="metrics-config">
  <div class="config-header">
    <h2><Label label={operationalDashboard.string.MetricsConfig} /></h2>
  </div>

  <p class="hint">
    Para cada projeto, marque quais status indicam aprovação final, retrabalho e início da
    contagem do tempo de ciclo.
  </p>

  {#if projects.length === 0}
    <div class="empty">
      <Label label={operationalDashboard.string.NoProjects} />
    </div>
  {:else}
    <div class="project-list">
      {#each projects as project (project._id)}
        <button class="project-card" on:click={() => editConfig(project)}>
          <div class="project-info">
            <div class="project-name">{project.name}</div>
            <div class="project-status" class:configured={isConfigured(project)}>
              {#if isConfigured(project)}
                <Label label={operationalDashboard.string.Configured} />
              {:else}
                <Label label={operationalDashboard.string.NotConfigured} />
              {/if}
            </div>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .metrics-config {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .config-header {
    h2 {
      margin: 0;
      font-size: 1.125rem;
      color: var(--theme-caption-color);
    }
  }

  .hint {
    margin: 0 0 0.5rem;
    color: var(--theme-content-color);
    font-size: 0.875rem;
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: var(--theme-dark-color);
  }

  .project-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .project-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.15s ease;

    &:hover {
      background: var(--theme-button-hovered);
    }
  }

  .project-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 1rem;

    .project-name {
      font-weight: 500;
      color: var(--theme-caption-color);
    }

    .project-status {
      font-size: 0.8125rem;
      color: var(--theme-dark-color);
      padding: 0.125rem 0.5rem;
      border-radius: 999px;
      background: var(--theme-divider-color);

      &.configured {
        color: #2ecc71;
        background: rgba(46, 204, 113, 0.15);
      }
    }
  }
</style>
