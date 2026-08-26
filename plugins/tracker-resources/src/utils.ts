//
// Copyright © 2022 Hardcore Engineering Inc.
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

import { Analytics } from '@hcengineering/analytics'
import { type Person } from '@hcengineering/contact'
import core, {
  AccountRole,
  SortingOrder,
  toIdMap,
  type ApplyOperations,
  type AttachedData,
  type AttachedDoc,
  type Class,
  type Collection,
  type Doc,
  type DocumentQuery,
  type DocumentUpdate,
  type Ref,
  type Space,
  type Status,
  type StatusCategory,
  type TxCreateDoc,
  type TxOperations,
  type TxResult,
  type TxUpdateDoc,
  getCurrentAccount,
  type WithLookup
} from '@hcengineering/core'
import { type IntlString } from '@hcengineering/platform'
import { createQuery, getClient, onClient } from '@hcengineering/presentation'
import task, { getStatusIndex, makeRank, type TaskType, type ProjectType } from '@hcengineering/task'
import {
  selectedTaskTypeStore,
  activeProjects as taskActiveProjects,
  taskTypeStore,
  typeStore,
  typesOfJoinedProjectsStore
} from '@hcengineering/task-resources'
import {
  IssuePriority,
  MilestoneStatus,
  TimeReportDayType,
  type Component,
  type Issue,
  type IssueStatus,
  type Milestone,
  type Project
} from '@hcengineering/tracker'
import { areDatesEqual, isWeekend, PaletteColorIndexes } from '@hcengineering/ui'
import { type KeyFilter, type ViewletDescriptor } from '@hcengineering/view'
import { CategoryQuery, ListSelectionProvider, statusStore, type SelectDirection } from '@hcengineering/view-resources'
import { derived, get, writable } from 'svelte/store'
import tracker from './plugin'
import { defaultMilestoneStatuses, defaultPriorities } from './types'

export const activeProjects = derived(taskActiveProjects, (projects) => {
  const client = getClient()
  return toIdMap(
    Array.from(projects.values()).filter((it) => client.getHierarchy().isDerived(it._class, tracker.class.Project))
  ) as Map<Ref<Project>, Project>
})
export * from './types'

export type ComponentsFilterMode = 'all' | 'backlog' | 'active' | 'closed'

export type MilestoneViewMode = 'all' | 'planned' | 'active' | 'closed'

export const getIncludedMilestoneStatuses = (mode: MilestoneViewMode): MilestoneStatus[] => {
  switch (mode) {
    case 'all': {
      return defaultMilestoneStatuses
    }
    case 'active': {
      return [MilestoneStatus.InProgress]
    }
    case 'planned': {
      return [MilestoneStatus.Planned]
    }
    case 'closed': {
      return [MilestoneStatus.Completed, MilestoneStatus.Canceled]
    }
    default: {
      return []
    }
  }
}

export const componentsTitleMap: Record<ComponentsFilterMode, IntlString> = Object.freeze({
  all: tracker.string.AllComponents,
  backlog: tracker.string.BacklogComponents,
  active: tracker.string.ActiveComponents,
  closed: tracker.string.ClosedComponents
})

export const milestoneTitleMap: Record<MilestoneViewMode, IntlString> = Object.freeze({
  all: tracker.string.AllMilestones,
  planned: tracker.string.PlannedMilestones,
  active: tracker.string.ActiveMilestones,
  closed: tracker.string.ClosedMilestones
})

/**
 * @public
 */
export const listIssueStatusOrder = [
  task.statusCategory.Active,
  task.statusCategory.ToDo,
  task.statusCategory.UnStarted,
  task.statusCategory.Won,
  task.statusCategory.Lost
] as const

/**
 * @public
 */
export const listIssueKanbanStatusOrder = [
  task.statusCategory.UnStarted,
  task.statusCategory.ToDo,
  task.statusCategory.Active,
  task.statusCategory.Won,
  task.statusCategory.Lost
] as const

function getTaskTypesStatusIndex (joinedTaskTypes: TaskType[], status: Ref<Status>): number {
  for (const taskType of joinedTaskTypes) {
    const indexx = taskType.statuses.indexOf(status)
    if (indexx >= 0) {
      return indexx
    }
  }
  return -1
}

