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

import { type Class, type Doc, type Mixin, type Ref } from '@hcengineering/core'
import { type Person } from '@hcengineering/contact'
import { type Asset, type IntlString, type Plugin, plugin } from '@hcengineering/platform'
import { type IssueStatus, type Project } from '@hcengineering/tracker'
import { type AnyComponent } from '@hcengineering/ui'

/** @public */
export interface BusinessUnit extends Doc {
  name: string
  description?: string
  head?: Ref<Person>
  color: number
  archived: boolean
  // Config por BU (CP2) — metas e baseline de capacity. Opcionais: quando
  // ausentes, as métricas usam o comportamento/limiar padrão (fallback).
  onTimeTarget?: number // meta de entrega no prazo, em %
  baselineHoursPerDay?: number // horas disponíveis por pessoa/dia (capacity)
  capacityLowPct?: number // alerta de ociosidade quando ocupação < este %
  capacityHighPct?: number // alerta de sobrecarga quando ocupação > este %
}

/** @public */
export interface TeamMember {
  person: Ref<Person>
  role: string
}

/** @public */
export interface Team extends Doc {
  name: string
  description?: string
  color: number
  archived: boolean
  members: TeamMember[]
}

/** @public */
export interface ProjectWithBU extends Project {
  /** @deprecated cadastro local antigo; usar `coreBuId` (BU do 3F Core). */
  businessUnit?: Ref<BusinessUnit>
  /** Id da BU no 3F Core (read-through). Vínculo projeto→BU mantido no Huly. */
  coreBuId?: number
}

/** @public */
export interface ProjectDashboardConfig extends Project {
  approvedStatuses: Ref<IssueStatus>[]
  reworkStatuses: Ref<IssueStatus>[]
  waitingApprovalStatuses?: Ref<IssueStatus>[]
  cycleStartStatus?: Ref<IssueStatus>
  /** Quando true, as métricas de prazo/atraso do painel contam também as
   * SUBTAREFAS (pelo vencimento próprio). Ausente/false → só tarefas-raiz
   * (decisão #6, comportamento padrão). */
  subtaskDueDates?: boolean
}

/**
 * Configuração global do dashboard (singleton — uma única instância em
 * core.space.Workspace, id fixo operationalDashboard.ids.DashboardSettings).
 * Hoje só guarda a meta de eficiência (estimativa vs tempo gasto), aplicada a
 * TODAS as eficiências/cargos. Ausente → default no código (85%).
 * @public
 */
export interface DashboardSettings extends Doc {
  efficiencyTarget?: number
  /** Dias sem tarefa de Retenção concluída p/ marcar o cliente em risco de
   * abandono (alerta do Coordenador). Ausente → default no código (15). */
  retentionAlertDays?: number
  /** Override explícito do cargo: id do `position` (3F Core) → Cargo. Vence o
   * seed automático por nome. Ausente → só o seed por nome vale. */
  positionCargoMap?: Record<number, Cargo>
}

/**
 * Config de dashboard por BU (metas e baseline de capacity), indexada pelo
 * **id da BU no 3F Core** (`coreBuId`). Substitui os campos que viviam no
 * antigo BusinessUnit local. Ausência de instância (ou de um campo) → usa o
 * fallback global/código.
 * @public
 */
export interface BuDashboardSettings extends Doc {
  coreBuId: number
  onTimeTarget?: number
  baselineHoursPerDay?: number
  capacityLowPct?: number
  capacityHighPct?: number
  /** Limiar de WIP (tarefas ativas simultâneas) abaixo do qual a pessoa é
   * considerada ociosa no gráfico de eficiência. Ausente → default 3. */
  wipLow?: number
  /** Limiar de WIP acima do qual a pessoa é considerada sobrecarregada.
   * Ausente → default 8. */
  wipHigh?: number
}

/** @public */
export enum Cargo {
  Account = 'account',
  GT = 'gt',
  SocialMedia = 'socialMedia',
  Designer = 'designer',
  Editor = 'editor',
  Coordinator = 'coordinator',
  QGLeader = 'qgLeader'
}

/**
 * Cargo (papel operacional) global da pessoa — define quais métricas aparecem
 * na visão Individual e alimenta os rollups "por cargo".
 * @public
 */
export interface WithCargo extends Person {
  cargo?: Cargo
}

/** @public */
export const operationalDashboardId = 'operational-dashboard' as Plugin

