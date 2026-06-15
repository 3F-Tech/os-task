//
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
//

import activity, { type DocUpdateMessage } from '@hcengineering/activity'
import contact, { formatName, type Person } from '@hcengineering/contact'
import { type Client, type Ref, type Timestamp } from '@hcengineering/core'
import operationalDashboard, {
  type ProjectDashboardConfig,
  type ProjectWithBU,
  type Team
} from '@hcengineering/operational-dashboard'
import task from '@hcengineering/task'
import tracker, { type Issue, type IssueStatus, type Project } from '@hcengineering/tracker'
import { type DashboardFilters } from './stores'

export interface IssueRow {
  issue: Issue
  startedAt?: Timestamp
  completedAt?: Timestamp
  reworkCount?: number
}

export interface MetricResult {
  value: string
  subtitle: string
  tone: 'positive' | 'negative' | 'neutral'
  issues: IssueRow[]
}

export interface MetricsResult {
  onTime: MetricResult
  overdue: MetricResult
  workload: MetricResult
  cycleTime: MetricResult
  approvedNoChanges: MetricResult
  reworkCycles: MetricResult
  waitingApproval: MetricResult
}

export interface TeamRankingRow {
  team: Team
  memberCount: number
  activeCount: number
  onTimePct: number | null
  overduePct: number | null
  avgCycleDays: number | null
  avgRework: number | null
}

export type RankMetric = 'onTime' | 'overdue' | 'cycleTime' | 'rework'

export interface DashboardResult {
  metrics: MetricsResult
  ranking: TeamRankingRow[]
}

const NO_DATA = (): MetricResult => ({ value: '—', subtitle: '', tone: 'neutral', issues: [] })

interface Transition {
  time: Timestamp
  newStatus: Ref<IssueStatus>
}

interface ResolvedConfig {
  approvedSet: Set<Ref<IssueStatus>>
  reworkSet: Set<Ref<IssueStatus>>
  waitingApprovalSet: Set<Ref<IssueStatus>>
  cycleStartStatus?: Ref<IssueStatus>
}

interface IssueAnalysis {
  issue: Issue
  firstApproval?: Timestamp
  cycleStart: Timestamp
  reworkCount: number
}

const DAY_MS = 1000 * 60 * 60 * 24

function emptyResult (): MetricsResult {
  return {
    onTime: NO_DATA(),
    overdue: NO_DATA(),
    workload: NO_DATA(),
    cycleTime: NO_DATA(),
    approvedNoChanges: NO_DATA(),
    reworkCycles: NO_DATA(),
    waitingApproval: NO_DATA()
  }
}