export async function issueStatusSort (
  client: TxOperations,
  value: Array<Ref<IssueStatus>>,
  space: Ref<Project> | undefined,
  viewletDescriptorId?: Ref<ViewletDescriptor>
): Promise<Array<Ref<IssueStatus>>> {
  let type: ProjectType | undefined
  if (space !== undefined) {
    const _space = await client.findOne(
      task.class.Project,
      { _id: space },
      {
        lookup: {
          type: task.class.ProjectType
        }
      }
    )
    type = _space?.$lookup?.type
  }
  const joinedProjectsTypes = get(typesOfJoinedProjectsStore) ?? []
  const taskTypes = get(taskTypeStore)
  const joinedTaskTypes = Array.from(taskTypes.values()).filter(
    (taskType) => joinedProjectsTypes.includes(taskType.parent) && taskType.ofClass === tracker.class.Issue
  )
  const taskTypeId = get(selectedTaskTypeStore) ?? (joinedTaskTypes.length === 1 ? joinedTaskTypes[0]?._id : undefined)
  const taskType = taskTypeId !== undefined ? taskTypes.get(taskTypeId) : undefined

  const statuses = get(statusStore).byId
  // TODO: How we track category updates.

  if (viewletDescriptorId === tracker.viewlet.Kanban) {
    value.sort((a, b) => {
      const aVal = statuses.get(a)
      const bVal = statuses.get(b)
      const res =
        listIssueKanbanStatusOrder.indexOf(aVal?.category as Ref<StatusCategory>) -
        listIssueKanbanStatusOrder.indexOf(bVal?.category as Ref<StatusCategory>)
      if (res === 0) {
        if (taskType != null) {
          const aIndex = taskType.statuses.findIndex((p) => p === a)
          const bIndex = taskType.statuses.findIndex((p) => p === b)
          return aIndex - bIndex
        }
        if (type != null) {
          const aIndex = getStatusIndex(type, taskTypes, a)
          const bIndex = getStatusIndex(type, taskTypes, b)
          return aIndex - bIndex
        }
        const aIndex = getTaskTypesStatusIndex(joinedTaskTypes, a)
        const bIndex = getTaskTypesStatusIndex(joinedTaskTypes, b)
        return aIndex - bIndex
      }
      return res
    })
  } else {
    value.sort((a, b) => {
      const aVal = statuses.get(a) as IssueStatus
      const bVal = statuses.get(b) as IssueStatus
      const res =
        listIssueStatusOrder.indexOf(aVal?.category as Ref<StatusCategory>) -
        listIssueStatusOrder.indexOf(bVal?.category as Ref<StatusCategory>)
      if (res === 0) {
        if (taskType != null) {
          const aIndex = taskType.statuses.findIndex((p) => p === a)
          const bIndex = taskType.statuses.findIndex((p) => p === b)
          return aIndex - bIndex
        }
        if (type != null) {
          const aIndex = getStatusIndex(type, taskTypes, a)
          const bIndex = getStatusIndex(type, taskTypes, b)
          return aIndex - bIndex
        }
        const aIndex = getTaskTypesStatusIndex(joinedTaskTypes, a)
        const bIndex = getTaskTypesStatusIndex(joinedTaskTypes, b)
        return aIndex - bIndex
      }
      return res
    })
  }
  return value
}

export async function issuePrioritySort (client: TxOperations, value: IssuePriority[]): Promise<IssuePriority[]> {
  value.sort((a, b) => {
    const i1 = defaultPriorities.indexOf(a)
    const i2 = defaultPriorities.indexOf(b)

    return i2 - i1
  })
  return value
}

