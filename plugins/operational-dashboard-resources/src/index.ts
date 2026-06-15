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

import { type Resources } from '@hcengineering/platform'
import BUManagement from './components/BUManagement.svelte'
import Dashboard from './components/Dashboard.svelte'
import EditBusinessUnit from './components/EditBusinessUnit.svelte'
import EditProjectMetricsConfig from './components/EditProjectMetricsConfig.svelte'
import EditTeam from './components/EditTeam.svelte'
import MetricsConfig from './components/MetricsConfig.svelte'
import TeamManagement from './components/TeamManagement.svelte'
import TeamRanking from './components/TeamRanking.svelte'

export default async (): Promise<Resources> => ({
  component: {
    Dashboard,
    BUManagement,
    EditBusinessUnit,
    MetricsConfig,
    EditProjectMetricsConfig,
    TeamManagement,
    EditTeam,
    TeamRanking
  }
})
