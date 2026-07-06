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

// Métricas "verdes" da Fase 1 (CP3+). Módulo SEPARADO do metrics.ts de
// propósito. O CRITÉRIO de "no prazo" por issue é idêntico ao do M1 (primeira
// transição para um status aprovado/done <= dueDate, dentro do período) e a
// carga de dados espelha a de computeDashboard. ATENÇÃO: a visão verde conta
// apenas issues-raiz (decisão #6) e ignora o filtro de Etapa, enquanto o card
// do Overview conta todas as issues e respeita a Etapa — então as porcentagens
// agregadas PODEM divergir do Overview por design. Um refactor futuro pode
// extrair um loader compartilhado.

import activity, { type DocUpdateMessage } from '@hcengineering/activity'
import contact, { formatName, type Person } from '@hcengineering/contact'
import core, { type Client, type Ref, type Timestamp, type TxCreateDoc } from '@hcengineering/core'
import operationalDashboard, {
  Cargo,
  type ProjectDashboardConfig,
  type ProjectWithBU
} from '@hcengineering/operational-dashboard'
import task from '@hcengineering/task'
import tracker, { type Issue, type IssueStatus, type Project } from '@hcengineering/tracker'
import calendar, { type Event, type ReccuringEvent, getAllEvents } from '@hcengineering/calendar'
import { type IssueRow } from './metrics'
import { type DashboardFilters } from './stores'
import { type OrgIndexes, squadsAsTeams } from './orgStructure'

/** Taxa no prazo de um recorte (geral ou por etapa). */
export interface StageRate {
  withDue: number
  onTime: number
  pct: number | null
}

export interface PersonOnTimeRow {
  person: Ref<Person>
  name: string
  withDue: number
  onTime: number
  pct: number | null
  /** Taxa no prazo só das issues Onboarding desta pessoa (CP10 — Coordenador). */
  onbPct: number | null
  /** Taxa no prazo só das issues Retenção desta pessoa (CP10 — Coordenador). */
  retPct: number | null
  /** Issues que compõem a métrica desta pessoa (drill-down ao clicar a linha). */
  issues: IssueRow[]
}

export interface PersonOverdueRow {
  person: Ref<Person>
  name: string
  overdue: number
  active: number
  /** Issues atrasadas desta pessoa (drill-down ao clicar a linha). */
  issues: IssueRow[]
}

/** Linha de TOTAL (agregado do escopo/squad) da tabela de entrega no prazo.
 * % é recomputado de numerador/denominador somados — nunca média de %. */
export interface OnTimeAggregate {
  withDue: number
  onTime: number
  pct: number | null
  onbPct: number | null
  retPct: number | null
}

/** Linha de TOTAL da tabela de atraso por pessoa. */
export interface OverdueAggregate {
  overdue: number
  active: number
}

/** Uma tarefa no detalhe de "% de alterações e ajustes". */
export interface ChangesIssueRow {
  issueId: Ref<Issue>
  identifier: string
  title: string
  reworkMs: number
  devMs: number
  pct: number
}

/** % de tempo em rework (REVISÃO/AJUSTES) vs desenvolvimento, para o recorte. */
export interface ChangesResult {
  /** Algum projeto do escopo tem reworkStatuses + cycleStartStatus configurados. */
  configured: boolean
  pct: number | null
  reworkMs: number
  devMs: number
  issueCount: number
  perIssue: ChangesIssueRow[]
}

export interface PdcaOnTimeResult {
  /** Há issues com PDCA (ativo ou cópias concluídas) no escopo. */
  hasPdca: boolean
  total: number
  onTime: number
  pct: number | null
}

export interface CapacityResult {
  configured: boolean
  committedHours: number
  availableHours: number
  pct: number | null
  lowPct: number
  highPct: number
}

export interface EfficiencyRow {
  person: Ref<Person>
  name: string
  onTimePct: number | null
  /** Ocupação de agenda (mantida p/ compat; não é mais o eixo do scatter). */
  capacityPct: number | null
  /** Carga: nº de tarefas ativas atribuídas simultâneas (eixo Y do scatter). */
  wipCount: number
  /** Precisão de esforço: Σestimativa ÷ Σgasto (%), sem teto. null sem dado. */
  effortPct: number | null
  /** Retrabalho: Σ tempo em revisão/ajustes ÷ Σ(retrabalho+dev) (%). null sem dado. */
  reworkPct: number | null
  /** Nota composta 0–100 (média das dimensões com dado). null se nenhuma. */
  score: number | null
  status: 'idle' | 'optimal' | 'overloaded' | 'neutral'
  /** Issues que compõem a taxa no prazo desta pessoa (drill-down ao clicar o nome). */
  issues: IssueRow[]
}

/** Uma tarefa no detalhe de Eficiência de tempo (estimativa vs tempo gasto). */
export interface EfficiencyIssueRow {
  issueId: Ref<Issue>
  identifier: string
  title: string
  estimationHours: number
  spentHours: number
  pct: number
}

/**
 * Eficiência de tempo (Designer/Editor): Σestimativa ÷ Σgasto em horas, SEM
 * teto (>100% = entregou abaixo do estimado). Tempo gasto = reportedTime, que
 * já agrega lançamentos manuais + auto da agenda (trigger de TimeSpendReport).
 */
export interface EfficiencyResult {
  /** Há ao menos uma issue com estimativa>0 e tempo gasto>0 no recorte. */
  hasData: boolean
  pct: number | null
  estimationHours: number
  spentHours: number
  issueCount: number
  perIssue: EfficiencyIssueRow[]
}

/** Meta de eficiência padrão (%) quando o singleton DashboardSettings não existe. */
export const DEFAULT_EFFICIENCY_TARGET = 85
/** Dias padrão sem Retenção concluída p/ marcar cliente em risco de abandono. */
export const DEFAULT_RETENTION_ALERT_DAYS = 15
/** WIP (tarefas ativas) padrão: abaixo disto = ocioso; acima do HIGH = sobrecarga. */
export const DEFAULT_WIP_LOW = 3
export const DEFAULT_WIP_HIGH = 8

/**
 * Cliente (clientName) em risco de abandono: já entrou em Retenção mas está há
 * +retentionAlertDays sem nenhuma tarefa de Retenção concluída (ou nunca
 * concluiu). Agrupa o(s) account/especialista responsável(is). Coordenador.
 */
export interface ClientRiskRow {
  client: string
  /** Nomes dos responsáveis com Cargo=Account nas tarefas do cliente ('—' se nenhum). */
  accounts: string[]
  /** Conclusão da última tarefa de Retenção; null = nunca concluiu. */
  lastRetentionAt: Timestamp | null
  /** Dias desde a última Retenção concluída; null = nunca. */
  daysSince: number | null
  /** Tarefas de Retenção do cliente (drill-down). */
  issues: IssueRow[]
}

export interface GreenResult {
  /** Há uma pessoa selecionada (filters.userId) — define a visão de detalhe. */
  hasUser: boolean
  /** Recorte selecionado (pessoa, ou escopo BU/equipe se nenhuma pessoa). */
  overall: StageRate
  onboarding: StageRate
  retention: StageRate
  overdueCount: number
  activeCount: number
  /** Tabelas por pessoa — escopo BU/equipe, ignorando o filtro de pessoa única. */
  onTimePerPerson: PersonOnTimeRow[]
  overduePerPerson: PersonOverdueRow[]
  /** Linha de total (agregado do escopo) das tabelas por-pessoa. */
  onTimePerPersonTotal: OnTimeAggregate
  overduePerPersonTotal: OverdueAggregate
  /** Drill-down da linha TOTAL: issues únicas do escopo (sem dup por multi-assignee). */
  onTimeScopeIssues: IssueRow[]
  overdueScopeIssues: IssueRow[]
  /** % de alterações e ajustes (tempo-em-status) do recorte selecionado. */
  changes: ChangesResult
  /** % de alterações e ajustes do SQUAD (painel do Coordenador). Fora do modo
   * squad é idêntico a `changes`. */
  squadChanges: ChangesResult
  /** Contagem de issues aguardando aprovação (M7) no recorte selecionado. */
  waitingApprovalCount: number
  waitingApprovalConfigured: boolean
  /** PDCA no prazo — combinado, sem split por tipo. */
  pdcaOnTime: PdcaOnTimeResult
  onTimeTarget?: number
  capacity: CapacityResult
  /** Limiares de WIP (tarefas ativas) para as faixas ocioso/ideal/sobrecarga do scatter. */
  wipLow: number
  wipHigh: number
  efficiencyRows: EfficiencyRow[]
  /** Issues por card do recorte selecionado (drill-down paginado da Individual). */
  overallIssues: IssueRow[]
  onboardingIssues: IssueRow[]
  retentionIssues: IssueRow[]
  overdueIssues: IssueRow[]
  /** Drill-down dos cards de cargo (Social Media): aguardando aprovação e % alterações. */
  waitingApprovalIssues: IssueRow[]
  changesIssues: IssueRow[]
  /** Eficiência de tempo (Designer/Editor) do recorte selecionado + drill-down. */
  efficiency: EfficiencyResult
  efficiencyIssues: IssueRow[]
  /** Meta de eficiência (%) — global (singleton) ou default. */
  efficiencyTarget: number
  /** Clientes em risco de abandono (Coordenador — só preenchido no modo squad). */
  clientsAtRisk: ClientRiskRow[]
  /** Limiar de dias sem Retenção concluída — global (singleton) ou default. */
  retentionAlertDays: number
}

