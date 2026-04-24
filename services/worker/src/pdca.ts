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

import { getClient as getAccountClient } from '@hcengineering/account-client'
import { createRestTxOperations } from '@hcengineering/api-client'
import { MeasureMetricsContext, systemAccountUuid, TxOperations, type Ref, type WorkspaceUuid } from '@hcengineering/core'
import { getPlatformQueue } from '@hcengineering/kafka'
import { generateToken } from '@hcengineering/server-token'
import { QueueTopic } from '@hcengineering/server-core'
import type { Issue, IssueStatus, PdcaFrequency } from '@hcengineering/tracker'
import tracker from '@hcengineering/tracker'
import config from './config'

const SERVICE_NAME = 'pdca-worker'

export interface PdcaCycleEvent {
  issueId: Ref<Issue>
  workspaceId: WorkspaceUuid
}

interface TimeMachineMessage {
  type: 'schedule' | 'cancel'
  id: string
  targetDate?: number
  topic?: string
  data?: any
}

function calculateNextCycleDate (frequency: PdcaFrequency, from: number): number {
  const date = new Date(from)
  if (frequency === 'weekly') {
    const daysUntilMonday = ((8 - date.getDay()) % 7) || 7
    date.setDate(date.getDate() + daysUntilMonday)
    date.setHours(0, 0, 0, 0)
  } else if (frequency === 'biweekly') {
    date.setDate(date.getDate() + 14)
    date.setHours(0, 0, 0, 0)
  } else {
    date.setMonth(date.getMonth() + 1, 1)
    date.setHours(0, 0, 0, 0)
  }
  return date.getTime()
}

async function createWorkspaceClient (workspaceUuid: WorkspaceUuid): Promise<TxOperations> {
  const token = generateToken(systemAccountUuid, workspaceUuid, { service: SERVICE_NAME })
  const accountClient = getAccountClient(config.AccountsUrl, token)
  const wsInfo = await accountClient.getLoginInfoByToken()
  if (wsInfo == null || !('endpoint' in wsInfo)) {
    throw new Error(`Could not get workspace info for ${workspaceUuid}`)
  }
  const transactorUrl = wsInfo.endpoint.replace('ws://', 'http://').replace('wss://', 'https://')
  return await createRestTxOperations(transactorUrl, wsInfo.workspace, wsInfo.token, true)
}

export async function processPdcaCycleEvent (
  ctx: MeasureMetricsContext,
  event: PdcaCycleEvent
): Promise<void> {
  const { issueId, workspaceId } = event
  let client: TxOperations | undefined

  try {
    client = await createWorkspaceClient(workspaceId)
    const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

    if (issue == null) {
      ctx.warn('PDCA cycle: issue not found', { issueId, workspaceId })
      return
    }

    const isActive = (issue as any).pdcaCycleActive === true
    const frequency = (issue as any).pdcaCycleFrequency as PdcaFrequency | undefined
    const resetStatus = (issue as any).pdcaCycleResetStatus as Ref<IssueStatus> | undefined

    if (!isActive || frequency == null || resetStatus == null) {
      ctx.info('PDCA cycle: skipping — cycle not fully configured or inactive', { issueId })
      return
    }

    if (issue.status === resetStatus) {
      ctx.info('PDCA cycle: status already matches reset status, skipping update', { issueId })
    } else {
      await client.update(issue, { status: resetStatus })
      ctx.info('PDCA cycle: status reset', { issueId, resetStatus })
    }

    const nextDate = calculateNextCycleDate(frequency, Date.now())
    await client.update(issue, { pdcaNextCycleDate: nextDate } as any)

    const queue = getPlatformQueue(SERVICE_NAME, config.QueueRegion)
    const producer = queue.getProducer<TimeMachineMessage>(ctx, QueueTopic.TimeMachine)
    await producer.send(ctx, workspaceId, [{
      type: 'schedule',
      id: `pdca_${issueId}`,
      targetDate: nextDate,
      topic: QueueTopic.PdcaCycle,
      data: { issueId, workspaceId }
    }])
  } catch (err: any) {
    ctx.error('PDCA cycle processing error', { issueId, workspaceId, err: err.message })
  } finally {
    if (client != null) {
      await client.close()
    }
  }
}

export function startPdcaConsumer (ctx: MeasureMetricsContext): void {
  const queue = getPlatformQueue(SERVICE_NAME, config.QueueRegion)
  queue.createConsumer<PdcaCycleEvent>(
    ctx,
    QueueTopic.PdcaCycle,
    'pdca-worker-group',
    async (ctx, msg) => {
      await processPdcaCycleEvent(ctx as MeasureMetricsContext, msg.value)
    }
  )
}
