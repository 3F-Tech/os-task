//
// Copyright © 2023 Hardcore Engineering Inc.
//
/* eslint-disable @typescript-eslint/no-unused-vars */
import chunter from '@hcengineering/chunter'
import core, {
  ClassifierKind,
  Doc,
  DocumentUpdate,
  Hierarchy,
  Ref,
  Space,
  Storage,
  Tx,
  TxCUD,
  TxCreateDoc,
  TxProcessor,
  TxUpdateDoc,
  systemAccount,
  systemAccountUuid,
  type Class,
  type TxMixin
} from '@hcengineering/core'
import github, { DocSyncInfo, GithubProject } from '@hcengineering/github'
import { TriggerControl } from '@hcengineering/server-core'
import time, { ToDo } from '@hcengineering/time'
import task from '@hcengineering/task'
import tracker, { type Issue, type IssueStatus, type Project } from '@hcengineering/tracker'

/**
 * @public
 */
export async function OnGithubBroadcast (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  // Enhance broadcast to send DocSyncInfo change only to system account.
  control.ctx.contextData.broadcast.targets.github = async (it) => {
    if (TxProcessor.isExtendsCUD(it._class)) {
      if ((it as TxCUD<Doc>).objectClass === github.class.DocSyncInfo) {
        return { target: [systemAccountUuid] }
      }
    }
  }
  return []
}

/**
 * @public
 */
export async function OnProjectChanges (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  // Enhance broadcast to send DocSyncInfo change only to system account.
  await OnGithubBroadcast(txes, control)

  const result: Tx[] = []
  const cache = new Map<string, any>()

  const toApply: Tx[] = []
  for (const ltx of txes) {
    if (ltx._class === core.class.TxMixin && (ltx as TxMixin<Doc, Doc>).mixin === github.mixin.GithubIssue) {
      const mix = ltx as TxMixin<Doc, Doc>
      // Do not spend time to wait for trigger processing
      await updateDocSyncInfo(control, ltx, mix.objectSpace, mix, cache, toApply)
      continue
    }

    if (TxProcessor.isExtendsCUD(ltx._class)) {
      const cud = ltx as TxCUD<Doc>

      let space: Ref<Space> = cud.objectSpace

      if (cud._class === core.class.TxUpdateDoc) {
        const upd = cud as TxUpdateDoc<Doc>
        if (upd.operations.space != null) {
          space = upd.operations.space
        }
      }

      if (isDocSyncUpdateRequired(control.hierarchy, cud)) {
        await updateDocSyncInfo(control, ltx, space, cud, cache, toApply)
      }
      if (control.hierarchy.isDerived(cud.objectClass, time.class.ToDo)) {
        if (cud.attachedToClass !== undefined && cud.attachedTo !== undefined) {
          if (control.hierarchy.isDerived(cud.attachedToClass, github.class.GithubPullRequest)) {
            // Ok we got todo change for pull request, let's mark it for sync.
            result.push(
              control.txFactory.createTxUpdateDoc<DocSyncInfo>(
                github.class.DocSyncInfo,
                ltx.objectSpace,
                cud.attachedTo as Ref<DocSyncInfo>,
                {
                  needSync: ''
                }
              )
            )
          }
        }
      }
    }
  }
  if (toApply.length > 0) {
    await control.apply(control.ctx, toApply)
  }
  return result
}

/**
 * @public
 */
export async function OnProjectRemove (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const ltx of txes) {
    if (ltx._class === core.class.TxRemoveDoc) {
      const cud = ltx as TxCUD<Doc>
      if (control.hierarchy.isDerived(cud.objectClass, tracker.class.Project)) {
        const project = control.removedMap.get(cud.objectId)
        if (project === undefined) {
          continue
        }
        if (control.hierarchy.hasMixin(project, github.mixin.GithubProject)) {
          const repos = await control.findAll(control.ctx, github.class.GithubIntegrationRepository, {
            githubProject: cud.objectId as Ref<GithubProject>
          })
          for (const repo of repos) {
            result.push(
              control.txFactory.createTxUpdateDoc(repo._class, repo.space, repo._id, {
                enabled: false,
                githubProject: null
              })
            )
          }

          const syncDocs = control.modelDb.findAllSync(github.class.DocSyncInfo, {
            space: cud.objectId as Ref<Space>
          })
          for (const syncDoc of syncDocs) {
            result.push(control.txFactory.createTxRemoveDoc(syncDoc._class, syncDoc.space, syncDoc._id))
          }
        }
      }
    }
  }
  if (result.length > 0) {
    await OnGithubBroadcast(txes, control)
  }
  return result
}