function getDayStart(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function getWorkingDays(from: number, to: number): number {
  let count = 0
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  const current = new Date(start)
  while (current <= end) {
    const day = current.getDay()
    if (day !== 0 && day !== 6) {
      count++
    }
    current.setDate(current.getDate() + 1)
  }
  return count
}

function calculateEventsDuration (events: { date: number, dueDate: number }[]): number {
  const points = events.flatMap((event) => [
    { time: event.date, type: 'start' },
    { time: event.dueDate, type: 'end' }
  ])

  points.sort((a, b) => a.time - b.time)

  let activeEvents = 0
  let duration = 0
  let lastTime = 0

  points.forEach((point) => {
    if (activeEvents > 0) {
      duration += point.time - lastTime
    }
    activeEvents += point.type === 'start' ? 1 : -1
    lastTime = point.time
  })

  return duration
}

// Intervalos [date,dueDate] de horas comprometidas de uma pessoa, a partir de
// eventos JÁ expandidos por getAllEvents. Eventos cronometrados são recortados
// à janela. Eventos allDay rendem o bloco cheio de baseline (9h → 9h+baseline)
// em cada dia útil DENTRO da janela, SEM recorte intradiário — simétrico com
// availableHours (que conta dias úteis cheios via getWorkingDays). Sem isso,
// janelas de dia parcial (preset "mês"/"semana", com dateTo = agora) subestimam
// as horas comprometidas do dia corrente. O guard `date < dueDate` descarta
// intervalos degenerados na borda do período.
function buildCommittedIntervals (
  events: Event[],
  dateFrom: number,
  dateTo: number,
  baselineHoursPerDay: number
): { date: number, dueDate: number }[] {
  const dayMs = 24 * 3600 * 1000
  const fromDay = getDayStart(dateFrom)
  const toDay = getDayStart(dateTo)
  const intervals: { date: number, dueDate: number }[] = []
  for (const ev of events) {
    if (ev.allDay) {
      const startDay = getDayStart(ev.date)
      const endDay = getDayStart(ev.dueDate)
      for (let d = startDay; d <= endDay; d += dayMs) {
        if (d < fromDay || d > toDay) continue
        const dow = new Date(d).getDay()
        if (dow === 0 || dow === 6) continue
        const blockStart = d + 9 * 3600 * 1000
        const blockEnd = Math.min(d + (9 + baselineHoursPerDay) * 3600 * 1000, d + dayMs)
        intervals.push({ date: blockStart, dueDate: blockEnd })
      }
    } else {
      const date = Math.max(dateFrom, ev.date)
      const dueDate = Math.min(dateTo, ev.dueDate)
      if (date < dueDate) intervals.push({ date, dueDate })
    }
  }
  return intervals
}

interface Transition {
  time: Timestamp
  newStatus: Ref<IssueStatus>
}

interface IssueAnalysis {
  issue: Issue
  firstApproval?: Timestamp
}

export function emptyGreenResult (): GreenResult {
  const zero: StageRate = { withDue: 0, onTime: 0, pct: null }
  return {
    hasUser: false,
    overall: zero,
    onboarding: zero,
    retention: zero,
    overdueCount: 0,
    activeCount: 0,
    onTimePerPerson: [],
    overduePerPerson: [],
    onTimePerPersonTotal: { withDue: 0, onTime: 0, pct: null, onbPct: null, retPct: null },
    overduePerPersonTotal: { overdue: 0, active: 0 },
    onTimeScopeIssues: [],
    overdueScopeIssues: [],
    changes: { configured: false, pct: null, reworkMs: 0, devMs: 0, issueCount: 0, perIssue: [] },
    squadChanges: { configured: false, pct: null, reworkMs: 0, devMs: 0, issueCount: 0, perIssue: [] },
    waitingApprovalCount: 0,
    waitingApprovalConfigured: false,
    pdcaOnTime: { hasPdca: false, total: 0, onTime: 0, pct: null },
    onTimeTarget: undefined,
    capacity: { configured: false, committedHours: 0, availableHours: 0, pct: null, lowPct: 70, highPct: 90 },
    wipLow: DEFAULT_WIP_LOW,
    wipHigh: DEFAULT_WIP_HIGH,
    efficiencyRows: [],
    overallIssues: [],
    onboardingIssues: [],
    retentionIssues: [],
    overdueIssues: [],
    waitingApprovalIssues: [],
    changesIssues: [],
    efficiency: { hasData: false, pct: null, estimationHours: 0, spentHours: 0, issueCount: 0, perIssue: [] },
    efficiencyIssues: [],
    efficiencyTarget: DEFAULT_EFFICIENCY_TARGET,
    clientsAtRisk: [],
    retentionAlertDays: DEFAULT_RETENTION_ALERT_DAYS
  }
}

function rate (list: IssueAnalysis[]): StageRate {
  const withDue = list.length
  const onTime = list.filter((a) => (a.firstApproval as number) <= (a.issue.dueDate as number)).length
  return { withDue, onTime, pct: withDue > 0 ? Math.round((onTime / withDue) * 100) : null }
}

// Tempo (ms) acumulado em cada status, a partir das transições ordenadas.
// O último status acumula até "now" (status aberto), espelhando o cálculo
// per-issue de IssueStatusActivity.svelte. O chamador semeia o status de
// CRIAÇÃO no início da lista (ver durationTransitions), então o trecho
// criação → 1ª transição também é contado — essencial quando a issue nasce já
// no status de desenvolvimento (cycleStartStatus), caso comum.
function statusDurations (transitions: Transition[], now: number): Map<Ref<IssueStatus>, number> {
  const m = new Map<Ref<IssueStatus>, number>()
  for (let i = 0; i < transitions.length; i++) {
    const end = i < transitions.length - 1 ? transitions[i + 1].time : now
    const dur = Math.max(0, end - transitions[i].time)
    m.set(transitions[i].newStatus, (m.get(transitions[i].newStatus) ?? 0) + dur)
  }
  return m
}

export async function computeGreen (
  client: Client,
  filters: DashboardFilters,
  // Org structure do 3F Core (read-through): squads viram "teams" e o cargo de
  // cada pessoa sai de idx.cargoByPersonRef.
  idx: OrgIndexes,
  // CP-squad (Coordenador/Líder): membros do squad (união dos squads que a pessoa
  // lidera). Quando presente E há usuário selecionado, a query de issues passa a
  // incluir o squad e a tabela por-pessoa (onTimePerPerson/overduePerPerson)
  // reflete o squad — MAS os cards pessoais seguem restritos ao usuário
  // (matchesSelected=userId). Vazio/ausente → comportamento padrão.
  squadMembers?: Ref<Person>[]
): Promise<GreenResult> {
  const hierarchy = client.getHierarchy()
  const teams = squadsAsTeams(idx)
  const cargoByPersonRef = idx.cargoByPersonRef

  // Config da BU (metas/capacity) — por id da BU do 3F Core, doc BuDashboardSettings.
  const buSettings =
    filters.buId !== ''
      ? await client.findOne(operationalDashboard.class.BuDashboardSettings, { coreBuId: Number(filters.buId) })
      : undefined
  const onTimeTarget = buSettings?.onTimeTarget
  // Meta de eficiência global (singleton DashboardSettings) — default se ausente.
  const dashboardSettings = await client.findOne(operationalDashboard.class.DashboardSettings, {})
  const efficiencyTarget = dashboardSettings?.efficiencyTarget ?? DEFAULT_EFFICIENCY_TARGET
  const retentionAlertDays = dashboardSettings?.retentionAlertDays ?? DEFAULT_RETENTION_ALERT_DAYS

  // 1. Projetos: da BU selecionada ou, com buId vazio, TODOS os ativos (sem
  // restrição de BU — usado na Individual p/ ver o usuário em todas as BUs).
  const allProjects = await client.findAll(tracker.class.Project, { archived: false })
  let filteredProjects: Project[] =
    filters.buId === ''
      ? allProjects
      : allProjects.filter((p) => {
        const m = hierarchy.as(p, operationalDashboard.mixin.ProjectWithBU) as ProjectWithBU
        return m.coreBuId === Number(filters.buId)
      })
  if (filters.projectId !== '') {
    filteredProjects = filteredProjects.filter((p) => p._id === (filters.projectId as Ref<Project>))
  }
  if (filteredProjects.length === 0) {
    return {
      ...emptyGreenResult(),
      onTimeTarget,
      efficiencyTarget,
      retentionAlertDays,
      wipLow: buSettings?.wipLow ?? DEFAULT_WIP_LOW,
      wipHigh: buSettings?.wipHigh ?? DEFAULT_WIP_HIGH
    }
  }

  // 2. Config por projeto (aprovados + rework + início de ciclo) e prefixo de identifier
  interface PCfg {
    approvedSet: Set<Ref<IssueStatus>>
    reworkSet: Set<Ref<IssueStatus>>
    waitingApprovalSet: Set<Ref<IssueStatus>>
    cycleStartStatus?: Ref<IssueStatus>
    subtaskDueDates: boolean
  }
  const configByProject = new Map<Ref<Project>, PCfg>()
  const projectPrefix = new Map<Ref<Project>, string>()
  for (const p of filteredProjects) {
    const cfg = hierarchy.as(p, operationalDashboard.mixin.ProjectDashboardConfig) as ProjectDashboardConfig
    configByProject.set(p._id, {
      approvedSet: new Set(cfg.approvedStatuses ?? []),
      reworkSet: new Set(cfg.reworkStatuses ?? []),
      waitingApprovalSet: new Set(cfg.waitingApprovalStatuses ?? []),
      cycleStartStatus: cfg.cycleStartStatus,
      subtaskDueDates: cfg.subtaskDueDates === true
    })
    projectPrefix.set(p._id, p.identifier ?? '')
  }

  // 3. Status (fallback de categoria Won/Lost)
  const allStatuses = await client.findAll(tracker.class.IssueStatus, {})
  const statusMap = new Map<Ref<IssueStatus>, IssueStatus>()
  for (const s of allStatuses) statusMap.set(s._id, s)
  const wonStatusIds = new Set(
    allStatuses.filter((s) => s.category === task.statusCategory.Won).map((s) => s._id)
  )

  const effectiveApproved = (projectId: Ref<Project>): Set<Ref<IssueStatus>> => {
    const set = configByProject.get(projectId)?.approvedSet
    if (set != null && set.size > 0) return set
    return wonStatusIds
  }
  const isDone = (status: Ref<IssueStatus>): boolean =>
    statusMap.get(status)?.category === task.statusCategory.Won
  const isCancelled = (status: Ref<IssueStatus>): boolean =>
    statusMap.get(status)?.category === task.statusCategory.Lost
  const isActive = (i: Issue): boolean => {
    const approved = effectiveApproved(i.space)
    return !approved.has(i.status) && !isDone(i.status) && !isCancelled(i.status)
  }
  // Por padrão só issues-raiz (decisão #6): sub-issues herdam o clientStage do
  // pai e inflariam a contagem por etapa. Projetos com a flag subtaskDueDates
  // LIGADA passam a contar também as subtarefas (pelo vencimento próprio), tanto
  // no prazo quanto no atraso — o "universo" de tarefas do projeto muda junto.
  const countsSubtasks = (space: Ref<Project>): boolean => configByProject.get(space)?.subtaskDueDates === true
  const isCounted = (i: Issue): boolean => i.attachedTo === tracker.ids.NoParent || countsSubtasks(i.space)

  // 4. Issues do escopo. Com usuário selecionado, restringe por assignee
  // (membership ArrOf) — essencial quando buId é vazio (todos os projetos) p/
  // não carregar o workspace inteiro. Sem usuário, traz todas (filtro client-side).
  const projectIds = filteredProjects.map((p) => p._id)
  // Squad: amplia a query p/ carregar também as issues dos membros (a tabela
  // por-pessoa precisa delas). União com o próprio userId p/ os cards pessoais
  // dele continuarem completos. Conjunto limitado (membros do time) → sem risco
  // de varrer o workspace.
  const squadSet =
    squadMembers != null && squadMembers.length > 0 ? new Set<Ref<Person>>(squadMembers) : undefined
  const assigneeFilter =
    squadSet != null
      ? ({ $in: [...new Set<Ref<Person>>([filters.userId as Ref<Person>, ...squadSet])] } as unknown as Ref<Person>[])
      : (filters.userId as unknown as Ref<Person>[])
  const allIssues = await client.findAll(
    tracker.class.Issue,
    filters.userId !== ''
      ? { space: { $in: projectIds }, assignee: assigneeFilter }
      : { space: { $in: projectIds } }
  )
  const allActiveIssues = allIssues.filter(isActive)

  // 5. Transições de status (activity log) → primeira aprovação por issue
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

  // M2-fix: o status em que a issue foi CRIADA não gera DocUpdateMessage (só
  // mudanças geram). Para o tempo-em-status (dev/rework), recuperamos esse
  // status do TxCreateDoc — como IssueStatusActivity.svelte — e o semeamos no
  // início da lista de transições. transitionsByIssue NÃO é alterado: o
  // firstApproval do M1 não conta a criação, e a paridade precisa ser mantida.
  const createStatusByIssue = new Map<Ref<Issue>, Transition>()
  if (issueIds.length > 0) {
    const createTxes = await client.findAll(core.class.TxCreateDoc, { objectId: { $in: issueIds } })
    for (const tx of createTxes) {
      const st = (tx as TxCreateDoc<Issue>).attributes?.status
      if (typeof st === 'string' && st.length > 0) {
        createStatusByIssue.set(tx.objectId as Ref<Issue>, {
          time: tx.modifiedOn ?? tx.createdOn ?? 0,
          newStatus: st as Ref<IssueStatus>
        })
      }
    }
  }
  // Transições usadas só pelo tempo-em-status: começam no status de criação.
  const durationTransitions = (issueId: Ref<Issue>): Transition[] => {
    const updates = transitionsByIssue.get(issueId) ?? []
    const created = createStatusByIssue.get(issueId)
    if (created == null) return updates
    return [created, ...updates].sort((a, b) => a.time - b.time)
  }

  const analyses: IssueAnalysis[] = allIssues.map((issue) => {
    const transitions = transitionsByIssue.get(issue._id) ?? []
    const approvedSet = effectiveApproved(issue.space)
    const firstApprovalTrans = transitions.find((t) => approvedSet.has(t.newStatus))
    return { issue, firstApproval: firstApprovalTrans?.time }
  })

  // 6. Recortes
  // Escopo das tabelas por-pessoa: squad (Coordenador) tem precedência; senão o
  // time do filtro; senão todos. matchesSelected (cards pessoais) NÃO usa isto.
  const teamForFilter = filters.teamId !== '' ? teams.find((t) => t._id === filters.teamId) : undefined
  const memberSet =
    squadSet != null
      ? squadSet
      : teamForFilter != null
        ? new Set(teamForFilter.members.map((m) => m.person))
        : undefined

  const inTeamScope = (i: Issue): boolean => {
    if (memberSet == null) return true
    return (i.assignee ?? []).some((a) => memberSet.has(a))
  }
  const matchesSelected = (i: Issue): boolean => {
    if (filters.userId !== '') return (i.assignee ?? []).includes(filters.userId as Ref<Person>)
    return inTeamScope(i)
  }

  const { dateFrom, dateTo } = filters
  const inPeriod = (a: IssueAnalysis): boolean =>
    a.firstApproval != null && a.firstApproval >= dateFrom && a.firstApproval <= dateTo

  const now = Date.now()
  // Atraso (data-only): vence "hoje" não está atrasada.
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

  // === Taxa no prazo do recorte selecionado (por etapa, só raiz) ===
  const rootApprovedSelected = analyses.filter(
    (a) => isCounted(a.issue) && matchesSelected(a.issue) && inPeriod(a) && a.issue.dueDate != null
  )
  const onboardingSel = rootApprovedSelected.filter((a) => a.issue.clientStage === 'onboarding')
  const retentionSel = rootApprovedSelected.filter((a) => a.issue.clientStage === 'retention')
  const overall = rate(rootApprovedSelected)
  const onboarding = rate(onboardingSel)
  const retention = rate(retentionSel)
  const toRows = (list: IssueAnalysis[]): IssueRow[] =>
    list.map((a) => ({ issue: a.issue, completedAt: a.firstApproval }))
  const overallIssues = toRows(rootApprovedSelected)
  const onboardingIssues = toRows(onboardingSel)
  const retentionIssues = toRows(retentionSel)

  // === Atraso do recorte selecionado ===
  const selectedActive = allActiveIssues.filter((i) => isCounted(i) && matchesSelected(i))
  const overdueActive = selectedActive.filter(isOverdue)
  const overdueCount = overdueActive.length
  const activeCount = selectedActive.length
  const overdueIssues: IssueRow[] = overdueActive.map((i) => ({ issue: i }))

  // === Por pessoa (escopo BU/equipe, ignora userId) ===
  const rootApprovedScope = analyses.filter(
    (a) => isCounted(a.issue) && inTeamScope(a.issue) && inPeriod(a) && a.issue.dueDate != null
  )
  const onTimeMap = new Map<
  Ref<Person>,
  { withDue: number, onTime: number, onbWithDue: number, onbOnTime: number, retWithDue: number, retOnTime: number }
  >()
  // Issues que compõem a taxa de cada pessoa (drill-down da linha).
  const onTimeIssuesByPerson = new Map<Ref<Person>, IssueRow[]>()
  for (const a of rootApprovedScope) {
    const hit = (a.firstApproval as number) <= (a.issue.dueDate as number)
    const stage = a.issue.clientStage
    for (const p of a.issue.assignee ?? []) {
      if (memberSet != null && !memberSet.has(p)) continue
      const e =
        onTimeMap.get(p) ?? { withDue: 0, onTime: 0, onbWithDue: 0, onbOnTime: 0, retWithDue: 0, retOnTime: 0 }
      e.withDue++
      if (hit) e.onTime++
      if (stage === 'onboarding') {
        e.onbWithDue++
        if (hit) e.onbOnTime++
      } else if (stage === 'retention') {
        e.retWithDue++
        if (hit) e.retOnTime++
      }
      onTimeMap.set(p, e)
      const li = onTimeIssuesByPerson.get(p) ?? []
      li.push({ issue: a.issue, completedAt: a.firstApproval })
      onTimeIssuesByPerson.set(p, li)
    }
  }

  const scopeActive = allActiveIssues.filter((i) => isCounted(i) && inTeamScope(i))
  const overdueMap = new Map<Ref<Person>, { overdue: number, active: number }>()
  // Issues atrasadas de cada pessoa (drill-down da linha).
  const overdueIssuesByPerson = new Map<Ref<Person>, IssueRow[]>()
  for (const i of scopeActive) {
    const od = isOverdue(i)
    for (const p of i.assignee ?? []) {
      if (memberSet != null && !memberSet.has(p)) continue
      const e = overdueMap.get(p) ?? { overdue: 0, active: 0 }
      e.active++
      if (od) {
        e.overdue++
        const li = overdueIssuesByPerson.get(p) ?? []
        li.push({ issue: i })
        overdueIssuesByPerson.set(p, li)
      }
      overdueMap.set(p, e)
    }
  }

  // Resolve nomes das pessoas presentes nas duas tabelas
  const personIds = new Set<Ref<Person>>([...onTimeMap.keys(), ...overdueMap.keys()])
  const personMap = new Map<Ref<Person>, Person>()
  if (personIds.size > 0) {
    const persons = await client.findAll(contact.class.Person, { _id: { $in: [...personIds] } })
    for (const p of persons) personMap.set(p._id, p)
  }
  const nameOf = (id: Ref<Person>): string => {
    const p = personMap.get(id)
    return p != null ? formatName(p.name ?? '') : '?'
  }

  const onTimePerPerson: PersonOnTimeRow[] = [...onTimeMap.entries()]
    .map(([person, e]) => ({
      person,
      name: nameOf(person),
      withDue: e.withDue,
      onTime: e.onTime,
      pct: e.withDue > 0 ? Math.round((e.onTime / e.withDue) * 100) : null,
      onbPct: e.onbWithDue > 0 ? Math.round((e.onbOnTime / e.onbWithDue) * 100) : null,
      retPct: e.retWithDue > 0 ? Math.round((e.retOnTime / e.retWithDue) * 100) : null,
      issues: onTimeIssuesByPerson.get(person) ?? []
    }))
    // Pior taxa primeiro (nulls ao fim) — destaca quem precisa de atenção.
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101))

  const overduePerPerson: PersonOverdueRow[] = [...overdueMap.entries()]
    .map(([person, e]) => ({
      person,
      name: nameOf(person),
      overdue: e.overdue,
      active: e.active,
      issues: overdueIssuesByPerson.get(person) ?? []
    }))
    .sort((a, b) => b.overdue - a.overdue)

  // Drill-down da linha TOTAL — issues únicas do escopo (sem dup por multi-assignee).
  const onTimeScopeIssues: IssueRow[] = rootApprovedScope.map((a) => ({
    issue: a.issue,
    completedAt: a.firstApproval
  }))
  const overdueScopeIssues: IssueRow[] = scopeActive.filter(isOverdue).map((i) => ({ issue: i }))

  // Totais (linha de agregado) das tabelas por-pessoa. % é recomputado dos
  // numeradores/denominadores SOMADOS — não é média das porcentagens. Conta
  // pares pessoa-issue (issue multi-assignee soma p/ cada um), igual às linhas,
  // então o total bate com a soma das colunas exibidas.
  const onTimePerPersonTotal: OnTimeAggregate = (() => {
    let withDue = 0
    let onTime = 0
    let onbWithDue = 0
    let onbOnTime = 0
    let retWithDue = 0
    let retOnTime = 0
    for (const e of onTimeMap.values()) {
      withDue += e.withDue
      onTime += e.onTime
      onbWithDue += e.onbWithDue
      onbOnTime += e.onbOnTime
      retWithDue += e.retWithDue
      retOnTime += e.retOnTime
    }
    return {
      withDue,
      onTime,
      pct: withDue > 0 ? Math.round((onTime / withDue) * 100) : null,
      onbPct: onbWithDue > 0 ? Math.round((onbOnTime / onbWithDue) * 100) : null,
      retPct: retWithDue > 0 ? Math.round((retOnTime / retWithDue) * 100) : null
    }
  })()
  const overduePerPersonTotal: OverdueAggregate = (() => {
    let overdue = 0
    let active = 0
    for (const e of overdueMap.values()) {
      overdue += e.overdue
      active += e.active
    }
    return { overdue, active }
  })()

  // === % de alterações e ajustes: tempo em REVISÃO/AJUSTES vs DESENVOLVIMENTO ===
  // (decisão #14). Recorte = seleção atual; exige reworkStatuses + cycleStartStatus
  // configurados no projeto. O critério por issue casa com IssueStatusActivity.
  const changesConfigured = filteredProjects.some((p) => {
    const c = configByProject.get(p._id)
    return c != null && c.reworkSet.size > 0 && c.cycleStartStatus != null
  })
  // Calcula a métrica de alterações para um recorte arbitrário (predicado de
  // pertencimento). Usado 2x: recorte PESSOAL (matchesSelected) p/ o card do
  // indivíduo (Social Media/Designer) e recorte do SQUAD (inTeamScope) p/ o
  // painel do Coordenador.
  const computeChangesFor = (
    inScope: (i: Issue) => boolean
  ): { changes: ChangesResult, changesIssues: IssueRow[] } => {
    let totalRework = 0
    let totalDev = 0
    const perIssue: ChangesIssueRow[] = []
    // Issue completa de cada linha (para o drill-down paginado).
    const rows: Array<{ issue: Issue, pct: number }> = []
    for (const i of allIssues) {
      if (!inScope(i)) continue
      const cfg = configByProject.get(i.space)
      if (cfg == null || cfg.reworkSet.size === 0 || cfg.cycleStartStatus == null) continue
      const durs = statusDurations(durationTransitions(i._id), now)
      let rework = 0
      // M1-fix: exclui o cycleStartStatus do somatório de rework. A config não
      // impede marcar o mesmo status como rework E início de ciclo; sem isso, o
      // tempo dele entraria no numerador (rework) e no denominador (dev) ao mesmo
      // tempo, distorcendo a razão. O dev usa esse status separadamente abaixo.
      for (const [st, ms] of durs) if (cfg.reworkSet.has(st) && st !== cfg.cycleStartStatus) rework += ms
      const dev = durs.get(cfg.cycleStartStatus) ?? 0
      if (rework + dev <= 0) continue
      totalRework += rework
      totalDev += dev
      const prefix = projectPrefix.get(i.space) ?? ''
      const pct = Math.round((rework / (rework + dev)) * 100)
      perIssue.push({
        issueId: i._id,
        identifier: prefix !== '' ? `${prefix}-${i.number ?? '?'}` : `#${i.number ?? '?'}`,
        title: i.title,
        reworkMs: rework,
        devMs: dev,
        pct
      })
      rows.push({ issue: i, pct })
    }
    perIssue.sort((a, b) => b.pct - a.pct)
    // Mesma ordem do detalhe (maior % de ajuste primeiro).
    const changesIssues: IssueRow[] = rows.sort((a, b) => b.pct - a.pct).map((r) => ({ issue: r.issue }))
    const changes: ChangesResult = {
      configured: changesConfigured,
      pct: totalRework + totalDev > 0 ? Math.round((totalRework / (totalRework + totalDev)) * 100) : null,
      reworkMs: totalRework,
      devMs: totalDev,
      issueCount: perIssue.length,
      perIssue
    }
    return { changes, changesIssues }
  }
  const personalChanges = computeChangesFor(matchesSelected)
  const changes = personalChanges.changes
  const changesIssues = personalChanges.changesIssues
  // No modo squad, inTeamScope usa o memberSet do squad → painel do Coordenador.
  // Fora dele, espelha o pessoal (não é exibido nesse caso).
  const squadChanges = squadSet != null ? computeChangesFor(inTeamScope).changes : changes

  // === Eficiência de tempo (Designer/Editor): Σestimativa ÷ Σgasto, SEM teto ===
  // Tempo gasto = reportedTime (manual + auto da agenda, mantido pelo trigger de
  // TimeSpendReport). estimation/reportedTime já estão em HORAS. Recorte = seleção
  // atual, ignora período (igual % alterações). Só entram issues com estimativa>0
  // E gasto>0 (senão a razão é indefinida). Maior % = melhor (entregou abaixo do
  // estimado); a meta global decide a cor no card.
  let effEstimation = 0
  let effSpent = 0
  const effPerIssue: EfficiencyIssueRow[] = []
  const efficiencyIssueRows: IssueRow[] = []
  for (const i of allIssues) {
    if (!matchesSelected(i)) continue
    const est = i.estimation ?? 0
    const spent = i.reportedTime ?? 0
    if (est <= 0 || spent <= 0) continue
    effEstimation += est
    effSpent += spent
    const prefix = projectPrefix.get(i.space) ?? ''
    const pct = Math.round((est / spent) * 100)
    effPerIssue.push({
      issueId: i._id,
      identifier: prefix !== '' ? `${prefix}-${i.number ?? '?'}` : `#${i.number ?? '?'}`,
      title: i.title,
      estimationHours: est,
      spentHours: spent,
      pct
    })
    efficiencyIssueRows.push({ issue: i, estimationHours: est, spentHours: spent, efficiencyPct: pct })
  }
  // Pior eficiência primeiro (menor %, quem mais estourou a estimativa).
  effPerIssue.sort((a, b) => a.pct - b.pct)
  efficiencyIssueRows.sort((a, b) => (a.efficiencyPct ?? 0) - (b.efficiencyPct ?? 0))
  const efficiency: EfficiencyResult = {
    hasData: effPerIssue.length > 0,
    pct: effSpent > 0 ? Math.round((effEstimation / effSpent) * 100) : null,
    estimationHours: effEstimation,
    spentHours: effSpent,
    issueCount: effPerIssue.length,
    perIssue: effPerIssue
  }
  const efficiencyIssues: IssueRow[] = efficiencyIssueRows

  // === Clientes em risco de abandono (Coordenador — só no modo squad) ===
  // Carteira = clientNames das tarefas do squad (allIssues já é squad-scoped).
  // Para a ÚLTIMA Retenção concluída, olhamos TODAS as tarefas desses clientes
  // (inclusive de quem NÃO é do squad) — query extra por clientName, p/ não
  // marcar em risco um cliente cuja retenção foi concluída por alguém de fora.
  // Só clientes que JÁ entraram em Retenção (≥1 tarefa clientStage=retention).
  // "Concluída" = primeira transição p/ status aprovado/done (mesmo critério do
  // M1). Account = pessoas com Cargo=Account atribuídas às tarefas do cliente.
  let clientsAtRisk: ClientRiskRow[] = []
  if (squadSet != null) {
    const candidateClients = [
      ...new Set(allIssues.map((i) => (i.clientName ?? '').trim()).filter((c) => c !== ''))
    ]
    if (candidateClients.length > 0) {
      const clientIssues = await client.findAll(tracker.class.Issue, {
        space: { $in: projectIds },
        clientName: { $in: candidateClients }
      })
      // firstApproval só das tarefas de Retenção desses clientes (conjunto menor).
      const retentionIssues = clientIssues.filter((i) => i.clientStage === 'retention')
      const retIds = retentionIssues.map((i) => i._id)
      const retFirstApproval = new Map<Ref<Issue>, Timestamp | undefined>()
      if (retIds.length > 0) {
        const msgs = (await client.findAll(activity.class.DocUpdateMessage, {
          objectId: { $in: retIds }
        })) as DocUpdateMessage[]
        const transByIssue = new Map<Ref<Issue>, Transition[]>()
        for (const m of msgs) {
          const upd = m.attributeUpdates
          if (upd?.attrKey !== 'status') continue
          const next = upd.set?.[0]
          if (typeof next !== 'string' || next.length === 0) continue
          const id = m.objectId as Ref<Issue>
          const list = transByIssue.get(id) ?? []
          list.push({ time: m.modifiedOn ?? m.createdOn ?? 0, newStatus: next as Ref<IssueStatus> })
          transByIssue.set(id, list)
        }
        for (const list of transByIssue.values()) list.sort((a, b) => a.time - b.time)
        for (const ri of retentionIssues) {
          const approvedSet = effectiveApproved(ri.space)
          const t = (transByIssue.get(ri._id) ?? []).find((x) => approvedSet.has(x.newStatus))
          retFirstApproval.set(ri._id, t?.time)
        }
      }

      // Cargo das pessoas atribuídas às tarefas dos clientes (p/ achar os Accounts).
      const clientAssignees = new Set<Ref<Person>>()
      for (const i of clientIssues) for (const p of i.assignee ?? []) clientAssignees.add(p)
      const cargoNameMap = new Map<Ref<Person>, { name: string, isAccount: boolean }>()
      if (clientAssignees.size > 0) {
        const persons = await client.findAll(contact.class.Person, { _id: { $in: [...clientAssignees] } })
        for (const p of persons) {
          const isAccount = cargoByPersonRef.get(p._id) === Cargo.Account
          cargoNameMap.set(p._id, { name: formatName(p.name ?? ''), isAccount })
        }
      }

      // Agrupa por cliente. retIssuesByClient mantém as tarefas de Retenção (drill).
      interface CAcc { retIssues: Issue[], lastAt: number | null, accounts: Set<Ref<Person>> }
      const byClient = new Map<string, CAcc>()
      for (const i of clientIssues) {
        const c = (i.clientName ?? '').trim()
        if (c === '') continue
        const e = byClient.get(c) ?? { retIssues: [], lastAt: null, accounts: new Set<Ref<Person>>() }
        for (const p of i.assignee ?? []) if (cargoNameMap.get(p)?.isAccount === true) e.accounts.add(p)
        if (i.clientStage === 'retention') {
          e.retIssues.push(i)
          const fa = retFirstApproval.get(i._id)
          if (fa != null && (e.lastAt == null || fa > e.lastAt)) e.lastAt = fa
        }
        byClient.set(c, e)
      }

      const dayMs = 24 * 3600 * 1000
      clientsAtRisk = [...byClient.entries()]
        // Só quem entrou em Retenção (≥1 tarefa de Retenção).
        .filter(([, e]) => e.retIssues.length > 0)
        .map(([clientName, e]) => {
          const daysSince = e.lastAt != null ? Math.floor((now - e.lastAt) / dayMs) : null
          const accounts = [...e.accounts].map((p) => cargoNameMap.get(p)?.name ?? '?').sort()
          const issues: IssueRow[] = e.retIssues
            .map((i) => ({ issue: i, completedAt: retFirstApproval.get(i._id) }))
            .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
          return { client: clientName, accounts, lastRetentionAt: e.lastAt, daysSince, issues }
        })
        // Em risco: nunca concluiu (null) OU passou do limiar.
        .filter((r) => r.daysSince == null || r.daysSince > retentionAlertDays)
        // Mais crítico primeiro: nunca (∞), depois maior nº de dias.
        .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity))
    }
  }

  // === M7: Waiting approval (espelha metrics.ts L451–483, no recorte selecionado) ===
  const anyWaitingConfigured = [...configByProject.values()].some((c) => c.waitingApprovalSet.size > 0)
  let waitingApprovalCount = 0
  let waitingApprovalIssues: IssueRow[] = []
  if (anyWaitingConfigured) {
    const waiting = selectedActive.filter((i) => {
      const cfg = configByProject.get(i.space)
      return cfg != null && cfg.waitingApprovalSet.has(i.status)
    })
    waitingApprovalCount = waiting.length
    waitingApprovalIssues = waiting.map((i) => ({ issue: i }))
  }

  // === PDCA no prazo (combinado, sem split por tipo — decisão #7/#13) ===
  // Issues com pdcaCycleActive=true (ativas) + cópias concluídas (duplicate
  // mode: pdcaCycleDuplicate=true e já concluída). A definição de "no prazo"
  // é a mesma do M1: firstApproval <= dueDate. Para ativas em andamento:
  // now <= dueDate (ainda está no prazo enquanto roda).
  let pdcaTotal = 0
  let pdcaOnTimeCount = 0
  for (const a of analyses) {
    // Só issues-raiz (decisão #6, igual ao M1): o ciclo PDCA pertence à tarefa
    // raiz; contar sub-issues com a flag duplicaria o mesmo ciclo.
    if (!isCounted(a.issue) || !matchesSelected(a.issue)) continue
    const iss = a.issue as Issue & Record<string, unknown>
    const isPdcaActive = iss.pdcaCycleActive === true
    const isPdcaDuplicate = iss.pdcaCycleDuplicate === true
    if (!isPdcaActive && !isPdcaDuplicate) continue
    if (a.issue.dueDate == null) continue

    const approved = effectiveApproved(a.issue.space)
    const isDoneOrApproved = approved.has(a.issue.status) || isDone(a.issue.status)

    if (isDoneOrApproved) {
      // Concluída: precisa estar no período para contar
      if (a.firstApproval == null) continue
      if (a.firstApproval < dateFrom || a.firstApproval > dateTo) continue
      pdcaTotal++
      if ((a.firstApproval as number) <= (a.issue.dueDate as number)) pdcaOnTimeCount++
    } else if (isPdcaActive) {
      // Ativa com PDCA: conta como "em andamento"; no prazo se now <= dueDate
      pdcaTotal++
      if (now <= (a.issue.dueDate as number)) pdcaOnTimeCount++
    }
  }
  // hasPdca reflete o RECORTE selecionado (não a BU inteira): senão o painel
  // mostraria "nenhuma tarefa nesta métrica" em vez de "sem PDCA" quando a
  // pessoa selecionada não tem PDCA mas outra pessoa da BU tem.
  const hasPdca =
    pdcaTotal > 0 ||
    analyses.some((a) => {
      if (!isCounted(a.issue) || !matchesSelected(a.issue)) return false
      const iss = a.issue as Issue & Record<string, unknown>
      return iss.pdcaCycleActive === true || iss.pdcaCycleDuplicate === true
    })
  const pdcaOnTime: PdcaOnTimeResult = {
    hasPdca,
    total: pdcaTotal,
    onTime: pdcaOnTimeCount,
    pct: pdcaTotal > 0 ? Math.round((pdcaOnTimeCount / pdcaTotal) * 100) : null
  }

  // === Capacity & Efficiency (CP6 & CP7) ===
  // População do recorte: pessoa selecionada → só ela; equipe → TODOS os
  // membros (mesmo sem issues, p/ aparecerem no scatter — M6); senão → quem
  // tem issues na BU. As horas comprometidas (capacity agregada) e as linhas
  // por pessoa (efficiency) usam a MESMA população e a MESMA query, evitando
  // divergência entre os dois cálculos.
  const baselineHoursPerDay = buSettings?.baselineHoursPerDay ?? 8
  const capacityLowPct = buSettings?.capacityLowPct ?? 70
  const capacityHighPct = buSettings?.capacityHighPct ?? 90
  // Limiares de WIP (carga) do gráfico de eficiência — por BU, com default.
  const wipLow = buSettings?.wipLow ?? DEFAULT_WIP_LOW
  const wipHigh = buSettings?.wipHigh ?? DEFAULT_WIP_HIGH

  // === Métricas por pessoa p/ o scatter (precisão de esforço e retrabalho) ===
  // Espelham os cálculos de escopo (efficiency/changes) mas quebrados por
  // assignee. Par pessoa-issue conta p/ cada responsável (igual onTimeMap).
  const effByPerson = new Map<Ref<Person>, { est: number, spent: number }>()
  const reworkByPerson = new Map<Ref<Person>, { rework: number, dev: number }>()
  for (const i of allIssues) {
    const assignees = i.assignee ?? []
    if (assignees.length === 0) continue
    // Precisão de esforço: só issues com estimativa>0 E gasto>0.
    const est = i.estimation ?? 0
    const spent = i.reportedTime ?? 0
    const hasEff = est > 0 && spent > 0
    // Retrabalho: exige reworkStatuses + cycleStartStatus configurados no projeto.
    const cfg = configByProject.get(i.space)
    let rework = 0
    let dev = 0
    if (cfg != null && cfg.reworkSet.size > 0 && cfg.cycleStartStatus != null) {
      const durs = statusDurations(durationTransitions(i._id), now)
      for (const [st, ms] of durs) if (cfg.reworkSet.has(st) && st !== cfg.cycleStartStatus) rework += ms
      dev = durs.get(cfg.cycleStartStatus) ?? 0
    }
    const hasRework = rework + dev > 0
    if (!hasEff && !hasRework) continue
    for (const p of assignees) {
      if (memberSet != null && !memberSet.has(p)) continue
      if (hasEff) {
        const e = effByPerson.get(p) ?? { est: 0, spent: 0 }
        e.est += est
        e.spent += spent
        effByPerson.set(p, e)
      }
      if (hasRework) {
        const r = reworkByPerson.get(p) ?? { rework: 0, dev: 0 }
        r.rework += rework
        r.dev += dev
        reworkByPerson.set(p, r)
      }
    }
  }

  let targetPersons: Ref<Person>[] = []
  if (filters.userId !== '') {
    targetPersons = [filters.userId as Ref<Person>]
  } else if (filters.teamId !== '') {
    const selectedTeam = teams.find((t) => t._id === filters.teamId)
    targetPersons = selectedTeam != null ? selectedTeam.members.map((m) => m.person) : []
  } else {
    targetPersons = [...personIds]
  }

  // Horas comprometidas por pessoa, no período. Reusa o padrão de query de
  // WithTeamData.svelte: Event ($ne ReccuringEvent) + ReccuringEvent, dedup por
  // eventId. A 1ª query já traz WorkSlots e ReccuringInstance (ambos com _class
  // != ReccuringEvent) — getAllEvents usa os instances p/ expandir/cancelar
  // ocorrências dos templates recorrentes.
  const committedMsByPerson = new Map<Ref<Person>, number>()
  const workingDays = getWorkingDays(dateFrom, dateTo)
  if (targetPersons.length > 0) {
    const rawEvents = await client.findAll(calendar.class.Event, {
      _class: { $ne: calendar.class.ReccuringEvent },
      participants: { $in: targetPersons } as any,
      date: { $lte: dateTo },
      dueDate: { $gte: dateFrom }
    })
    const recurringEvents = await client.findAll(calendar.class.ReccuringEvent, {
      participants: { $in: targetPersons } as any
    })
    const combined = [...rawEvents, ...recurringEvents].filter(
      (it, idx, arr) => arr.findIndex((e) => e.eventId === it.eventId) === idx
    )
    for (const person of targetPersons) {
      const personRaw = combined.filter((ev) => (ev.participants ?? []).includes(person))
      const personEvents = getAllEvents(personRaw as Event[], dateFrom, dateTo)
      const intervals = buildCommittedIntervals(personEvents, dateFrom, dateTo, baselineHoursPerDay)
      committedMsByPerson.set(person, calculateEventsDuration(intervals))
    }
  }

  // Agregado do recorte (CapacityPanel)
  let totalCommittedMs = 0
  for (const ms of committedMsByPerson.values()) totalCommittedMs += ms
  const committedHours = Math.round((totalCommittedMs / 3600000) * 10) / 10
  const availableHours = workingDays * baselineHoursPerDay * targetPersons.length
  const capacity: CapacityResult = {
    configured: buSettings?.baselineHoursPerDay != null,
    committedHours,
    availableHours,
    pct: availableHours > 0 ? Math.round((committedHours / availableHours) * 100) : null,
    lowPct: capacityLowPct,
    highPct: capacityHighPct
  }

  // Membros de equipe sem issues não estão no personMap — resolve os nomes deles
  const missingNames = targetPersons.filter((p) => !personMap.has(p))
  if (missingNames.length > 0) {
    const extra = await client.findAll(contact.class.Person, { _id: { $in: missingNames } })
    for (const p of extra) personMap.set(p._id, p)
  }

  // Linhas por pessoa do scatter (CP7): entrega no prazo × carga (WIP), com
  // precisão de esforço, retrabalho e nota composta 0–100.
  const personAvailableHours = workingDays * baselineHoursPerDay
  // Saúde da carga em 0–100: 100 dentro da faixa ideal [wipLow, wipHigh];
  // abaixo cai proporcionalmente (ocioso); acima decai até 0 em 2×wipHigh.
  const wipHealth = (wip: number): number => {
    if (wip >= wipLow && wip <= wipHigh) return 100
    if (wip < wipLow) return wipLow > 0 ? Math.round((wip / wipLow) * 100) : 100
    return Math.max(0, Math.round(100 - ((wip - wipHigh) / wipHigh) * 100))
  }
  const efficiencyRows: EfficiencyRow[] = targetPersons.map((person) => {
    const onTimeEntry = onTimeMap.get(person)
    const onTimePct = onTimeEntry != null && onTimeEntry.withDue > 0
      ? Math.round((onTimeEntry.onTime / onTimeEntry.withDue) * 100)
      : null
    const personCommittedHours = (committedMsByPerson.get(person) ?? 0) / 3600000
    const capacityPct = personAvailableHours > 0
      ? Math.round((personCommittedHours / personAvailableHours) * 100)
      : null
    // WIP = tarefas ativas atribuídas (mesma contagem da tabela de atraso).
    const wipCount = overdueMap.get(person)?.active ?? 0
    const eff = effByPerson.get(person)
    const effortPct = eff != null && eff.spent > 0 ? Math.round((eff.est / eff.spent) * 100) : null
    const rw = reworkByPerson.get(person)
    const reworkPct = rw != null && rw.rework + rw.dev > 0 ? Math.round((rw.rework / (rw.rework + rw.dev)) * 100) : null
    // Status (cor) pela carga (WIP).
    let status: 'idle' | 'optimal' | 'overloaded' | 'neutral' = 'optimal'
    if (wipCount > wipHigh) status = 'overloaded'
    else if (wipCount < wipLow) status = 'idle'
    // Nota composta: média das dimensões COM dado. Precisão sem teto é boa,
    // mas p/ a nota limitamos a 100 (entregar abaixo do estimado não "compensa"
    // outras falhas). Retrabalho entra invertido (menos é melhor).
    const parts: number[] = []
    if (onTimePct != null) parts.push(Math.max(0, Math.min(100, onTimePct)))
    parts.push(wipHealth(wipCount))
    if (effortPct != null) parts.push(Math.max(0, Math.min(100, effortPct)))
    if (reworkPct != null) parts.push(Math.max(0, Math.min(100, 100 - reworkPct)))
    const score = parts.length > 0 ? Math.round(parts.reduce((s, v) => s + v, 0) / parts.length) : null
    return {
      person,
      name: nameOf(person),
      onTimePct,
      capacityPct,
      wipCount,
      effortPct,
      reworkPct,
      score,
      status,
      issues: onTimeIssuesByPerson.get(person) ?? []
    }
  })

  return {
    hasUser: filters.userId !== '',
    overall,
    onboarding,
    retention,
    overdueCount,
    activeCount,
    onTimePerPerson,
    overduePerPerson,
    onTimePerPersonTotal,
    overduePerPersonTotal,
    onTimeScopeIssues,
    overdueScopeIssues,
    changes,
    squadChanges,
    waitingApprovalCount,
    waitingApprovalConfigured: anyWaitingConfigured,
    pdcaOnTime,
    onTimeTarget,
    capacity,
    wipLow,
    wipHigh,
    efficiencyRows,
    overallIssues,
    onboardingIssues,
    retentionIssues,
    overdueIssues,
    waitingApprovalIssues,
    changesIssues,
    efficiency,
    efficiencyIssues,
    efficiencyTarget,
    clientsAtRisk,
    retentionAlertDays
  }
}

