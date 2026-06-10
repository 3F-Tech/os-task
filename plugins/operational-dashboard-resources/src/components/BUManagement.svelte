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
  import { type BusinessUnit } from '@hcengineering/operational-dashboard'
  import { createQuery } from '@hcengineering/presentation'
  import { Button, IconAdd, Label, showPopup } from '@hcengineering/ui'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'
  import EditBusinessUnit from './EditBusinessUnit.svelte'

  const canEdit = canEditDashboard()
  const query = createQuery()
  let bus: BusinessUnit[] = []

  $: query.query(operationalDashboard.class.BusinessUnit, { archived: false }, (res) => {
    bus = res
  })

  function newBU (): void {
    if (!canEdit) return
    showPopup(EditBusinessUnit, { bu: null }, 'top')
  }

  function editBU (bu: BusinessUnit): void {
    showPopup(EditBusinessUnit, { bu }, 'top')
  }

  function getColorHsl (color: number): string {
    const hue = (color * 47) % 360
    return `hsl(${hue}, 60%, 55%)`
  }
</script>

<div class="bu-management">
  <div class="bu-header">
    <h2><Label label={operationalDashboard.string.BusinessUnits} /></h2>
    {#if canEdit}
      <Button icon={IconAdd} label={operationalDashboard.string.NewBusinessUnit} kind="primary" on:click={newBU} />
    {/if}
  </div>

  {#if bus.length === 0}
    <div class="empty">
      <Label label={operationalDashboard.string.NoBusinessUnits} />
    </div>
  {:else}
    <div class="bu-grid">
      {#each bus as bu (bu._id)}
        <button class="bu-card" on:click={() => editBU(bu)}>
          <div class="bu-color" style="background: {getColorHsl(bu.color)}" />
          <div class="bu-info">
            <div class="bu-name">{bu.name}</div>
            {#if bu.description}
              <div class="bu-desc">{bu.description}</div>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .bu-management {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .bu-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;

    h2 {
      margin: 0;
      font-size: 1.125rem;
      color: var(--theme-caption-color);
    }
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: var(--theme-dark-color);
  }

  .bu-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.75rem;
  }

  .bu-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease, border-color 0.15s ease;

    &:hover {
      background: var(--theme-button-hovered);
    }
  }

  .bu-color {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .bu-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 0.125rem;

    .bu-name {
      font-weight: 500;
      color: var(--theme-caption-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bu-desc {
      font-size: 0.8125rem;
      color: var(--theme-content-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
</style>