function sanitizeBranchName (title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200)
}

function getNomeDoProjetoFromMixinTx (control: TriggerControl, mixin: Ref<Class<Doc>>, attributes: Record<string, any>): string | undefined {
  try {
    const attrs = control.hierarchy.getAllAttributes(mixin)
    for (const [attrName, attr] of attrs) {
      if (!(attr as any).isCustom) continue
      const labelStr = attr.label as string
      if (labelStr.includes('Nome do Projeto')) {
        // TxMixin attributes can be stored with or without mixin prefix: "<mixin>.<attrName>" or "<attrName>"
        const value = attributes[`${mixin}.${attrName}`] ?? attributes[attrName]
        if (typeof value === 'string' && value.trim() !== '') {
          return value.trim()
        }
      }
    }
  } catch {
    // mixin not in hierarchy
  }
  return undefined
}

function getCustomFieldValue (control: TriggerControl, issue: Issue, labelFragment: string): string | undefined {
  const hierarchy = control.hierarchy
  const descendants = hierarchy.getDescendants(tracker.class.Issue)
  for (const mixin of descendants) {
    try {
      if (hierarchy.getClass(mixin).kind !== ClassifierKind.MIXIN) continue
      if (!hierarchy.hasMixin(issue, mixin)) continue
      const attrs = hierarchy.getOwnAttributes(mixin)
      for (const [attrName, attr] of attrs) {
        if (!(attr as any).isCustom) continue
        if (!(attr.label as string).includes(labelFragment)) continue
        const mixinData = hierarchy.as<Issue, any>(issue, mixin)
        const value = mixinData[attrName]
        if (typeof value === 'string' && value.trim() !== '') {
          return value.trim()
        }
      }
    } catch { /* mixin not in hierarchy */ }
  }
  return undefined
}

function buildBranchName (tipo: string | undefined, title: string): string {
  const slug = sanitizeBranchName(title)
  return tipo !== undefined ? `${tipo.toLowerCase()}/${slug}` : slug
}

/**
 * @public
 */
