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
  businessUnit?: Ref<BusinessUnit>
}

/** @public */
export interface ProjectDashboardConfig extends Project {
  approvedStatuses: Ref<IssueStatus>[]
  reworkStatuses: Ref<IssueStatus>[]
  waitingApprovalStatuses?: Ref<IssueStatus>[]
  cycleStartStatus?: Ref<IssueStatus>
}

/** @public */
export const operationalDashboardId = 'operational-dashboard' as Plugin

export default plugin(operationalDashboardId, {
  class: {
    BusinessUnit: '' as Ref<Class<BusinessUnit>>,
    Team: '' as Ref<Class<Team>>
  },
  mixin: {
    ProjectWithBU: '' as Ref<Mixin<ProjectWithBU>>,
    ProjectDashboardConfig: '' as Ref<Mixin<ProjectDashboardConfig>>
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
    Position: '' as IntlString
  },
  icon: {
    Dashboard: '' as Asset,
    BusinessUnit: '' as Asset,
    Team: '' as Asset
  },
  component: {
    Dashboard: '' as AnyComponent,
    BUManagement: '' as AnyComponent,
    EditBusinessUnit: '' as AnyComponent,
    MetricsConfig: '' as AnyComponent,
    EditProjectMetricsConfig: '' as AnyComponent,
    TeamManagement: '' as AnyComponent,
    EditTeam: '' as AnyComponent,
    TeamRanking: '' as AnyComponent
  }
})