export async function milestoneSort (
  client: TxOperations,
  value: Array<Ref<Milestone>>
): Promise<Array<Ref<Milestone>>> {
  return await new Promise((resolve) => {
    const query = createQuery(true)
    query.query(tracker.class.Milestone, { _id: { $in: value } }, (res) => {
      const milestones = toIdMap(res)
      value.sort((a, b) => (milestones.get(b)?.targetDate ?? 0) - (milestones.get(a)?.targetDate ?? 0))
      resolve(value)
      query.unsubscribe()
    })
  })
}
export async function moveIssuesToAnotherMilestone (
  client: TxOperations,
  oldMilestone: Milestone,
  newMilestone: Milestone | undefined
): Promise<boolean> {
  try {
    // Find all Issues by Milestone
    const movedIssues = await client.findAll(tracker.class.Issue, { milestone: oldMilestone._id })

    // Update Issues by new Milestone
    const awaitedUpdates: Array<Promise<TxResult>> = []
    for (const issue of movedIssues) {
      awaitedUpdates.push(client.update(issue, { milestone: newMilestone?._id ?? null }))
    }
    await Promise.all(awaitedUpdates)

    return true
  } catch (error: any) {
    console.error(
      `Error happened while moving issues between milestones from ${oldMilestone.label} to ${
        newMilestone?.label ?? 'No Milestone'
      }: `,
      error
    )
    Analytics.handleError(error)
    return false
  }
}

export async function canEditIssue (issue?: Issue | WithLookup<Issue>): Promise<boolean> {
  const client = getClient()
  if (issue === undefined) return false

  const account = getCurrentAccount()
  const isGuest =
    account.role === AccountRole.Guest ||
    account.role === AccountRole.DocGuest ||
    account.role === AccountRole.ReadOnlyGuest

  if (!isGuest) return true

  const isCreator =
    issue.createdBy !== undefined && Array.isArray(account.socialIds) && account.socialIds.includes(issue.createdBy)

  if (isCreator) return true

  const collaborator = await client.findOne(core.class.Collaborator, {
    attachedTo: issue._id,
    collaborator: account.uuid
  })
  return collaborator !== undefined
}

export function getTimeReportDate (type: TimeReportDayType): number {
  const date = new Date(Date.now())

  if (type === TimeReportDayType.PreviousWorkDay) {
    date.setDate(date.getDate() - 1)
  }

  // if date is day off then set date to last working day
  while (isWeekend(date)) {
    date.setDate(date.getDate() - 1)
  }

  return date.valueOf()
}

export function getTimeReportDayType (timestamp: number): TimeReportDayType | undefined {
  const date = new Date(timestamp)
  const currentWorkDate = new Date(getTimeReportDate(TimeReportDayType.CurrentWorkDay))
  const previousWorkDate = new Date(getTimeReportDate(TimeReportDayType.PreviousWorkDay))

  if (areDatesEqual(date, currentWorkDate)) {
    return TimeReportDayType.CurrentWorkDay
  } else if (areDatesEqual(date, previousWorkDate)) {
    return TimeReportDayType.PreviousWorkDay
  }
}

export function subIssueQuery (value: boolean, query: DocumentQuery<Issue>): DocumentQuery<Issue> {
  return value ? query : { ...query, attachedTo: tracker.ids.NoParent }
}

async function getAllSomething (
  _class: Ref<Class<Doc>>,
  query: DocumentQuery<Doc> | undefined,
  onUpdate: () => void,
  queryId: Ref<Doc>
): Promise<any[] | undefined> {
  const promise = new Promise<Array<Ref<Doc>>>((resolve, reject) => {
    let refresh: boolean = false
    const lq = CategoryQuery.getLiveQuery(queryId)
    refresh = lq.query(_class, query ?? {}, (res) => {
      const result = res.map((p) => p._id)
      CategoryQuery.results.set(queryId, result)
      resolve(result)
      onUpdate()
    })

    if (!refresh) {
      resolve(CategoryQuery.results.get(queryId) ?? [])
    }
  })
  return await promise
}

export async function getAllPriority (
  query: DocumentQuery<Doc> | undefined,
  onUpdate: () => void,
  queryId: Ref<Doc>
): Promise<any[] | undefined> {
  return defaultPriorities
}

export async function getAllComponents (
  query: DocumentQuery<Doc> | undefined,
  onUpdate: () => void,
  queryId: Ref<Doc>
): Promise<any[] | undefined> {
  return await getAllSomething(tracker.class.Component, query, onUpdate, queryId)
}

export async function getAllMilestones (
  query: DocumentQuery<Doc> | undefined,
  onUpdate: () => void,
  queryId: Ref<Doc>
): Promise<any[] | undefined> {
  return await getAllSomething(tracker.class.Milestone, query, onUpdate, queryId)
}