export async function OnTechIssueChange (txes: TxCUD<Doc>[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  console.log('[OnTechIssueChange] triggered, tx count:', txes.length)
  control.ctx.info('OnTechIssueChange: triggered', { count: txes.length })
  for (const tx of txes) {
    if (!control.hierarchy.isDerived(tx.objectClass, tracker.class.Issue)) continue
    control.ctx.info('OnTechIssueChange: tx', { _class: tx._class, objectClass: tx.objectClass, objectId: tx.objectId })

    if (tx._class === core.class.TxCreateDoc) {
      const createTx = tx as TxCreateDoc<Issue>
      const projects = await control.findAll(control.ctx, tracker.class.Project, {
        _id: createTx.objectSpace as Ref<Project>
      })
      const project = projects[0]
      control.ctx.info('OnTechIssueChange: TxCreateDoc', { identifier: project?.identifier })
      if (project?.identifier !== 'TECH_') continue

      const issue = TxProcessor.createDoc2Doc(createTx) as Issue
      if (!issue.clientName) continue

      const branchName = sanitizeBranchName(issue.title)
      result.push(
        control.txFactory.createTxCreateDoc(github.class.GithubBranchRequest, tx.objectSpace, {
          issueId: tx.objectId as Ref<Issue>,
          repo: issue.clientName,
          branchName,
          action: 'create',
          status: 'pending'
        })
      )
    }

    if (tx._class === core.class.TxMixin) {
      const mixinTx = tx as unknown as { mixin: Ref<Class<Doc>>, attributes: Record<string, any>, objectSpace: Ref<Space> }
      control.ctx.info('OnTechIssueChange: TxMixin', { mixin: mixinTx.mixin, attrKeys: Object.keys(mixinTx.attributes) })
      const repoName = getNomeDoProjetoFromMixinTx(control, mixinTx.mixin, mixinTx.attributes)
      control.ctx.info('OnTechIssueChange: repoName', { repoName })
      if (repoName === undefined) continue

      const issues = await control.findAll(control.ctx, tracker.class.Issue, { _id: tx.objectId as Ref<Issue> })
      const issue = issues[0]
      if (issue === undefined) continue

      const projects = await control.findAll(control.ctx, tracker.class.Project, { _id: issue.space as Ref<Project> })
      const project = projects[0]
      control.ctx.info('OnTechIssueChange: TxMixin project', { identifier: project?.identifier })
      if (project?.identifier !== 'TECH_') continue

      const existing = await control.findAll(control.ctx, github.class.GithubBranchRequest, {
        issueId: tx.objectId as Ref<Issue>,
        action: 'create'
      })
      if (existing.length > 0) continue

      const tipo = getCustomFieldValue(control, issue, 'Tipo')
      if (tipo?.toLowerCase() === 'strategic') continue
      const branchName = buildBranchName(tipo, issue.title)
      control.ctx.info('OnTechIssueChange: creating GithubBranchRequest', { repo: repoName, branchName, issueId: tx.objectId })
      result.push(
        control.txFactory.createTxCreateDoc(github.class.GithubBranchRequest, issue.space, {
          issueId: tx.objectId as Ref<Issue>,
          repo: repoName,
          branchName,
          action: 'create',
          status: 'pending'
        })
      )
    }

    if (tx._class === core.class.TxRemoveDoc) {
      const requests = await control.findAll(control.ctx, github.class.GithubBranchRequest, {
        issueId: tx.objectId as Ref<Issue>,
        action: 'create',
        status: 'done'
      })
      if (requests.length === 0) continue

      const req = requests[0]
      result.push(
        control.txFactory.createTxCreateDoc(github.class.GithubBranchRequest, tx.objectSpace, {
          issueId: tx.objectId as Ref<Issue>,
          repo: req.repo,
          branchName: req.branchName,
          action: 'delete',
          status: 'pending'
        })
      )
    }
  }
  return result
}

/**
 * @public
 */
export async function OnTechIssueCompletionCheck (txes: TxCUD<Doc>[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    if (!control.hierarchy.isDerived(tx.objectClass, tracker.class.Issue)) continue

    const updateTx = tx as TxUpdateDoc<Issue>
    const newStatusId = updateTx.operations.status
    if (newStatusId == null) continue

    const [newStatus] = await control.findAll(control.ctx, tracker.class.IssueStatus, { _id: newStatusId }, { limit: 1 })
    if (newStatus == null || newStatus.category !== task.statusCategory.Won) continue

    // Fetch issue pre-tx state (status is still the previous value at this point)
    const [issue] = await control.findAll(control.ctx, tracker.class.Issue, { _id: tx.objectId as Ref<Issue> }, { limit: 1 })
    if (issue == null) continue
    const previousStatus = issue.status
    if (previousStatus === newStatusId) continue

    const [project] = await control.findAll(control.ctx, tracker.class.Project, { _id: issue.space as Ref<Project> }, { limit: 1 })
    if (project?.identifier !== 'TECH_') continue

    const branchRequests = await control.findAll(control.ctx, github.class.GithubBranchRequest, {
      issueId: tx.objectId as Ref<Issue>,
      action: 'create',
      status: 'done'
    })
    if (branchRequests.length === 0) continue
    if (branchRequests.some((r) => r.hasCommits === true)) continue

    control.ctx.warn('OnTechIssueCompletionCheck: blocking — branch has no commits', { issueId: tx.objectId })
    result.push(
      control.txFactory.createTxUpdateDoc<Issue>(
        tracker.class.Issue,
        tx.objectSpace,
        tx.objectId as Ref<Issue>,
        { status: previousStatus }
      )
    )
  }
  return result
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  trigger: {
    OnProjectChanges,
    OnProjectRemove,
    OnGithubBroadcast,
    OnTechIssueChange,
    OnTechIssueCompletionCheck
  },
  functions: {
    TodoDoneTester
  }
})

async function TodoDoneTester (
  client: {
    findAll: Storage['findAll']
    hierarchy: Hierarchy
  },
  todo: ToDo
): Promise<boolean> {
  if (client.hierarchy.hasMixin(todo, github.mixin.GithubTodo)) {
    return false
  }
  return true
}

