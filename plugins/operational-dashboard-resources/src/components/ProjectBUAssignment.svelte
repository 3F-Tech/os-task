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
  import { type Ref } from '@hcengineering/core'
  import { type BusinessUnit, type ProjectWithBU } from '@hcengineering/operational-dashboard'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import { ensureOrgStructure, orgStore } from '../orgStructure'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'

  // Único cadastro que permanece local: projeto → BU do 3F Core. A lista de BUs
  // vem do Core (read-through); o vínculo é gravado no mixin ProjectWithBU.
  void ensureOrgStructure()

  const canEdit = canEditDashboard()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  const projectsQuery = createQuery()
  let projects: Project[] = []
  $: projectsQuery.query(tracker.class.Project, { archived: false }, (res) => {
    projects = [...res].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  })

  // Dica de migração: nome da BU local antiga (doc órfão) enquanto o projeto não
  // recebeu um coreBuId. Só pra orientar quem for reatribuir.
  const legacyQuery = createQuery()
  let legacyBuName = new Map<Ref<BusinessUnit>, string>()
  $: legacyQuery.query(operationalDashboard.class.BusinessUnit, {}, (res) => {
    legacyBuName = new Map(res.map((b) => [b._id, b.name]))
  })

  $: bus = ($orgStore.indexes?.busList ?? [])
    .filter((b) => b.is_active)
    .sort((a, b) => a.name.localeCompare(b.name))

  function mixed (p: Project): ProjectWithBU {
    return hierarchy.as(p, operationalDashboard.mixin.ProjectWithBU) as ProjectWithBU
  }

  // coreBuId atual por projeto — reativo à live query (reflete o mixin gravado).
  $: currentBuId = new Map<Ref<Project>, number | undefined>(projects.map((p) => [p._id, mixed(p).coreBuId]))
  $: previousBu = new Map<Ref<Project>, string | undefined>(
    projects.map((p) => {
      const legacy = mixed(p).businessUnit
      return [p._id, legacy != null ? legacyBuName.get(legacy) : undefined]
    })
  )

  async function setBU (p: Project, value: string): Promise<void> {
    if (!canEdit) return
    const coreBuId = value === '' ? (null as unknown as number) : Number(value)
    if (hierarchy.hasMixin(p, operationalDashboard.mixin.ProjectWithBU)) {
      await client.updateMixin(p._id, p._class, p.space, operationalDashboard.mixin.ProjectWithBU, { coreBuId })
    } else {
      await client.createMixin(p._id, p._class, p.space, operationalDashboard.mixin.ProjectWithBU, { coreBuId })
    }
  }
</script>

<div class="projects-bu">
  <div class="header">
    <h2><Label label={operationalDashboard.string.ProjectsBU} /></h2>
  </div>
  <p class="hint"><Label label={operationalDashboard.string.ProjectsBUHint} /></p>

  {#if $orgStore.status === 'loading'}
    <div class="empty"><Label label={operationalDashboard.string.OrgLoading} /></div>
  {:else if $orgStore.status === 'error'}
    <div class="empty err"><Label label={operationalDashboard.string.OrgError} /> — {$orgStore.error}</div>
  {:else if bus.length === 0}
    <div class="empty"><Label label={operationalDashboard.string.NoCoreBUs} /></div>
  {:else if projects.length === 0}
    <div class="empty"><Label label={operationalDashboard.string.NoProjects} /></div>
  {:else}
    <div class="project-list">
      {#each projects as p (p._id)}
        <div class="project-row">
          <div class="project-info">
            <div class="project-name">{p.name}</div>
            {#if currentBuId.get(p._id) == null && previousBu.get(p._id) != null}
              <div class="legacy-hint">
                <Label label={operationalDashboard.string.PreviousBU} />: {previousBu.get(p._id)}
              </div>
            {/if}
          </div>
          <select
            value={currentBuId.get(p._id) != null ? String(currentBuId.get(p._id)) : ''}
            disabled={!canEdit}
            on:change={(e) => {
              void setBU(p, e.currentTarget.value)
            }}
          >
            <option value="">—</option>
            {#each bus as bu (bu.id)}
              <option value={String(bu.id)}>{bu.name}</option>
            {/each}
          </select>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .projects-bu {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .header h2 {
    margin: 0;
    font-size: 1.125rem;
    color: var(--theme-caption-color);
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

    &.err {
      color: var(--theme-error-color, #c4314b);
    }
  }

  .project-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .project-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }

  .project-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;

    .project-name {
      font-weight: 500;
      color: var(--theme-caption-color);
    }

    .legacy-hint {
      font-size: 0.75rem;
      color: var(--theme-dark-color);
    }
  }

  select {
    flex-shrink: 0;
    min-width: 12rem;
    padding: 0.375rem 0.5rem;
    background: var(--theme-button-bg);
    color: var(--theme-content-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;

    option {
      background: var(--theme-popup-color);
      color: var(--theme-content-color);
    }
  }
</style>
