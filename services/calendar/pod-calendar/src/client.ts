//
// Copyright © 2023 Hardcore Engineering Inc.
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

import client from '@hcengineering/client'
import { WorkspaceUuid, type Client } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { createClient, getTransactorEndpoint } from '@hcengineering/server-client'
import { getWorkspaceToken } from './utils'

const endpoints = new Map<WorkspaceUuid, string>()

function withTimeout<T> (promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`${label} timeout after ${ms}ms`))
      }, ms)
    )
  ])
}

export async function getClient (
  workspace: WorkspaceUuid,
  token: string = getWorkspaceToken(workspace)
): Promise<Client> {
  // Why: 'internal' usa o hostname Docker do transactor (ws://transactor_cockroach:3332)
  // em vez do domínio público com TLS. Conexão fica dentro da rede Docker,
  // sem hairpin routing (sair pra internet pra voltar). Resolve os
  // "client websocket error" e timeouts no createClient.
  let endpoint = endpoints.get(workspace)
  if (endpoint === undefined) {
    endpoint = await withTimeout(getTransactorEndpoint(token, 'internal'), 10_000, 'getTransactorEndpoint')
    endpoints.set(workspace, endpoint)
  }
  setMetadata(client.metadata.FilterModel, 'client')
  return await withTimeout(createClient(endpoint, token), 15_000, 'createClient')
}