// ===========================================================================
// CP8 — Visão Líder QG (consolidação multi-BU). Diferente do computeGreen, NÃO
// restringe a uma BU: carrega TODAS as BUs não arquivadas e seus projetos. A
// análise por-issue (firstApproval, isRoot, status-duração) espelha a do
// computeGreen — um loader compartilhado entre os dois é um refactor futuro.
// ===========================================================================

/** Entrega no prazo por cargo (operação inteira). cargo='' = sem cargo. */
export interface CargoRate {
  cargo: string
  withDue: number
  onTime: number
  pct: number | null
}

/** Entrega no prazo por BU (operação inteira). `bu` = id da BU no 3F Core. */
export interface BURate {
  bu: number
  name: string
  color: number
  withDue: number
  onTime: number
  pct: number | null
}

export interface QGResult {
  /** Há um time do QG selecionado (define pool de capacity, execução e atraso). */
  hasTeam: boolean
  byCargo: CargoRate[]
  byBU: BURate[]
  /** % de alterações/ajustes consolidado (todas as BUs). */
  changes: ChangesResult
  /** Capacity do pool do QG (time selecionado). */
  capacity: CapacityResult
  /** On-time das issues atribuídas aos membros do time QG, em qualquer BU. */
  qgExecution: StageRate
  /** Atraso por pessoa do time QG. */
  overduePerPerson: PersonOverdueRow[]
}