export async function computeDashboard (
  client: Client,
  filters: DashboardFilters,
  teams: Team[]
): Promise<DashboardResult> {
  // BU é obrigatória — sem BU selecionada, não há dados a apresentar.
  if (filters.buId === '') return { metrics: emptyResult(), ranking: [] }

  const hierarchy = client.getHierarchy()

  // 1. Load projects + apply BU/Project filters
  const allProjects = await client.findAll(tracker.class.Project, { archived: false })
  let filteredProjects: Project[] = allProjects.filter((p) => {
    const m = hierarchy.as(p, operationalDashboard.mixin.ProjectWithBU) as ProjectWithBU
    return m.businessUnit === filters.buId
  })
  if (filters.projectId !== '') {
    filteredProjects = filteredProjects.filter((p) => p._id === (filters.projectId as Ref<Project>))
  }
  if (filteredProjects.length === 0) return { metrics: emptyResult(), ranking: [] }

  // 2. Per-project metrics config
  const configByProject = new Map<Ref<Project>, ResolvedConfig>()
  for (const p of filteredProjects) {
    const cfg = hierarchy.as(p, operationalDashboard.mixin.ProjectDashboardConfig) as ProjectDashboardConfig
    configByProject.set(p._id, {
      approvedSet: new Set(cfg.approvedStatuses ?? []),
      reworkSet: new Set(cfg.reworkStatuses ?? []),
      waitingApprovalSet: new Set(cfg.waitingApprovalStatuses ?? []),
      cycleStartStatus: cfg.cycleStartStatus
    })
  }

  // 3. Statuses (for category fallback)
  const allStatuses = await client.findAll(tracker.class.IssueStatus, {})
  const statusMap = new Map<Ref<IssueStatus>, IssueStatus>()
  for (const s of allStatuses) statusMap.set(s._id, s)

  const wonStatusIds = new Set(
    allStatuses.filter((s) => s.category === task.statusCategory.Won).map((s) => s._id)
  )

  const effectiveApproved = (projectId: Ref<Project>): Set<Ref<IssueStatus>> => {
    const cfg = configByProject.get(projectId)
    if (cfg != null && cfg.approvedSet.size > 0) return cfg.approvedSet
    return wonStatusIds
  }

  const isCancelled = (status: Ref<IssueStatus>): boolean =>
    statusMap.get(status)?.category === task.statusCategory.Lost

  // 4. Load issues — uma carga só, compartilhada entre métricas e ranking.
  // userId/teamId NÃO entram na query: membership em campo array não é
  // confiável no adapter Postgres/Cockroach — o filtro é feito client-side.
  const projectIds = filteredProjects.map((p) => p._id)
  const issueQuery: Record<string, unknown> = { space: { $in: projectIds } }
  if (filters.clientStage !== '') {
    issueQuery.clientStage = filters.clientStage
  }
  const allIssues = await client.findAll(tracker.class.Issue, issueQuery)

  const isDone = (status: Ref<IssueStatus>): boolean =>
    statusMap.get(status)?.category === task.statusCategory.Won
  const isActive = (i: Issue): boolean => {
    const approved = effectiveApproved(i.space)
    return !approved.has(i.status) && !isDone(i.status) && !isCancelled(i.status)
  }
  const allActiveIssues = allIssues.filter(isActive)

  // === Activity log for status transitions (todas as issues) ===
  const issueIds = allIssues.map((i) => i._id)
  const transitionsByIssue = new Map<Ref<Issue>, Transition[]>()
  if (issueIds.length > 0) {
    const messages = (await client.findAll(activity.class.DocUpdateMessage, {
      objectId: { $in: issueIds }
    })) as DocUpdateMessage[]

    for (const m of messages) {
      const upd = m.attributeUpdates
      if (upd?.attrKey !== 'status') continue
      const next = upd.set?.[0]
      if (typeof next !== 'string' || next.length === 0) continue
      const issueId = m.objectId as Ref<Issue>
      const list = transitionsByIssue.get(issueId) ?? []
      list.push({ time: m.modifiedOn ?? m.createdOn ?? 0, newStatus: next as Ref<IssueStatus> })
      transitionsByIssue.set(issueId, list)
    }
    for (const list of transitionsByIssue.values()) list.sort((a, b) => a.time - b.time)
  }

  // Per-issue analysis (todas as issues)
  const allAnalyses: IssueAnalysis[] = allIssues.map((issue) => {
    const cfg = configByProject.get(issue.space)
    const transitions = transitionsByIssue.get(issue._id) ?? []
    const approvedSet = effectiveApproved(issue.space)

    const firstApprovalTrans = transitions.find((t) => approvedSet.has(t.newStatus))

    let cycleStartTime = issue.createdOn ?? issue.modifiedOn ?? 0
    if (cfg?.cycleStartStatus != null) {
      const csTrans = transitions.find((t) => t.newStatus === cfg.cycleStartStatus)
      if (csTrans != null) cycleStartTime = csTrans.time
    }

    const reworkCount =
      firstApprovalTrans != null && cfg != null
        ? transitions.filter(
            (t) => t.time < firstApprovalTrans.time && cfg.reworkSet.has(t.newStatus)
          ).length
        : 0

    return {
      issue,
      firstApproval: firstApprovalTrans?.time,
      cycleStart: cycleStartTime,
      reworkCount
    }
  })

  // === Filtro client-side por usuário/equipe (só para as métricas) ===
  const teamForFilter = filters.teamId !== '' ? teams.find((t) => t._id === filters.teamId) : undefined
  const memberSet =
    teamForFilter != null ? new Set(teamForFilter.members.map((m) => m.person)) : undefined

  const matchesFilter = (i: Issue): boolean => {
    if (filters.userId !== '') {
      return (i.assignee ?? []).includes(filters.userId as Ref<Person>)
    }
    if (memberSet != null) {
      return (i.assignee ?? []).some((a) => memberSet.has(a))
    }
    return true
  }

  const activeIssues = allActiveIssues.filter(matchesFilter)
  const analyses = allAnalyses.filter((a) => matchesFilter(a.issue))

  // === M2: Overdue ===
  // Compara só a data (zera a hora) — uma tarefa que vence "hoje" não está atrasada,
  // só passa a contar como atrasada a partir do dia seguinte.
  const now = Date.now()
  const todayStart = (() => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  const isOverdue = (i: Issue): boolean => {
    if (i.dueDate == null) return false
    const due = new Date(i.dueDate)
    due.setHours(0, 0, 0, 0)
    return due.getTime() < todayStart
  }
  const overdueIssues = activeIssues.filter(isOverdue)
  const overduePct = activeIssues.length > 0
    ? Math.round((overdueIssues.length / activeIssues.length) * 100)
    : 0
  const overdue: MetricResult = {
    value: String(overdueIssues.length),
    subtitle:
      activeIssues.length > 0
        ? `${overduePct}% das ${activeIssues.length} ativas`
        : 'nenhuma ativa',
    tone:
      overdueIssues.length === 0
        ? 'positive'
        : overduePct > 30
          ? 'negative'
          : 'neutral',
    issues: overdueIssues.map((i) => ({ issue: i }))
  }

  // === M3: Workload ===
  let workload: MetricResult
  if (filters.userId !== '') {
    // Filtro por usuário ativo: a métrica vira "carga deste usuário".
    workload = {
      value: String(activeIssues.length),
      subtitle: 'tarefas ativas do usuário',
      tone: activeIssues.length > 15 ? 'negative' : activeIssues.length === 0 ? 'positive' : 'neutral',
      issues: activeIssues.map((i) => ({ issue: i }))
    }
  } else {
    // multi-assignee: issue conta na carga de cada responsável.
    // Com equipe filtrada, só membros entram na contagem.
    const byAssignee = new Map<Ref<Person>, number>()
    for (const i of activeIssues) {
      for (const key of i.assignee ?? []) {
        if (memberSet != null && !memberSet.has(key)) continue
        byAssignee.set(key, (byAssignee.get(key) ?? 0) + 1)
      }
    }
    const sortedAssignees = [...byAssignee.entries()].sort((a, b) => b[1] - a[1])
    if (sortedAssignees.length === 0) {
      // Ninguém atribuído, mas pode haver issues órfãs — entrega-as para o drill-down.
      workload = {
        value: '0',
        subtitle: activeIssues.length > 0 ? `${activeIssues.length} sem responsável` : 'ninguém alocado',
        tone: 'neutral',
        issues: activeIssues.map((i) => ({ issue: i }))
      }
    } else {
      const persons = await client.findAll(contact.class.Person, {
        _id: { $in: sortedAssignees.map(([id]) => id) }
      })
      const personMap = new Map(persons.map((p) => [p._id, p]))
      const [topId, topCount] = sortedAssignees[0]
      const topPerson = personMap.get(topId)
      const topName = topPerson != null ? formatName(topPerson.name ?? '') : '?'
      // Inclui também issues sem assignee — o drill-down agrupa por pessoa
      // e mostra "Sem responsável" como linha extra.
      const issueWeight = (i: (typeof activeIssues)[number]): number => {
        const counts = (i.assignee ?? []).map((a) => byAssignee.get(a) ?? 0)
        return counts.length > 0 ? Math.max(...counts) : -1
      }
      const issueKey = (i: (typeof activeIssues)[number]): string => (i.assignee ?? []).join(',')
      const sortedIssues = [...activeIssues].sort((a, b) => {
        const ca = issueWeight(a)
        const cb = issueWeight(b)
        if (cb !== ca) return cb - ca
        return issueKey(a).localeCompare(issueKey(b))
      })
      workload = {
        value: String(topCount),
        subtitle: `top: ${topName} (${sortedAssignees.length} pessoas)`,
        tone: topCount > 15 ? 'negative' : 'neutral',
        issues: sortedIssues.map((i) => ({ issue: i }))
      }
    }
  }

  // 7. Approved-in-period subset
  const { dateFrom, dateTo } = filters
  const inPeriod = (a: IssueAnalysis): boolean =>
    a.firstApproval != null && a.firstApproval >= dateFrom && a.firstApproval <= dateTo
  const approvedInPeriod = analyses.filter(inPeriod)

  // === M1: On Time ===
  let onTime: MetricResult
  const withDueDate = approvedInPeriod.filter((a) => a.issue.dueDate != null)
  if (withDueDate.length === 0) {
    onTime = { value: '—', subtitle: 'sem aprovações no período', tone: 'neutral', issues: [] }
  } else {
    const onTimeAnalyses = withDueDate.filter(
      (a) => (a.firstApproval as number) <= (a.issue.dueDate as number)
    )
    const pct = Math.round((onTimeAnalyses.length / withDueDate.length) * 100)
    onTime = {
      value: `${pct}%`,
      subtitle: `${onTimeAnalyses.length}/${withDueDate.length} no prazo`,
      tone: pct >= 80 ? 'positive' : pct < 50 ? 'negative' : 'neutral',
      issues: withDueDate.map((a) => ({ issue: a.issue, completedAt: a.firstApproval }))
    }
  }

  // === M4: Cycle Time ===
  let cycleTime: MetricResult
  if (approvedInPeriod.length === 0) {
    cycleTime = { value: '—', subtitle: 'sem aprovações no período', tone: 'neutral', issues: [] }
  } else {
    const cycles = approvedInPeriod.map(
      (a) => ((a.firstApproval as number) - a.cycleStart) / DAY_MS
    )
    const avg = cycles.reduce((s, c) => s + c, 0) / cycles.length
    const sorted = [...cycles].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    cycleTime = {
      value: `${avg.toFixed(1)} d`,
      subtitle: `mediana ${median.toFixed(1)}d, n=${cycles.length}`,
      tone: 'neutral',
      issues: approvedInPeriod.map((a) => ({
        issue: a.issue,
        startedAt: a.cycleStart,
        completedAt: a.firstApproval
      }))
    }
  }

  // === M5 + M6: rework metrics ===
  const hasReworkConfig = (a: IssueAnalysis): boolean => {
    const cfg = configByProject.get(a.issue.space)
    return cfg != null && cfg.reworkSet.size > 0
  }
  const withReworkConfig = approvedInPeriod.filter(hasReworkConfig)

  let approvedNoChanges: MetricResult
  let reworkCycles: MetricResult
  if (withReworkConfig.length === 0) {
    approvedNoChanges = {
      value: '—',
      subtitle: 'configure status de retrabalho',
      tone: 'neutral',
      issues: []
    }
    reworkCycles = {
      value: '—',
      subtitle: 'configure status de retrabalho',
      tone: 'neutral',
      issues: []
    }
  } else {
    const noChangesCount = withReworkConfig.filter((a) => a.reworkCount === 0).length
    const totalReworks = withReworkConfig.reduce((s, a) => s + a.reworkCount, 0)
    const pct = Math.round((noChangesCount / withReworkConfig.length) * 100)
    const avgRework = totalReworks / withReworkConfig.length

    approvedNoChanges = {
      value: `${pct}%`,
      subtitle: `${noChangesCount}/${withReworkConfig.length} sem ajuste`,
      tone: pct >= 80 ? 'positive' : pct < 50 ? 'negative' : 'neutral',
      issues: withReworkConfig.map((a) => ({
        issue: a.issue,
        completedAt: a.firstApproval,
        reworkCount: a.reworkCount
      }))
    }
    reworkCycles = {
      value: avgRework.toFixed(1),
      subtitle: `média de ciclos, n=${withReworkConfig.length}`,
      tone: avgRework < 1 ? 'positive' : avgRework > 3 ? 'negative' : 'neutral',
      issues: withReworkConfig.map((a) => ({
        issue: a.issue,
        completedAt: a.firstApproval,
        reworkCount: a.reworkCount
      }))
    }
  }

  // === M7: Waiting approval ===
  let waitingApproval: MetricResult
  const anyWaitingConfigured = [...configByProject.values()].some((c) => c.waitingApprovalSet.size > 0)
  if (!anyWaitingConfigured) {
    waitingApproval = {
      value: '—',
      subtitle: 'configure status de aguardando aprovação',
      tone: 'neutral',
      issues: []
    }
  } else {
    const waitingIssues = activeIssues.filter((i) => {
      const cfg = configByProject.get(i.space)
      return cfg != null && cfg.waitingApprovalSet.has(i.status)
    })
    const waitingPct = activeIssues.length > 0
      ? Math.round((waitingIssues.length / activeIssues.length) * 100)
      : 0
    waitingApproval = {
      value: String(waitingIssues.length),
      subtitle:
        activeIssues.length > 0
          ? `${waitingPct}% das ${activeIssues.length} ativas`
          : 'nenhuma ativa',
      tone:
        waitingIssues.length === 0
          ? 'neutral'
          : waitingPct > 30
            ? 'negative'
            : 'neutral',
      issues: waitingIssues.map((i) => ({ issue: i }))
    }
  }

  // === Ranking de equipes ===
  // Obedece BU/Projeto/Etapa/Período; ignora teamId/userId (compara todas as
  // equipes entre si — a equipe filtrada é só destacada na UI). Uma issue com
  // dois membros da mesma equipe conta uma vez para a equipe; uma pessoa em
  // duas equipes conta para ambas (consistente com multi-assignee).
  const rankedTeams = teams.filter((t) => !t.archived && t.members.length > 0)
  const ranking: TeamRankingRow[] = []
  if (rankedTeams.length > 0) {
    const personTeams = new Map<Ref<Person>, Set<Ref<Team>>>()
    for (const t of rankedTeams) {
      for (const m of t.members) {
        const set = personTeams.get(m.person) ?? new Set()
        set.add(t._id)
        personTeams.set(m.person, set)
      }
    }
    const teamsOf = (i: Issue): Set<Ref<Team>> => {
      const result = new Set<Ref<Team>>()
      for (const a of i.assignee ?? []) {
        const set = personTeams.get(a)
        if (set != null) for (const t of set) result.add(t)
      }
      return result
    }

    interface TeamAgg {
      active: number
      overdue: number
      approvedCount: number
      cycleSum: number
      withDue: number
      onTimeCount: number
      reworkN: number
      reworkSum: number
    }
    const aggByTeam = new Map<Ref<Team>, TeamAgg>()
    const aggOf = (id: Ref<Team>): TeamAgg => {
      let agg = aggByTeam.get(id)
      if (agg == null) {
        agg = { active: 0, overdue: 0, approvedCount: 0, cycleSum: 0, withDue: 0, onTimeCount: 0, reworkN: 0, reworkSum: 0 }
        aggByTeam.set(id, agg)
      }
      return agg
    }

    for (const i of allActiveIssues) {
      const od = isOverdue(i)
      for (const tid of teamsOf(i)) {
        const agg = aggOf(tid)
        agg.active++
        if (od) agg.overdue++
      }
    }

    for (const a of allAnalyses) {
      if (!inPeriod(a)) continue
      const cycleDays = ((a.firstApproval as number) - a.cycleStart) / DAY_MS
      const due = a.issue.dueDate
      const onTimeHit = due != null && (a.firstApproval as number) <= due
      const rework = hasReworkConfig(a)
      for (const tid of teamsOf(a.issue)) {
        const agg = aggOf(tid)
        agg.approvedCount++
        agg.cycleSum += cycleDays
        if (due != null) {
          agg.withDue++
          if (onTimeHit) agg.onTimeCount++
        }
        if (rework) {
          agg.reworkN++
          agg.reworkSum += a.reworkCount
        }
      }
    }

    for (const t of rankedTeams) {
      const agg = aggByTeam.get(t._id)
      ranking.push({
        team: t,
        memberCount: t.members.length,
        activeCount: agg?.active ?? 0,
        onTimePct:
          agg != null && agg.withDue > 0 ? Math.round((agg.onTimeCount / agg.withDue) * 100) : null,
        overduePct:
          agg != null && agg.active > 0 ? Math.round((agg.overdue / agg.active) * 100) : null,
        avgCycleDays: agg != null && agg.approvedCount > 0 ? agg.cycleSum / agg.approvedCount : null,
        avgRework: agg != null && agg.reworkN > 0 ? agg.reworkSum / agg.reworkN : null
      })
    }
  }

  return {
    metrics: { onTime, overdue, workload, cycleTime, approvedNoChanges, reworkCycles, waitingApproval },
    ranking
  }
}
