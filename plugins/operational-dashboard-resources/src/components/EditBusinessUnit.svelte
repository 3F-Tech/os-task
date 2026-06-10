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
  import core, { type Ref } from '@hcengineering/core'
  import { type BusinessUnit, type ProjectWithBU } from '@hcengineering/operational-dashboard'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Button, EditBox, Label, Toggle } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'

  export let bu: BusinessUnit | null = null

  const canEdit = canEditDashboard()
  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  let name: string = bu?.name ?? ''
  let description: string = bu?.description ?? ''
  let color: number = bu?.color ?? 1
  let archived: boolean = bu?.archived ?? false

  const projectsQuery = createQuery()
  let projects: Project[] = []
  let selectedProjectIds: Set<Ref<Project>> = new Set()
  let initialized = false

  $: projectsQuery.query(tracker.class.Project, { archived: false }, (res) => {
    projects = res
    if (!initialized && bu != null) {
      const next = new Set<Ref<Project>>()
      for (const p of res) {
        const mixed = hierarchy.as(p, operationalDashboard.mixin.ProjectWithBU) as ProjectWithBU
        if (mixed.businessUnit === bu._id) {
          next.add(p._id)
        }
      }
      selectedProjectIds = next
      initialized = true
    }
  })

  const colors: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  function getColorHsl (c: number): string {
    return `hsl(${(c * 47) % 360}, 60%, 55%)`
  }

  function toggleProject (id: Ref<Project>): void {
    const next = new Set(selectedProjectIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    selectedProjectIds = next
  }

  async function save (): Promise<void> {
    if (!canEdit) return
    if (name.trim() === '') return

    let buId: Ref<BusinessUnit>
    if (bu == null) {
      buId = await client.createDoc(operationalDashboard.class.BusinessUnit, core.space.Workspace, {
        name: name.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        color,
        archived: false
      })
    } else {
      buId = bu._id
      await client.update(bu, {
        name: name.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        color,
        archived
      })
    }

    for (const p of projects) {
      const mixed = hierarchy.as(p, operationalDashboard.mixin.ProjectWithBU) as ProjectWithBU
      const currentBU = mixed.businessUnit
      const shouldBelong = selectedProjectIds.has(p._id)

      if (shouldBelong && currentBU !== buId) {
        await client.createMixin(p._id, p._class, p.space, operationalDashboard.mixin.ProjectWithBU, {
          businessUnit: buId
        })
      } else if (!shouldBelong && currentBU === buId) {
        await client.updateMixin(p._id, p._class, p.space, operationalDashboard.mixin.ProjectWithBU, {
          businessUnit: null as unknown as Ref<BusinessUnit>
        })
      }
    }

    dispatch('close')
  }

  function cancel (): void {
    dispatch('close')
  }
</script>

<div class="edit-bu-popup">
  <header>
    <h3>
      <Label
        label={bu == null
          ? operationalDashboard.string.NewBusinessUnit
          : operationalDashboard.string.EditBusinessUnit}
      />
    </h3>
  </header>

  <div class="form">
    <div class="field">
      <Label label={operationalDashboard.string.Name} />
      <EditBox
        bind:value={name}
        placeholder={operationalDashboard.string.NamePlaceholder}
        kind="default"
        autoFocus
      />
    </div>

    <div class="field">
      <Label label={operationalDashboard.string.Description} />
      <EditBox
        bind:value={description}
        placeholder={operationalDashboard.string.DescriptionPlaceholder}
        kind="default"
      />
    </div>

    <div class="field">
      <Label label={operationalDashboard.string.Color} />
      <div class="color-row">
        {#each colors as c}
          <button
            class="color-swatch"
            class:selected={color === c}
            style="background: {getColorHsl(c)}"
            on:click={() => (color = c)}
            aria-label={`Color ${c}`}
          />
        {/each}
      </div>
    </div>

    {#if projects.length > 0}
      <div class="field">
        <Label label={operationalDashboard.string.AssociatedProjects} />
        <div class="projects-list">
          {#each projects as p (p._id)}
            <label class="project-row">
              <input
                type="checkbox"
                checked={selectedProjectIds.has(p._id)}
                on:change={() => toggleProject(p._id)}
              />
              <span>{p.name}</span>
            </label>
          {/each}
        </div>
      </div>
    {/if}

    {#if bu != null}
      <div class="field row">
        <Label label={operationalDashboard.string.Archived} />
        <Toggle bind:on={archived} />
      </div>
    {/if}
  </div>

  <footer>
    <Button label={operationalDashboard.string.Cancel} on:click={cancel} />
    {#if canEdit}
      <Button
        label={operationalDashboard.string.Save}
        kind="primary"
        on:click={save}
        disabled={name.trim() === ''}
      />
    {/if}
  </footer>
</div>

<style lang="scss">
  .edit-bu-popup {
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.625rem;
    padding: 1.25rem;
    min-width: 28rem;
    max-width: 36rem;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--theme-popup-shadow);

    header {
      margin-bottom: 1rem;

      h3 {
        margin: 0;
        font-size: 1.125rem;
        color: var(--theme-caption-color);
      }
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      flex: 1;
      overflow-y: auto;
      padding-right: 0.25rem;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;

      &.row {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
      }
    }

    .color-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .color-swatch {
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      padding: 0;

      &.selected {
        border-color: var(--theme-caption-color);
      }
    }

    .projects-list {
      max-height: 12rem;
      overflow-y: auto;
      border: 1px solid var(--theme-divider-color);
      border-radius: 0.375rem;
      padding: 0.375rem;
    }

    .project-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      cursor: pointer;

      &:hover {
        background: var(--theme-button-hovered);
      }

      span {
        color: var(--theme-content-color);
      }
    }

    footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--theme-divider-color);
    }
  }
</style>
