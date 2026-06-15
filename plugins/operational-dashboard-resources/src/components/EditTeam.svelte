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
  import core, { type Ref } from '@hcengineering/core'
  import { type Team, type TeamMember } from '@hcengineering/operational-dashboard'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Button, EditBox, IconAdd, IconDelete, Label, Toggle, themeStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { canEditDashboard } from '../permissions'
  import operationalDashboard from '../plugin'

  export let team: Team | null = null

  const canEdit = canEditDashboard()
  const dispatch = createEventDispatcher()
  const client = getClient()

  let name: string = team?.name ?? ''
  let description: string = team?.description ?? ''
  let color: number = team?.color ?? 1
  let archived: boolean = team?.archived ?? false

  interface MemberRow {
    person: Ref<Person> | ''
    role: string
  }
  let rows: MemberRow[] = (team?.members ?? []).map((m) => ({ person: m.person, role: m.role }))

  const personsQuery = createQuery()
  let persons: Person[] = []
  $: personsQuery.query(contact.class.Person, {}, (res) => {
    persons = [...res].sort((a, b) => formatName(a.name ?? '').localeCompare(formatName(b.name ?? '')))
  })

  let roleSuggestions: string[] = []
  $: void Promise.all([
    translate(operationalDashboard.string.RoleLeader, {}, $themeStore.language),
    translate(operationalDashboard.string.RoleManager, {}, $themeStore.language),
    translate(operationalDashboard.string.RoleMember, {}, $themeStore.language)
  ]).then((res) => {
    roleSuggestions = res
  })

  const colors: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  // Hues distintos e bem espaçados — evita swatches quase idênticos.
  const COLOR_HUES: number[] = [0, 36, 60, 110, 150, 185, 215, 255, 290, 325]

  function getColorHsl (c: number): string {
    const hue = COLOR_HUES[(c - 1) % COLOR_HUES.length]
    return `hsl(${hue}, 60%, 55%)`
  }

  function availablePersons (row: MemberRow): Person[] {
    const taken = new Set(rows.filter((r) => r !== row && r.person !== '').map((r) => r.person))
    return persons.filter((p) => p._id === row.person || !taken.has(p._id))
  }

  function addRow (): void {
    rows = [...rows, { person: '', role: '' }]
  }

  function removeRow (index: number): void {
    rows = rows.filter((_, i) => i !== index)
  }

  async function save (): Promise<void> {
    if (!canEdit) return
    if (name.trim() === '') return

    const seen = new Set<Ref<Person>>()
    const members: TeamMember[] = []
    for (const r of rows) {
      if (r.person === '' || seen.has(r.person as Ref<Person>)) continue
      seen.add(r.person as Ref<Person>)
      members.push({ person: r.person as Ref<Person>, role: r.role.trim() })
    }

    if (team == null) {
      await client.createDoc(operationalDashboard.class.Team, core.space.Workspace, {
        name: name.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        color,
        archived: false,
        members
      })
    } else {
      await client.update(team, {
        name: name.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        color,
        archived,
        members
      })
    }

    dispatch('close')
  }

  function cancel (): void {
    dispatch('close')
  }
</script>

<div class="edit-team-popup">
  <header>
    <h3>
      <Label
        label={team == null ? operationalDashboard.string.NewTeam : operationalDashboard.string.EditTeam}
      />
    </h3>
  </header>

  <div class="form">
    <div class="field">
      <Label label={operationalDashboard.string.Name} />
      <EditBox
        bind:value={name}
        placeholder={operationalDashboard.string.TeamNamePlaceholder}
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

    <div class="field">
      <Label label={operationalDashboard.string.Members} />
      <datalist id="team-roles">
        {#each roleSuggestions as role}
          <option value={role} />
        {/each}
      </datalist>
      {#if rows.length > 0}
        <div class="members-list">
          {#each rows as row, i (i)}
            <div class="member-row">
              <select bind:value={row.person} disabled={!canEdit} on:change={() => (rows = [...rows])}>
                <option value="">—</option>
                {#each availablePersons(row) as p (p._id)}
                  <option value={p._id}>{formatName(p.name ?? '')}</option>
                {/each}
              </select>
              <input
                type="text"
                list="team-roles"
                bind:value={row.role}
                placeholder="Papel..."
                disabled={!canEdit}
              />
              {#if canEdit}
                <Button icon={IconDelete} kind="ghost" on:click={() => removeRow(i)} />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if canEdit}
        <Button icon={IconAdd} label={operationalDashboard.string.AddMember} kind="ghost" on:click={addRow} />
      {/if}
    </div>

    {#if team != null}
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
  .edit-team-popup {
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

    .members-list {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      max-height: 14rem;
      overflow-y: auto;
      border: 1px solid var(--theme-divider-color);
      border-radius: 0.375rem;
      padding: 0.375rem;
    }

    .member-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;

      select {
        flex: 1.4;
        min-width: 0;
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

      input {
        flex: 1;
        min-width: 0;
        padding: 0.375rem 0.5rem;
        background: var(--theme-button-bg);
        color: var(--theme-content-color);
        border: 1px solid var(--theme-divider-color);
        border-radius: 0.375rem;
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