export function subIssueListProvider (subIssues: Issue[], target: Ref<Issue>): void {
  const listProvider = new ListSelectionProvider((offset: 1 | -1 | 0, of?: Doc, dir?: SelectDirection) => {
    if (dir === 'vertical') {
      let pos = subIssues.findIndex((p) => p._id === of?._id)
      pos += offset
      if (pos < 0) {
        pos = 0
      }
      if (pos >= subIssues.length) {
        pos = subIssues.length - 1
      }
      listProvider.updateFocus(subIssues[pos])
    }
  }, false)
  listProvider.update(subIssues)
  const selectedIssue = subIssues.find((p) => p._id === target)
  if (selectedIssue != null) {
    listProvider.updateFocus(selectedIssue)
  }
}

export async function getPreviousAssignees (objectId: Ref<Issue> | undefined): Promise<Array<Ref<Person>>> {
  if (objectId === undefined) {
    return []
  }
  const client = getClient()
  const createTx = (
    await client.findAll<TxCreateDoc<Issue>>(core.class.TxCreateDoc, {
      objectId
    })
  )[0]
  const updateTxes = await client.findAll<TxUpdateDoc<Issue>>(
    core.class.TxUpdateDoc,
    { objectId, 'operations.assignee': { $exists: true } },
    { sort: { modifiedOn: -1 } }
  )
  const set = new Set<Ref<Person>>()
  // valores podem ser escalares (Txs antigas) ou arrays (multi-assignee)
  const addAll = (value: Ref<Person>[] | Ref<Person> | null | undefined): void => {
    if (value == null) return
    for (const v of Array.isArray(value) ? value : [value]) {
      set.add(v)
    }
  }
  for (const tx of updateTxes) {
    addAll(tx.operations.assignee as Ref<Person>[] | Ref<Person> | null | undefined)
  }
  addAll(createTx?.attributes?.assignee as Ref<Person>[] | Ref<Person> | null | undefined)
  return Array.from(set)
}

async function updateIssuesOnMove (
  client: TxOperations,
  applyOps: ApplyOperations,
  doc: Doc,
  space: Project,
  extra: DocumentUpdate<any>,
  updates: Map<Ref<Issue>, DocumentUpdate<Issue>>
): Promise<void> {
  const hierarchy = client.getHierarchy()
  const attributes = hierarchy.getAllAttributes(doc._class)
  for (const attribute of attributes.values()) {
    if (hierarchy.isDerived(attribute.type._class, core.class.Collection)) {
      const collection = attribute.type as Collection<AttachedDoc>
      const allAttached = await client.findAll(collection.of, { attachedTo: doc._id })
      for (const attached of allAttached) {
        if (hierarchy.isDerived(collection.of, tracker.class.Issue)) {
          const lastOne = await client.findOne(tracker.class.Issue, {}, { sort: { rank: SortingOrder.Descending } })
          const incResult = await client.updateDoc(
            tracker.class.Project,
            core.space.Space,
            space._id,
            {
              $inc: { sequence: 1 }
            },
            true
          )
          const number = (incResult as any).object.sequence
          await updateIssuesOnMove(
            client,
            applyOps,
            attached,
            space,
            {
              ...updates.get(attached._id as Ref<Issue>),
              rank: makeRank(lastOne?.rank, undefined),
              number,
              identifier: `${space.identifier}-${number}`
            },
            updates
          )
        } else {
          await updateIssuesOnMove(client, applyOps, attached, space, {}, updates)
        }
      }
    }
  }
  await applyOps.update(doc, {
    space: space._id,
    ...extra
  })
}

/**
 * @public
 */
export async function moveIssueToSpace (
  client: TxOperations,
  docs: Issue[],
  space: Project,
  updates: Map<Ref<Issue>, DocumentUpdate<Issue>>
): Promise<void> {
  const applyOps = client.apply()
  for (const doc of docs) {
    const lastOne = await client.findOne(tracker.class.Issue, {}, { sort: { rank: SortingOrder.Descending } })
    const incResult = await client.updateDoc(
      tracker.class.Project,
      core.space.Space,
      space._id,
      {
        $inc: { sequence: 1 }
      },
      true
    )
    const number = (incResult as any).object.sequence
    await updateIssuesOnMove(
      client,
      applyOps,
      doc,
      space,
      {
        ...updates.get(doc._id),
        rank: makeRank(lastOne?.rank, undefined),
        number,
        identifier: `${space.identifier}-${number}`
      },
      updates
    )
  }
  await applyOps.commit()
}

