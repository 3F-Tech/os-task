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

import { type Person } from '@hcengineering/contact'
import { type Domain, IndexKind, type Ref } from '@hcengineering/core'
import {
  ArrOf,
  Index,
  Mixin,
  Model,
  Prop,
  TypeBoolean,
  TypeNumber,
  TypeRecord,
  TypeRef,
  TypeString,
  UX
} from '@hcengineering/model'
import contact from '@hcengineering/model-contact'
import core, { TDoc } from '@hcengineering/model-core'
import tracker, { TProject } from '@hcengineering/model-tracker'
import {
  type BusinessUnit,
  type ProjectDashboardConfig,
  type ProjectWithBU,
  type Team,
  type TeamMember
} from '@hcengineering/operational-dashboard'
import { type IssueStatus } from '@hcengineering/tracker'

import operationalDashboard from './plugin'

export const DOMAIN_OPERATIONAL_DASHBOARD = 'operational-dashboard' as Domain

@Model(operationalDashboard.class.BusinessUnit, core.class.Doc, DOMAIN_OPERATIONAL_DASHBOARD)
@UX(operationalDashboard.string.BusinessUnit, operationalDashboard.icon.BusinessUnit)
export class TBusinessUnit extends TDoc implements BusinessUnit {
  @Prop(TypeString(), operationalDashboard.string.Name)
  @Index(IndexKind.FullText)
    name!: string

  @Prop(TypeString(), operationalDashboard.string.Description)
    description?: string

  @Prop(TypeRef(contact.class.Person), operationalDashboard.string.Head)
    head?: Ref<Person>

  @Prop(TypeNumber(), operationalDashboard.string.Color)
    color!: number

  @Prop(TypeBoolean(), operationalDashboard.string.Archived)
    archived!: boolean
}

@Model(operationalDashboard.class.Team, core.class.Doc, DOMAIN_OPERATIONAL_DASHBOARD)
@UX(operationalDashboard.string.Team, operationalDashboard.icon.Team)
export class TTeam extends TDoc implements Team {
  @Prop(TypeString(), operationalDashboard.string.Name)
  @Index(IndexKind.FullText)
    name!: string

  @Prop(TypeString(), operationalDashboard.string.Description)
    description?: string

  @Prop(TypeNumber(), operationalDashboard.string.Color)
    color!: number

  @Prop(TypeBoolean(), operationalDashboard.string.Archived)
    archived!: boolean

  @Prop(ArrOf(TypeRecord()), operationalDashboard.string.Members)
    members!: TeamMember[]
}

@Mixin(operationalDashboard.mixin.ProjectWithBU, tracker.class.Project)
export class TProjectWithBU extends TProject implements ProjectWithBU {
  @Prop(TypeRef(operationalDashboard.class.BusinessUnit), operationalDashboard.string.BusinessUnit)
    businessUnit?: Ref<BusinessUnit>
}

@Mixin(operationalDashboard.mixin.ProjectDashboardConfig, tracker.class.Project)
export class TProjectDashboardConfig extends TProject implements ProjectDashboardConfig {
  @Prop(ArrOf(TypeRef(tracker.class.IssueStatus)), operationalDashboard.string.ApprovedStatuses)
    approvedStatuses!: Ref<IssueStatus>[]

  @Prop(ArrOf(TypeRef(tracker.class.IssueStatus)), operationalDashboard.string.ReworkStatuses)
    reworkStatuses!: Ref<IssueStatus>[]

  @Prop(ArrOf(TypeRef(tracker.class.IssueStatus)), operationalDashboard.string.WaitingApprovalStatuses)
    waitingApprovalStatuses?: Ref<IssueStatus>[]

  @Prop(TypeRef(tracker.class.IssueStatus), operationalDashboard.string.CycleStartStatus)
    cycleStartStatus?: Ref<IssueStatus>
}
