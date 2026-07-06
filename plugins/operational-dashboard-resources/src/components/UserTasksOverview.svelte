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
  import { type Person } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import tracker, { type Issue, type IssueStatus, type Project } from '@hcengineering/tracker'
  import { showPopup } from '@hcengineering/ui'
  import { type IssueRow } from '../metrics'
  import operationalDashboard from '../plugin'
  import IssueListModal from './IssueListModal.svelte'
  import MetricCard from './MetricCard.svelte'

  // Cards-resumo das tarefas do usuário, em qualquer projeto ATIVO (todas as
  // BUs, ignora o período — foto atual do backlog pessoal). Clique no card →
  // lista paginada (IssueListModal). Carrega dados próprios.
  export let person: string = ''

  const projectsQuery = createQuery()
  const statusesQuery = createQuery()
  const issuesQuery = createQuery()

  let projects: Project[] = []
  let statuses: IssueStatus[] = []
  let issues: Issue[] = []

  $: projectsQuery.query(tracker.class.Project, { archived: false }, (res) => {
    projects = res
  })
  $: statusesQuery.query(tracker.class.IssueStatus, {}, (res) => {
    statuses = res
  })

  $: activeIds = projects.map((p) => p._id)
  $: statusMap = new Map(statuses.map((s) => [s._id, s]))

  // Membership em ArrOf: filtro escalar funciona no adapter Cockroach + live
  // query (assignee é Ref<Person>[]); cast só para satisfazer o tipo.
  $: if (person !== '' && activeIds.length > 0) {
    issuesQuery.query(
      tracker.class.Issue,
      { space: { $in: activeIds }, assignee: person as unknown as Ref<Person>[] },
      (res) => {
        issues = res
      }
    )
  } else {
    issues = []
  }

  const todayStart = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  function isOverdue (dueDate: number | null | undefined): boolean {
    if (dueDate == null) return false
    const d = new Date(dueDate)
    d.setHours(0, 0, 0, 0)
    return d.getTime() < todayStart
  }

  // Só abertas: exclui Won (concluída) e Lost (cancelada).
  $: openIssues = issues.filter((i) => {
    const cat = statusMap.get(i.status)?.category
    return cat !== task.statusCategory.Won && cat !== task.statusCategory.Lost
  })
  $: overdueIssues = openIssues.filter((i) => isOverdue(i.dueDate))

  function openList (title: IntlString, list: Issue[]): void {
    if (list.length === 0) return
    const rows: IssueRow[] = list.map((i) => ({ issue: i }))
    showPopup(IssueListModal, { title, rows }, 'center')
  }
</script>

<div class="cards">
  <MetricCard
    title={operationalDashboard.string.AssignedTasks}
    value={openIssues.length}
    subtitle="em projetos ativos · todas as BUs"
    clickable={openIssues.length > 0}
    on:click={() => openList(operationalDashboard.string.AssignedTasks, openIssues)}
  />
  <MetricCard
    title={operationalDashboard.string.OverdueTasks}
    value={overdueIssues.length}
    subtitle={openIssues.length > 0 ? `de ${openIssues.length} abertas` : 'nenhuma aberta'}
    tone={overdueIssues.length > 0 ? 'negative' : 'positive'}
    clickable={overdueIssues.length > 0}
    on:click={() => openList(operationalDashboard.string.OverdueTasks, overdueIssues)}
  />
</div>

<style lang="scss">
  .cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;

    @media (max-width: 900px) {
      grid-template-columns: repeat(2, 1fr);
    }

    @media (max-width: 600px) {
      grid-template-columns: 1fr;
    }
  }
</style>