async function updateDocSyncInfo (
  control: TriggerControl,
  tx: Tx,
  space: Ref<Space>,
  cud: {
    _class: Ref<Class<Tx>>
    objectId: Ref<Doc>
    objectClass: Ref<Class<Doc>>
  },
  cache: Map<string, any>,
  toApply: Tx[]
): Promise<void> {
  const checkTx = (tx: Tx): boolean =>
    control.hierarchy.isDerived(tx._class, core.class.TxCUD) &&
    (tx as TxCUD<Doc>).objectClass === github.class.DocSyncInfo &&
    (tx as TxCUD<Doc>).objectId === cud.objectId
  const txes = [...control.txes, ...control.ctx.contextData.broadcast.txes, ...toApply]
  // Check already captured Txes
  for (const i of txes) {
    if (checkTx(i)) {
      // We have sync doc create request already.
      return
    }
  }
  // Do not modify state if is modified by github service.
  if (tx.modifiedBy === systemAccount.primarySocialId) {
    return
  }
  const projects =
    (cache.get('projects') as GithubProject[]) ??
    (await control.queryFind(control.ctx, github.mixin.GithubProject, {}, { projection: { _id: 1 } }))
  cache.set('projects', projects)
  if (projects.some((it) => it._id === (space as Ref<GithubProject>))) {
    const sdoc =
      (cache.get(cud.objectId) as DocSyncInfo) ??
      (
        await control.findAll(control.ctx, github.class.DocSyncInfo, {
          _id: cud.objectId as Ref<DocSyncInfo>
        })
      ).shift()
    // We need to check if sync doc is already exists.
    if (sdoc === undefined) {
      // Created by non github integration
      // We need to create the doc sync info
      createSyncDoc(control, cud, tx, space, toApply)
    } else {
      cache.set(cud.objectId, sdoc)
      // We need to create the doc sync info
      updateSyncDoc(control, cud, space, sdoc, toApply)
    }
  }
}

function isDocSyncUpdateRequired (h: Hierarchy, coll: TxCUD<Doc>): boolean {
  return (
    h.isDerived(coll.objectClass, tracker.class.Issue) ||
    h.isDerived(coll.objectClass, chunter.class.ChatMessage) ||
    h.isDerived(coll.objectClass, github.class.GithubReviewComment) ||
    h.isDerived(coll.objectClass, github.class.GithubReview) ||
    h.isDerived(coll.objectClass, github.class.GithubReviewThread) ||
    h.isDerived(coll.objectClass, tracker.class.Milestone)
  )
}

function updateSyncDoc (
  control: TriggerControl,
  cud: {
    _class: Ref<Class<Tx>>
    objectId: Ref<Doc>
    objectClass: Ref<Class<Doc>>
  },
  space: Ref<Space>,
  info: DocSyncInfo,
  toApply: Tx[]
): void {
  const data: DocumentUpdate<DocSyncInfo> =
    cud._class === core.class.TxRemoveDoc
      ? {
          needSync: '',
          deleted: true
        }
      : {
          needSync: ''
        }
  if (info.space !== space) {
    data.externalVersion = '#' // We need to put this one to handle new documents.)
    data.space = space
  }
  toApply.push(
    control.txFactory.createTxUpdateDoc<DocSyncInfo>(
      github.class.DocSyncInfo,
      info.space,
      cud.objectId as Ref<DocSyncInfo>,
      data
    )
  )
}

function createSyncDoc (
  control: TriggerControl,
  cud: {
    _class: Ref<Class<Tx>>
    objectId: Ref<Doc>
    objectClass: Ref<Class<Doc>>
  },
  tx: Tx,
  space: Ref<Space>,
  toApply: Tx[]
): void {
  const data: DocumentUpdate<DocSyncInfo> = {
    url: '',
    githubNumber: 0,
    repository: null,
    objectClass: cud.objectClass,
    externalVersion: '#', // We need to put this one to handle new documents.
    needSync: '',
    derivedVersion: ''
  }
  if ((tx as TxCUD<Doc>).attachedTo !== undefined) {
    // Collection CUD, we could assign attachedTo
    data.attachedTo = (tx as TxCUD<Doc>).attachedTo
  }

  toApply.push(
    control.txFactory.createTxCreateDoc<DocSyncInfo>(
      github.class.DocSyncInfo,
      space,
      data,
      cud.objectId as Ref<DocSyncInfo>
    )
  )
}