export default plugin(operationalDashboardId, {
  class: {
    BusinessUnit: '' as Ref<Class<BusinessUnit>>,
    Team: '' as Ref<Class<Team>>,
    DashboardSettings: '' as Ref<Class<DashboardSettings>>,
    BuDashboardSettings: '' as Ref<Class<BuDashboardSettings>>
  },
  ids: {
    // Singleton de configuração global (uma instância só).
    DashboardSettings: '' as Ref<DashboardSettings>
  },
  mixin: {
    ProjectWithBU: '' as Ref<Mixin<ProjectWithBU>>,
    ProjectDashboardConfig: '' as Ref<Mixin<ProjectDashboardConfig>>,
    Cargo: '' as Ref<Mixin<WithCargo>>
  },
  string: {
    DashboardApplication: '' as IntlString,
    Dashboard: '' as IntlString,
    OperationalDashboard: '' as IntlString,
    Overview: '' as IntlString,
    BusinessUnits: '' as IntlString,
    BusinessUnit: '' as IntlString,
    NewBusinessUnit: '' as IntlString,
    EditBusinessUnit: '' as IntlString,
    NoBusinessUnits: '' as IntlString,
    Name: '' as IntlString,
    Description: '' as IntlString,
    Head: '' as IntlString,
    Color: '' as IntlString,
    Archived: '' as IntlString,
    AssociatedProjects: '' as IntlString,
    NamePlaceholder: '' as IntlString,
    DescriptionPlaceholder: '' as IntlString,
    Save: '' as IntlString,
    Cancel: '' as IntlString,
    MetricsConfig: '' as IntlString,
    ConfigureMetrics: '' as IntlString,
    ApprovedStatuses: '' as IntlString,
    ReworkStatuses: '' as IntlString,
    CycleStartStatus: '' as IntlString,
    Approved: '' as IntlString,
    Rework: '' as IntlString,
    CycleStart: '' as IntlString,
    NoCycleStart: '' as IntlString,
    Configured: '' as IntlString,
    NotConfigured: '' as IntlString,
    NoProjects: '' as IntlString,
    NoStatusesAvailable: '' as IntlString,
    ApprovedStatusesHint: '' as IntlString,
    ReworkStatusesHint: '' as IntlString,
    CycleStartStatusHint: '' as IntlString,
    StatusName: '' as IntlString,
    Project: '' as IntlString,
    ClientStage: '' as IntlString,
    Onboarding: '' as IntlString,
    Expansion: '' as IntlString,
    Retention: '' as IntlString,
    Churned: '' as IntlString,
    ThisWeek: '' as IntlString,
    ThisMonth: '' as IntlString,
    LastMonth: '' as IntlString,
    LastQuarter: '' as IntlString,
    Custom: '' as IntlString,
    From: '' as IntlString,
    To: '' as IntlString,
    Reset: '' as IntlString,
    Refresh: '' as IntlString,
    Refreshing: '' as IntlString,
    Refreshed: '' as IntlString,
    LastUpdated: '' as IntlString,
    JustNow: '' as IntlString,
    AllBUs: '' as IntlString,
    AllProjects: '' as IntlString,
    AllStages: '' as IntlString,
    User: '' as IntlString,
    AllUsers: '' as IntlString,
    SelectBUFirst: '' as IntlString,
    SelectBU: '' as IntlString,
    OnTimeTasks: '' as IntlString,
    OverdueTasks: '' as IntlString,
    Workload: '' as IntlString,
    CycleTime: '' as IntlString,
    ApprovedNoChanges: '' as IntlString,
    ReworkCycles: '' as IntlString,
    WaitingApproval: '' as IntlString,
    WaitingApprovalStatuses: '' as IntlString,
    WaitingApprovalShort: '' as IntlString,
    WaitingApprovalStatusesHint: '' as IntlString,
    IssueIdentifier: '' as IntlString,
    IssueTitle: '' as IntlString,
    Assignee: '' as IntlString,
    DueDate: '' as IntlString,
    CompletedAt: '' as IntlString,
    StartedAt: '' as IntlString,
    DaysLate: '' as IntlString,
    ReworkCount: '' as IntlString,
    TaskCount: '' as IntlString,
    SubtaskCount: '' as IntlString,
    TotalEstimation: '' as IntlString,
    Unassigned: '' as IntlString,
    Hours: '' as IntlString,
    NoIssuesInMetric: '' as IntlString,
    Teams: '' as IntlString,
    Team: '' as IntlString,
    NewTeam: '' as IntlString,
    EditTeam: '' as IntlString,
    NoTeams: '' as IntlString,
    TeamNamePlaceholder: '' as IntlString,
    Members: '' as IntlString,
    AddMember: '' as IntlString,
    Role: '' as IntlString,
    RoleLeader: '' as IntlString,
    RoleManager: '' as IntlString,
    RoleMember: '' as IntlString,
    RolePlaceholder: '' as IntlString,
    AllTeams: '' as IntlString,
    TeamRanking: '' as IntlString,
    RankBy: '' as IntlString,
    NoTeamsForRanking: '' as IntlString,
    ActiveTasks: '' as IntlString,
    Position: '' as IntlString,
    Cargos: '' as IntlString,
    Cargo: '' as IntlString,
    NoCargo: '' as IntlString,
    NoPersonsFound: '' as IntlString,
    SearchPerson: '' as IntlString,
    CargoAccount: '' as IntlString,
    CargoGT: '' as IntlString,
    CargoSocialMedia: '' as IntlString,
    CargoDesigner: '' as IntlString,
    CargoEditor: '' as IntlString,
    CargoCoordinator: '' as IntlString,
    CargoQGLeader: '' as IntlString,
    TargetsSection: '' as IntlString,
    OnTimeTarget: '' as IntlString,
    BaselineHoursPerDay: '' as IntlString,
    CapacityLowPct: '' as IntlString,
    CapacityHighPct: '' as IntlString,
    Individual: '' as IntlString,
    OnTimeOverall: '' as IntlString,
    OnTimeByStageTitle: '' as IntlString,
    PerPersonSection: '' as IntlString,
    OnTimePct: '' as IntlString,
    ChangesAdjustments: '' as IntlString,
    ChangesAdjustmentsHint: '' as IntlString,
    ReworkPct: '' as IntlString,
    WaitingApprovalCount: '' as IntlString,
    WaitingApprovalHint: '' as IntlString,
    WaitingApprovalTitle: '' as IntlString,
    PdcaOnTime: '' as IntlString,
    PdcaOnTimeTitle: '' as IntlString,
    NoPdcaTasks: '' as IntlString,
    CapacityTitle: '' as IntlString,
    CapacityHint: '' as IntlString,
    EfficiencyTitle: '' as IntlString,
    CapacityPct: '' as IntlString,
    StatusIdle: '' as IntlString,
    StatusOptimal: '' as IntlString,
    StatusOverloaded: '' as IntlString,
    NoEventsInMetric: '' as IntlString,
    QGLeader: '' as IntlString,
    ByCargoTitle: '' as IntlString,
    ByBUTitle: '' as IntlString,
    QGExecutionTitle: '' as IntlString,
    QGTeam: '' as IntlString,
    SelectQGTeam: '' as IntlString,
    Coordinator: '' as IntlString,
    AssignedTasks: '' as IntlString,
    GeneralSettings: '' as IntlString,
    EfficiencyTarget: '' as IntlString,
    EfficiencyTargetHint: '' as IntlString,
    EfficiencyTimeTitle: '' as IntlString,
    Estimation: '' as IntlString,
    SpentTime: '' as IntlString,
    EfficiencyShort: '' as IntlString,
    EfficiencyEmptyHint: '' as IntlString,
    SquadSection: '' as IntlString,
    NoSquad: '' as IntlString,
    Total: '' as IntlString,
    OnTimeFraction: '' as IntlString,
    ClientsAtRiskTitle: '' as IntlString,
    Client: '' as IntlString,
    LastRetention: '' as IntlString,
    DaysWithoutRetention: '' as IntlString,
    Never: '' as IntlString,
    NoClientsAtRisk: '' as IntlString,
    RetentionAlertDays: '' as IntlString,
    RetentionAlertDaysHint: '' as IntlString,
    ProjectsBU: '' as IntlString,
    ProjectsBUHint: '' as IntlString,
    PreviousBU: '' as IntlString,
    NoCoreBUs: '' as IntlString,
    OrgLoading: '' as IntlString,
    OrgError: '' as IntlString,
    CargoMapping: '' as IntlString,
    CargoMappingHint: '' as IntlString,
    AutoSeeded: '' as IntlString,
    CorePosition: '' as IntlString,
    BuTargets: '' as IntlString,
    BuTargetsHint: '' as IntlString,
    WipShort: '' as IntlString,
    WipLoad: '' as IntlString,
    Score: '' as IntlString,
    ScoreHint: '' as IntlString,
    WipLow: '' as IntlString,
    WipHigh: '' as IntlString,
    WipThresholdsHint: '' as IntlString,
    PrecisionShort: '' as IntlString,
    WipExplainHint: '' as IntlString,
    MyView: '' as IntlString,
    BuTeamSection: '' as IntlString,
    SubtaskDueDates: '' as IntlString,
    SubtaskDueDatesHint: '' as IntlString
  },
  icon: {
    Dashboard: '' as Asset,
    BusinessUnit: '' as Asset,
    Team: '' as Asset
  },
  component: {
    Dashboard: '' as AnyComponent,
    ProjectBUAssignment: '' as AnyComponent,
    MetricsConfig: '' as AnyComponent,
    EditProjectMetricsConfig: '' as AnyComponent,
    TeamRanking: '' as AnyComponent
  }
})