/**
 * @public
 *
 * Will collect all issues to be moved.
 */
export async function collectIssues (client: TxOperations, docs: Doc[]): Promise<Issue[]> {
  const result: Issue[] = []
  const hierarchy = client.getHierarchy()
  for (const doc of docs) {
    if (hierarchy.isDerived(doc._class, tracker.class.Issue)) {
      result.push(doc as Issue)
    }

    const attributes = hierarchy.getAllAttributes(doc._class)
    for (const attribute of attributes.values()) {
      if (hierarchy.isDerived(attribute.type._class, core.class.Collection)) {
        const collection = attribute.type as Collection<AttachedDoc>
        const allAttached = await client.findAll(collection.of, { attachedTo: doc._id })
        for (const attached of allAttached) {
          if (hierarchy.isDerived(collection.of, tracker.class.Issue)) {
            if (result.find((it) => it._id === attached._id) === undefined) {
              result.push(attached as Issue)
            }
          }

          const subIssues = await collectIssues(client, [attached])
          if (subIssues.length > 0) {
            for (const s of subIssues) {
              if (result.find((it) => it._id === s._id) === undefined) {
                result.push(s)
              }
            }
          }
        }
      }
    }
  }
  return result
}

/**
 * @public
 *
 * Troca o ProjectType de um projeto existente, remapeando todas as issues (e templates) do
 * projeto para o `kind`/`status` válidos do novo tipo. O mapeamento é por categoria de status:
 *  - categoria "Won"  → primeiro status "Won" do novo tipo (finalizado é preservado);
 *  - categoria "Lost" → primeiro status "Lost" do novo tipo (cancelado é preservado);
 *  - qualquer outra (em aberto) → status inicial do novo tipo.
 *
 * As roles do tipo anterior NÃO são migradas (papéis pertencem ao ProjectType); apenas garantimos
 * o mixin do novo `targetClass` para o projeto continuar consistente. Toda a migração roda num
 * único `apply` (atômica): ou tudo é aplicado, ou nada.
 */
export async function changeProjectType (
  client: TxOperations,
  project: Project,
  newTypeId: Ref<ProjectType>,
  preferredInitial?: Ref<IssueStatus>
): Promise<void> {
  const hierarchy = client.getHierarchy()
  const newType = get(typeStore).get(newTypeId)
  if (newType === undefined) {
    throw new Error(`Project type ${newTypeId} not found`)
  }

  // TaskType de Issue dentro do novo tipo (assume o primeiro, como no resto do tracker)
  const targetTaskType = Array.from(get(taskTypeStore).values()).find(
    (tt) => tt.parent === newTypeId && tt.ofClass === tracker.class.Issue
  )
  if (targetTaskType === undefined) {
    throw new Error(`No issue task type found for project type ${newTypeId}`)
  }
  if (targetTaskType.statuses.length === 0) {
    throw new Error(`Task type ${targetTaskType._id} has no statuses`)
  }

  const statuses = get(statusStore).byId

  // Status-alvo por categoria, a partir da lista ordenada de status do novo TaskType
  const initial: Ref<IssueStatus> = (
    preferredInitial !== undefined && targetTaskType.statuses.includes(preferredInitial)
      ? preferredInitial
      : targetTaskType.statuses[0]
  ) as Ref<IssueStatus>
  const findByCategory = (category: Ref<StatusCategory>): Ref<IssueStatus> | undefined =>
    targetTaskType.statuses.find((s) => statuses.get(s)?.category === category) as Ref<IssueStatus> | undefined
  const wonStatus = findByCategory(task.statusCategory.Won) ?? initial
  const lostStatus = findByCategory(task.statusCategory.Lost) ?? initial

  const applyOps = client.apply('change-project-type')

  // Todas as issues do projeto (sub-issues compartilham o mesmo space)
  const issues = await client.findAll(tracker.class.Issue, { space: project._id })
  for (const issue of issues) {
    const category = statuses.get(issue.status)?.category
    const newStatus =
      category === task.statusCategory.Won
        ? wonStatus
        : category === task.statusCategory.Lost
          ? lostStatus
          : initial
    if (issue.status !== newStatus || issue.kind !== targetTaskType._id) {
      await applyOps.update(issue, { status: newStatus, kind: targetTaskType._id })
    }
  }

  // Templates do projeto: só o kind (templates não guardam status de execução)
  const templates = await client.findAll(tracker.class.IssueTemplate, { space: project._id })
  for (const template of templates) {
    if (template.kind !== targetTaskType._id) {
      await applyOps.update(template, { kind: targetTaskType._id })
    }
  }

  // O próprio projeto por último, dentro do mesmo apply
  await applyOps.update(project, { type: newTypeId, defaultIssueStatus: initial })

  await applyOps.commit()

  // Garante o mixin do targetClass do novo tipo (guarda roles/atributos por tipo)
  if (!hierarchy.hasMixin(project, newType.targetClass)) {
    await client.createMixin(project._id, tracker.class.Project, core.space.Space, newType.targetClass, {})
  }
}

