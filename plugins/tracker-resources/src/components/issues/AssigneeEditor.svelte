<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import { Analytics } from '@hcengineering/analytics'
  import contact, { Employee, Person } from '@hcengineering/contact'
  import { CombineAvatars, UserInfo, UsersPopup, getPersonByPersonRefStore } from '@hcengineering/contact-resources'
  import { Doc, DocumentQuery, Ref, notEmpty } from '@hcengineering/core'
  import { RuleApplyResult, getClient, getDocRules } from '@hcengineering/presentation'
  import { Issue, TrackerEvents } from '@hcengineering/tracker'
  import { Button, ButtonKind, ButtonSize, IconSize, TooltipAlignment, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'

  type AssigneeObject = (Doc | any) & Pick<Issue, 'space' | 'component' | 'assignee' | 'identifier'>

  export let object: AssigneeObject | AssigneeObject[] | undefined = undefined
  export let value: AssigneeObject | AssigneeObject[] | undefined = undefined
  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'large'
  export let avatarSize: IconSize = 'card'
  export let tooltipAlignment: TooltipAlignment | undefined = undefined
  export let width: string = 'min-content'
  export let focusIndex: number | undefined = undefined
  export let short: boolean = false
  export let shouldShowName = true
  export let shrink: number = 0
  export let isAction: boolean = false
  export let readonly: boolean = false
  export let showStatus = true

  // Máximo de responsáveis por tarefa
  export const MAX_ASSIGNEES = 3

  $: _object =
    (typeof object !== 'string' ? object : undefined) ?? (typeof value !== 'string' ? value : undefined) ?? []

  $: docs = Array.isArray(_object) ? _object : [_object]
  $: cdocs = docs.filter((d) => '_class' in d) as Doc[]

  const client = getClient()
  const dispatch = createEventDispatcher()
  let progress = false

  function normalize (v: Ref<Person>[] | Ref<Person> | null | undefined): Ref<Person>[] {
    if (v == null) return []
    return Array.isArray(v) ? v : [v]
  }

  $: sel = normalize(Array.isArray(_object) ? _object[0]?.assignee : _object?.assignee)

  $: personByRefStore = getPersonByPersonRefStore(sel)
  $: persons = sel.map((p) => $personByRefStore.get(p)).filter(notEmpty) as Person[]

  function sameArray (a: Ref<Person>[], b: Ref<Person>[]): boolean {
    return a.length === b.length && a.every((it, idx) => it === b[idx])
  }

  const applyAssignees = async (newAssignees: Ref<Person>[] | null): Promise<void> => {
    const next = (newAssignees ?? []).slice(0, MAX_ASSIGNEES)
    const val: Ref<Person>[] | null = next.length > 0 ? next : null
    progress = true
    const ops = client.apply()
    for (const p of docs) {
      if ('_class' in p) {
        Analytics.handleEvent(TrackerEvents.IssueSetAssignee, { issue: p.identifier ?? p._id })
        await ops.update(p, { assignee: val })
      }
    }
    await ops.commit()
    progress = false

    dispatch('change', val)
  }

  let rulesQuery: RuleApplyResult<Employee> | undefined
  let query: DocumentQuery<Employee> = { active: true }
  $: if (cdocs.length > 0) {
    rulesQuery = getDocRules<Employee>(cdocs, 'assignee')
    if (rulesQuery !== undefined) {
      query = { ...(rulesQuery?.fieldQuery ?? {}), active: true }
    } else {
      query = { _id: 'none' as Ref<Employee>, active: true }
      rulesQuery = {
        disableEdit: true,
        disableUnset: true,
        fieldQuery: {}
      }
    }
  }

  $: disabled = readonly || rulesQuery?.disableEdit === true

  let pendingAction: Ref<Person>[] | undefined

  function openPopup (evt: MouseEvent): void {
    if (disabled) return
    let pending: Ref<Person>[] | undefined
    showPopup(
      UsersPopup,
      {
        _class: contact.mixin.Employee,
        docQuery: query,
        multiSelect: true,
        allowDeselect: false,
        selectedUsers: sel,
        readonly: disabled
      },
      evt.currentTarget as HTMLElement,
      () => {
        if (pending !== undefined && !sameArray(pending, sel)) {
          void applyAssignees(pending)
        }
        pending = undefined
      },
      (result) => {
        if (result != null) {
          pending = result
        }
      }
    )
  }
</script>

{#if _object}
  {#if isAction}
    <UsersPopup
      _class={contact.mixin.Employee}
      docQuery={query}
      multiSelect={true}
      allowDeselect={false}
      selectedUsers={sel}
      icon={contact.icon.Person}
      readonly={disabled}
      on:update={(evt) => {
        pendingAction = evt.detail
      }}
      on:close={() => {
        if (pendingAction !== undefined && !sameArray(pendingAction, sel)) {
          void applyAssignees(pendingAction)
        }
        pendingAction = undefined
        dispatch('close')
      }}
    />
  {:else}
    <Button
      id="assignee-button"
      icon={persons.length === 0 ? contact.icon.Person : undefined}
      label={persons.length === 0 ? tracker.string.Unassigned : undefined}
      notSelected={persons.length === 0}
      width={width ?? 'min-content'}
      {kind}
      {size}
      {focusIndex}
      justify={'left'}
      disabled={disabled || progress}
      showTooltip={{
        label: tracker.string.AssignTo,
        direction: tooltipAlignment
      }}
      on:click={openPopup}
    >
      <svelte:fragment slot="content">
        {#if persons.length > 0}
          <div class="flex-row-center flex-nowrap pointer-events-none" class:max-w-20={short}>
            {#if persons.length === 1}
              {#if shouldShowName}
                <UserInfo value={persons[0]} size={avatarSize} {showStatus} />
              {:else}
                <CombineAvatars _class={contact.mixin.Employee} items={sel} size={avatarSize} hideLimit />
              {/if}
            {:else}
              <CombineAvatars _class={contact.mixin.Employee} items={sel} size={avatarSize} hideLimit />
            {/if}
          </div>
        {/if}
      </svelte:fragment>
    </Button>
  {/if}
{/if}
