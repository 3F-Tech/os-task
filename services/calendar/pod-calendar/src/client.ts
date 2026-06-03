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

// Why: antes, getClient() criava UMA NOVA conexão WebSocket pro transactor
// a cada sync/reconcile/push. Quando createClient pendurava (load do model
// demora > 15s em workspaces grandes), o withTimeout rejeitava a Promise
// mas a conexão zumbie continuava viva — totalUsers no transactor só
// crescia. Eventualmente o pod ficava em estado degradado e só restart
// resolvia.
//
// Agora cacheia 1 Client por workspace. Todos os syncs concorrentes
// reusam — Huly Client é thread-safe pra calls concorrentes porque cada
// mensagem tem ID único. Quando algo dá erro (websocket morto, timeout),
// caller chama evictClient(workspace) pra forçar reconexão na próxima.
const clients = new Map<WorkspaceUuid, Promise<Client>>()

const CREATE_CLIENT_TIMEOUT_MS = 30_000

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

async function createClientForWorkspace (workspace: WorkspaceUuid, token: string): Promise<Client> {
  // Why: 'internal' usa hostname Docker do transactor (ws://transactor_cockroach:3332)
  // em vez do domínio público com TLS. Conexão dentro da rede Docker,
  // sem hairpin routing.
  let endpoint = endpoints.get(workspace)
  if (endpoint === undefined) {
    endpoint = await withTimeout(getTransactorEndpoint(token, 'internal'), 10_000, 'getTransactorEndpoint')
    endpoints.set(workspace, endpoint)
  }
  setMetadata(client.metadata.FilterModel, 'client')

  // Why: zombie cleanup. Se createClient passa do timeout, a Promise é
  // rejeitada mas a conexão continua negociando em background. Quando
  // (e se) ela resolve, fechamos imediatamente — evita acumular conexões
  // que o transactor vê como ativas mas nosso lado não tem referência.
  const createPromise = createClient(endpoint, token)
  let timedOut = false
  void createPromise
    .then((c) => {
      if (timedOut) {
        console.warn(`[client] closing zombie client for workspace ${workspace} (resolved after timeout)`)
        void c.close().catch(() => {})
      }
    })
    .catch(() => {})

  try {
    return await withTimeout(createPromise, CREATE_CLIENT_TIMEOUT_MS, 'createClient')
  } catch (err) {
    timedOut = true
    throw err
  }
}

export async function getClient (
  workspace: WorkspaceUuid,
  token: string = getWorkspaceToken(workspace)
): Promise<Client> {
  let cached = clients.get(workspace)
  if (cached === undefined) {
    cached = createClientForWorkspace(workspace, token).catch((err) => {
      // Promise rejected — remove do cache para próxima tentativa criar novo
      if (clients.get(workspace) === cached) {
        clients.delete(workspace)
      }
      throw err
    })
    clients.set(workspace, cached)
  }
  return await cached
}

// Why: callers DEVEM chamar isso em catch de erro de sync (websocket morto,
// timeout, etc) para forçar reconexão no próximo getClient. Sem isso, o
// cliente cacheado fica preso num estado ruim e todos os syncs subsequentes
// daquele workspace falham até restart do pod.
export function evictClient (workspace: WorkspaceUuid): void {
  const cached = clients.get(workspace)
  if (cached !== undefined) {
    clients.delete(workspace)
    void cached
      .then((c) => {
        void c.close().catch(() => {})
      })
      .catch(() => {})
  }
  endpoints.delete(workspace)
}

// Debug aid: quantos clients estão cacheados e o endpoint deles.
export function getActiveClients (): Array<{ workspace: WorkspaceUuid, endpoint: string | undefined }> {
  return Array.from(clients.keys()).map((workspace) => ({
    workspace,
    endpoint: endpoints.get(workspace)
  }))
}