/**
 * @public
 */
export function issueToAttachedData (issue: Issue): AttachedData<Issue> {
  const { _id, _class, space, ...data } = issue
  return { ...data }
}

/**
 * @public
 */
export const IssuePriorityColor = {
  [IssuePriority.NoPriority]: PaletteColorIndexes.Blueberry,
  [IssuePriority.Urgent]: PaletteColorIndexes.Orange,
  [IssuePriority.High]: PaletteColorIndexes.Sunshine,
  [IssuePriority.Medium]: PaletteColorIndexes.Ocean,
  [IssuePriority.Low]: PaletteColorIndexes.Cloud
}

export async function getVisibleFilters (filters: KeyFilter[], space?: Ref<Space>): Promise<KeyFilter[]> {
  // Removes the "Project" filter if a specific space is provided
  return space === undefined ? filters : filters.filter((f) => f.key !== 'space')
}

export function getIssueChatTitle (object: Issue): string {
  return object.title
}

export function getIssueStatusCategories (project: ProjectType): Array<Ref<StatusCategory>> {
  if (project.classic) {
    return [
      task.statusCategory.UnStarted,
      task.statusCategory.ToDo,
      task.statusCategory.Active,
      task.statusCategory.Won,
      task.statusCategory.Lost
    ]
  } else {
    return [
      task.statusCategory.UnStarted,
      task.statusCategory.Active,
      task.statusCategory.Won,
      task.statusCategory.Lost
    ]
  }
}

interface ManualUpdates {
  useStatus: boolean
  useComponent: boolean
  createStatus: boolean
  createComponent: boolean
}
export type IssueToUpdate = DocumentUpdate<Issue> & Partial<ManualUpdates>

export interface ComponentToUpdate {
  ref: Ref<Component>
  create?: boolean
}

export async function getComponentTitle (client: TxOperations, ref: Ref<Component>): Promise<string> {
  const object = await client.findOne(tracker.class.Component, { _id: ref })

  return object?.label ?? ''
}

export async function getMilestoneTitle (client: TxOperations, ref: Ref<Milestone>): Promise<string> {
  const object = await client.findOne(tracker.class.Milestone, { _id: ref })

  return object?.label ?? ''
}

export interface IssueRef {
  status: Ref<Status>
  _id: Ref<Issue>
}
export type IssueReverseRevMap = Map<Ref<Doc>, IssueRef[]>
export const relatedIssues = writable<IssueReverseRevMap>(new Map())

const relatedIssuesQuery = createQuery(true)
onClient(() => {
  relatedIssuesQuery.query(
    tracker.class.Issue,
    { 'relations._id': { $exists: true } },
    (res) => {
      const nMap: IssueReverseRevMap = new Map()
      for (const r of res) {
        for (const rr of r.relations ?? []) {
          nMap.set(rr._id, [...(nMap.get(rr._id) ?? []), { _id: r._id, status: r.status }])
        }
      }
      relatedIssues.set(nMap)
    },
    {
      projection: {
        relations: 1,
        status: 1
      }
    }
  )
})
