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
  import { Person } from '@hcengineering/contact'
  import { AccountArrayEditor, employeeRefByAccountUuidStore } from '@hcengineering/contact-resources'
  import {
    AccountRole,
    AccountUuid,
    Doc,
    Ref,
    getCurrentAccount,
    hasAccountRole,
    notEmpty
  } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import task, { Project } from '@hcengineering/task'
  import { TeamPlannerSettings } from '@hcengineering/time'
  import time from '../../plugin'

  export let space: Ref<Project>

  const client = getClient()
  const canEdit = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  let project: Project | undefined

  const query = createQuery()
  $: query.query(task.class.Project, { _id: space }, (res) => {
    ;[project] = res
  })

  // Candidate pool for the picker is restricted to current project members.
  $: memberPersons = (project?.members ?? [])
    .map((it) => $employeeRefByAccountUuidStore.get(it))
    .filter(notEmpty) as Array<Ref<Person>>

  $: visibleMembers =
    project !== undefined && client.getHierarchy().hasMixin(project, time.mixin.TeamPlannerSettings)
      ? client.getHierarchy().as<Doc, TeamPlannerSettings>(project, time.mixin.TeamPlannerSettings).visibleMembers
      : undefined

  async function onChange (value: AccountUuid[]): Promise<void> {
    if (project === undefined) return
    await client.updateMixin(project._id, task.class.Project, project.space, time.mixin.TeamPlannerSettings, {
      visibleMembers: value
    })
  }
</script>

{#if canEdit && project !== undefined}
  <AccountArrayEditor
    label={time.string.VisibleMembers}
    emptyLabel={time.string.RegisterUsers}
    value={visibleMembers ?? []}
    includeItems={memberPersons}
    {onChange}
    kind={'regular'}
    size={'medium'}
  />
{/if}