export function emptyQGResult (): QGResult {
  return {
    hasTeam: false,
    byCargo: [],
    byBU: [],
    changes: { configured: false, pct: null, reworkMs: 0, devMs: 0, issueCount: 0, perIssue: [] },
    capacity: { configured: false, committedHours: 0, availableHours: 0, pct: null, lowPct: 70, highPct: 90 },
    qgExecution: { withDue: 0, onTime: 0, pct: null },
    overduePerPerson: []
  }
}

export async function computeQG (
  client: Client,
  dateFrom: number,
  dateTo: number,
  qgTeamId: string,
  idx: OrgIndexes
): Promise<QGResult> {
  const hierarchy = client.getHierarchy()
  const teams = squadsAsTeams(idx)
  const cargoByPersonRef = idx.cargoByPersonRef

  // 1. BUs ativas do 3F Core + projetos vinculados (via coreBuId)
  const bus = idx.busList.filter((b) => b.is_active)
  if (bus.length === 0) return emptyQGResult()
  const buIds = new Set<number>(bus.map((b) => b.id))

  const allProjects = await client.findAll(tracker.class.Project, { archived: false })
  const projectBU = new Map<Ref<Project>, number>()
  const scopedProjects: Project[] = []
  for (const p of allProjects) {
    const m = hierarchy.as(p, operationalDashboard.mixin.ProjectWithBU) as ProjectWithBU
    if (m.coreBuId != null && buIds.has(m.coreBuId)) {
      projectBU.set(p._id, m.coreBuId)
      scopedProjects.push(p)
    }
  }
  if (scopedProjects.length === 0) return emptyQGResult()

  // 2. Config por projeto (rework + início de ciclo p/ % alterações)
  interface PCfg {
    approvedSet: Set<Ref<IssueStatus>>
    reworkSet: Set<Ref<IssueStatus>>
    cycleStartStatus?: Ref<IssueStatus>
    subtaskDueDates: boolean
  }
  const configByProject = new Map<Ref<Project>, PCfg>()
  const projectPrefix = new Map<Ref<Project>, string>()
  for (const p of scopedProjects) {
    const cfg = hierarchy.as(p, operationalDashboard.mixin.ProjectDashboardConfig) as ProjectDashboardConfig
    configByProject.set(p._id, {
      approvedSet: new Set(cfg.approvedStatuses ?? []),
      reworkSet: new Set(cfg.reworkStatuses ?? []),
      cycleStartStatus: cfg.cycleStartStatus,
      subtaskDueDates: cfg.subtaskDueDates === true
    })
    projectPrefix.set(p._id, p.identifier ?? '')
  }

  // 3. Status (fallback de categoria Won/Lost)
  const allStatuses = await client.findAll(tracker.class.IssueStatus, {})
  const statusMap = new Map<Ref<IssueStatus>, IssueStatus>()
  for (const s of allStatuses) statusMap.set(s._id, s)
  const wonStatusIds = new Set(
    allStatuses.filter((s) => s.category === task.statusCategory.Won).map((s) => s._id)
  )
  const effectiveApproved = (projectId: Ref<Project>): Set<Ref<IssueStatus>> => {
    const set = configByProject.get(projectId)?.approvedSet
    if (set != null && set.size > 0) return set
    return wonStatusIds
  }
  const isDone = (status: Ref<IssueStatus>): boolean =>
    statusMap.get(status)?.category === task.statusCategory.Won
  const isCancelled = (status: Ref<IssueStatus>): boolean =>
    statusMap.get(status)?.category === task.statusCategory.Lost
  const isActive = (i: Issue): boolean => {
    const approved = effectiveApproved(i.space)
    return !approved.has(i.status) && !isDone(i.status) && !isCancelled(i.status)
  }
  // Padrão só-raiz; projetos com subtaskDueDates ligada contam subtarefas.
  const countsSubtasks = (space: Ref<Project>): boolean => configByProject.get(space)?.subtaskDueDates === true
  const isCounted = (i: Issue): boolean => i.attachedTo === tracker.ids.NoParent || countsSubtasks(i.space)

  // 4. Issues de todos os projetos do escopo
  const allIssues = await client.findAll(tracker.class.Issue, {
    space: { $in: scopedProjects.map((p) => p._id) }
  })
  const allActiveIssues = allIssues.filter((i) => isActive(i) && isCounted(i))

  // 5. Transições → firstApproval (+ seed do status de criação p/ tempo-em-status)
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
  const createStatusByIssue = new Map<Ref<Issue>, Transition>()
  if (issueIds.length > 0) {
    const createTxes = await client.findAll(core.class.TxCreateDoc, { objectId: { $in: issueIds } })
    for (const tx of createTxes) {
      const st = (tx as TxCreateDoc<Issue>).attributes?.status
      if (typeof st === 'string' && st.length > 0) {
        createStatusByIssue.set(tx.objectId as Ref<Issue>, {
          time: tx.modifiedOn ?? tx.createdOn ?? 0,
          newStatus: st as Ref<IssueStatus>
        })
      }
    }
  }
  const durationTransitions = (issueId: Ref<Issue>): Transition[] => {
    const updates = transitionsByIssue.get(issueId) ?? []
    const created = createStatusByIssue.get(issueId)
    if (created == null) return updates
    return [created, ...updates].sort((a, b) => a.time - b.time)
  }

  const analyses: IssueAnalysis[] = allIssues.map((issue) => {
    const transitions = transitionsByIssue.get(issue._id) ?? []
    const approvedSet = effectiveApproved(issue.space)
    const firstApprovalTrans = transitions.find((t) => approvedSet.has(t.newStatus))
    return { issue, firstApproval: firstApprovalTrans?.time }
  })

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
  const inPeriod = (a: IssueAnalysis): boolean =>
    a.firstApproval != null && a.firstApproval >= dateFrom && a.firstApproval <= dateTo

  // Time do QG (pool p/ capacity, execução e atraso)
  const qgTeam = qgTeamId !== '' ? teams.find((t) => t._id === qgTeamId) : undefined
  const qgMembers = qgTeam != null ? qgTeam.members.map((m) => m.person) : []
  const qgMemberSet = new Set(qgMembers)

  const rootApproved = analyses.filter(
    (a) => isCounted(a.issue) && inPeriod(a) && a.issue.dueDate != null
  )

  // === Entrega por BU ===
  const buAgg = new Map<number, { withDue: number, onTime: number }>()
  for (const a of rootApproved) {
    const buId = projectBU.get(a.issue.space)
    if (buId == null) continue
    const e = buAgg.get(buId) ?? { withDue: 0, onTime: 0 }
    e.withDue++
    if ((a.firstApproval as number) <= (a.issue.dueDate as number)) e.onTime++
    buAgg.set(buId, e)
  }
  const byBU: BURate[] = bus
    .map((b) => {
      const e = buAgg.get(b.id)
      return {
        bu: b.id,
        name: b.name,
        // Cor estável derivada do id (BURate.color é índice de hue, não RGB).
        color: (b.id % 10) + 1,
        withDue: e?.withDue ?? 0,
        onTime: e?.onTime ?? 0,
        pct: e != null && e.withDue > 0 ? Math.round((e.onTime / e.withDue) * 100) : null
      }
    })
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))

  // === Resolução de nomes + cargo (mixin Cargo, CP1) ===
  const peopleIds = new Set<Ref<Person>>()
  for (const a of rootApproved) for (const p of a.issue.assignee ?? []) peopleIds.add(p)
  for (const p of qgMembers) peopleIds.add(p)
  for (const i of allActiveIssues) for (const p of i.assignee ?? []) if (qgMemberSet.has(p)) peopleIds.add(p)

  const personMap = new Map<Ref<Person>, Person>()
  if (peopleIds.size > 0) {
    const persons = await client.findAll(contact.class.Person, { _id: { $in: [...peopleIds] } })
    for (const p of persons) personMap.set(p._id, p)
  }
  const nameOf = (id: Ref<Person>): string => {
    const p = personMap.get(id)
    return p != null ? formatName(p.name ?? '') : '?'
  }
  const cargoOf = (id: Ref<Person>): string => cargoByPersonRef.get(id) ?? ''

  // === Entrega por cargo === (multi-assignee: conta p/ cada cargo presente)
  const cargoAgg = new Map<string, { withDue: number, onTime: number }>()
  for (const a of rootApproved) {
    const hit = (a.firstApproval as number) <= (a.issue.dueDate as number)
    for (const p of a.issue.assignee ?? []) {
      const c = cargoOf(p)
      const e = cargoAgg.get(c) ?? { withDue: 0, onTime: 0 }
      e.withDue++
      if (hit) e.onTime++
      cargoAgg.set(c, e)
    }
  }
  const byCargo: CargoRate[] = [...cargoAgg.entries()]
    .map(([cargo, e]) => ({
      cargo,
      withDue: e.withDue,
      onTime: e.onTime,
      pct: e.withDue > 0 ? Math.round((e.onTime / e.withDue) * 100) : null
    }))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))

  // === % de alterações consolidado (todas as BUs; igual ao critério do CP4) ===
  const changesConfigured = scopedProjects.some((p) => {
    const c = configByProject.get(p._id)
    return c != null && c.reworkSet.size > 0 && c.cycleStartStatus != null
  })
  let totalRework = 0
  let totalDev = 0
  const changesPerIssue: ChangesIssueRow[] = []
  for (const i of allIssues) {
    const cfg = configByProject.get(i.space)
    if (cfg == null || cfg.reworkSet.size === 0 || cfg.cycleStartStatus == null) continue
    const durs = statusDurations(durationTransitions(i._id), now)
    let rework = 0
    for (const [st, ms] of durs) if (cfg.reworkSet.has(st) && st !== cfg.cycleStartStatus) rework += ms
    const dev = durs.get(cfg.cycleStartStatus) ?? 0
    if (rework + dev <= 0) continue
    totalRework += rework
    totalDev += dev
    const prefix = projectPrefix.get(i.space) ?? ''
    changesPerIssue.push({
      issueId: i._id,
      identifier: prefix !== '' ? `${prefix}-${i.number ?? '?'}` : `#${i.number ?? '?'}`,
      title: i.title,
      reworkMs: rework,
      devMs: dev,
      pct: Math.round((rework / (rework + dev)) * 100)
    })
  }
  changesPerIssue.sort((a, b) => b.pct - a.pct)
  const changes: ChangesResult = {
    configured: changesConfigured,
    pct: totalRework + totalDev > 0 ? Math.round((totalRework / (totalRework + totalDev)) * 100) : null,
    reworkMs: totalRework,
    devMs: totalDev,
    issueCount: changesPerIssue.length,
    perIssue: changesPerIssue
  }

  // === Execução do QG (on-time das issues-raiz dos membros do time QG) ===
  const qgRoot = rootApproved.filter((a) => (a.issue.assignee ?? []).some((p) => qgMemberSet.has(p)))
  const qgWithDue = qgRoot.length
  const qgOnTime = qgRoot.filter((a) => (a.firstApproval as number) <= (a.issue.dueDate as number)).length
  const qgExecution: StageRate = {
    withDue: qgWithDue,
    onTime: qgOnTime,
    pct: qgWithDue > 0 ? Math.round((qgOnTime / qgWithDue) * 100) : null
  }

  // === Atraso por pessoa (membros do QG) ===
  const overdueMap = new Map<Ref<Person>, { overdue: number, active: number }>()
  const overdueIssuesByPerson = new Map<Ref<Person>, IssueRow[]>()
  for (const i of allActiveIssues) {
    const od = isOverdue(i)
    for (const p of i.assignee ?? []) {
      if (!qgMemberSet.has(p)) continue
      const e = overdueMap.get(p) ?? { overdue: 0, active: 0 }
      e.active++
      if (od) {
        e.overdue++
        const li = overdueIssuesByPerson.get(p) ?? []
        li.push({ issue: i })
        overdueIssuesByPerson.set(p, li)
      }
      overdueMap.set(p, e)
    }
  }
  const overduePerPerson: PersonOverdueRow[] = [...overdueMap.entries()]
    .map(([person, e]) => ({
      person,
      name: nameOf(person),
      overdue: e.overdue,
      active: e.active,
      issues: overdueIssuesByPerson.get(person) ?? []
    }))
    .sort((a, b) => b.overdue - a.overdue)

  // === Capacity do pool do QG === (baseline/limiares padrão: QG é cross-BU)
  const baselineHoursPerDay = 8
  const workingDays = getWorkingDays(dateFrom, dateTo)
  let totalCommittedMs = 0
  if (qgMembers.length > 0) {
    const rawEvents = await client.findAll(calendar.class.Event, {
      _class: { $ne: calendar.class.ReccuringEvent },
      participants: { $in: qgMembers } as any,
      date: { $lte: dateTo },
      dueDate: { $gte: dateFrom }
    })
    const recurringEvents = await client.findAll(calendar.class.ReccuringEvent, {
      participants: { $in: qgMembers } as any
    })
    const combined = [...rawEvents, ...recurringEvents].filter(
      (it, idx, arr) => arr.findIndex((e) => e.eventId === it.eventId) === idx
    )
    for (const person of qgMembers) {
      const personRaw = combined.filter((ev) => (ev.participants ?? []).includes(person))
      const personEvents = getAllEvents(personRaw as Event[], dateFrom, dateTo)
      totalCommittedMs += calculateEventsDuration(
        buildCommittedIntervals(personEvents, dateFrom, dateTo, baselineHoursPerDay)
      )
    }
  }
  const committedHours = Math.round((totalCommittedMs / 3600000) * 10) / 10
  const availableHours = workingDays * baselineHoursPerDay * qgMembers.length
  const capacity: CapacityResult = {
    configured: qgMembers.length > 0,
    committedHours,
    availableHours,
    pct: availableHours > 0 ? Math.round((committedHours / availableHours) * 100) : null,
    lowPct: 70,
    highPct: 90
  }

  return {
    hasTeam: qgTeam != null,
    byCargo,
    byBU,
    changes,
    capacity,
    qgExecution,
    overduePerPerson
  }
}
