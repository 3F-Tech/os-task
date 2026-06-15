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
  import { type Team } from '@hcengineering/operational-dashboard'
  import { createQuery } from '@hcengineering/presentation'
  import { Button, IconAdd, Label, showPopup } from '@hcengineering/ui'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'
  import EditTeam from './EditTeam.svelte'

  const canEdit = canEditDashboard()
  const query = createQuery()
  let teams: Team[] = []

  $: query.query(operationalDashboard.class.Team, { archived: false }, (res) => {
    teams = res
  })

  function newTeam (): void {
    if (!canEdit) return
    showPopup(EditTeam, { team: null }, 'top')
  }

  function editTeam (team: Team): void {
    showPopup(EditTeam, { team }, 'top')
  }

  // Hues distintos e bem espaçados — evita swatches quase idênticos.
  const COLOR_HUES: number[] = [0, 36, 60, 110, 150, 185, 215, 255, 290, 325]

  function getColorHsl (color: number): string {
    const hue = COLOR_HUES[(color - 1) % COLOR_HUES.length]
    return `hsl(${hue}, 60%, 55%)`
  }
</script>

<div class="team-management">
  <div class="team-header">
    <h2><Label label={operationalDashboard.string.Teams} /></h2>
    {#if canEdit}
      <Button icon={IconAdd} label={operationalDashboard.string.NewTeam} kind="primary" on:click={newTeam} />
    {/if}
  </div>

  {#if teams.length === 0}
    <div class="empty">
      <Label label={operationalDashboard.string.NoTeams} />
    </div>
  {:else}
    <div class="team-grid">
      {#each teams as team (team._id)}
        <button class="team-card" on:click={() => editTeam(team)}>
          <div class="team-color" style="background: {getColorHsl(team.color)}" />
          <div class="team-info">
            <div class="team-name">{team.name}</div>
            {#if team.description}
              <div class="team-desc">{team.description}</div>
            {/if}
            <div class="team-members">
              {team.members.length} <Label label={operationalDashboard.string.Members} />
            </div>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .team-management {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .team-header {
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

  .team-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.75rem;
  }

  .team-card {
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

  .team-color {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .team-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 0.125rem;

    .team-name {
      font-weight: 500;
      color: var(--theme-caption-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .team-desc {
      font-size: 0.8125rem;
      color: var(--theme-content-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .team-members {
      font-size: 0.8125rem;
      color: var(--theme-dark-color);
    }
  }
</style>
