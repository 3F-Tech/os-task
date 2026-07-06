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

import { AccountRole } from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/model-core'
import workbench from '@hcengineering/model-workbench'

import operationalDashboard from './plugin'
import {
  TBuDashboardSettings,
  TBusinessUnit,
  TDashboardSettings,
  TProjectDashboardConfig,
  TProjectWithBU,
  TTeam,
  TWithCargo
} from './types'

export { operationalDashboardId } from '@hcengineering/operational-dashboard'
export * from './migration'
export * from './types'

export function createModel (builder: Builder): void {
  builder.createModel(
    TBusinessUnit,
    TTeam,
    TProjectWithBU,
    TProjectDashboardConfig,
    TWithCargo,
    TDashboardSettings,
    TBuDashboardSettings
  )

  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: operationalDashboard.string.DashboardApplication,
      icon: operationalDashboard.icon.Dashboard,
      alias: 'operational-dashboard',
      hidden: false,
      position: 'mid',
      // Liberado para User: o gating fino (quem vê quais abas / dados de quem)
      // é feito no front por AccountRole + Cargo. User normal vê só a Individual
      // travada nele mesmo.
      accessLevel: AccountRole.User,
      component: operationalDashboard.component.Dashboard
    },
    operationalDashboard.app.Dashboard
  )
}
