import type { AccountUuid, Ref, Space, Tx, TxCreateDoc, TxMixin, TxRemoveDoc } from '@hcengineering/core'
import core from '@hcengineering/core'
import type { Employee } from '@hcengineering/contact'
import type { TriggerControl } from '@hcengineering/server-core'
import type { SpaceTagAccess, TaggedProfile, UserTag } from '@hcengineering/tag-sharing'
import tagSharing from '@hcengineering/tag-sharing'

/**
 * Resolves all AccountUuids that have a given tag via TaggedProfile mixin.
 */
async function getAccountsWithTag (tag: Ref<UserTag>, control: TriggerControl): Promise<AccountUuid[]> {
  const profiles = await control.findAll(control.ctx, tagSharing.mixin.TaggedProfile, { userTags: tag })
  return profiles
    .filter((p): p is typeof p & { personUuid: AccountUuid } => (p as any).personUuid !== undefined)
    .map((p) => (p as any).personUuid as AccountUuid)
}

/**
 * Resolves all Spaces that grant access to a given tag via SpaceTagAccess.
 */
async function getSpacesWithTag (tag: Ref<UserTag>, control: TriggerControl): Promise<Space[]> {
  const accesses = await control.findAll(control.ctx, tagSharing.class.SpaceTagAccess, { tag })
  if (accesses.length === 0) return []
  const spaceIds = accesses.map((a) => a.space)
  return await control.findAll(control.ctx, core.class.Space, { _id: { $in: spaceIds } })
}

/**
 * Checks if an account still has tag-based access to a space (via any remaining tag).
 */
async function hasTagAccess (
  account: AccountUuid,
  space: Space,
  control: TriggerControl
): Promise<boolean> {
  const accesses = await control.findAll(control.ctx, tagSharing.class.SpaceTagAccess, { space: space._id })
  for (const access of accesses) {
    const profiles = await control.findAll(control.ctx, tagSharing.mixin.TaggedProfile, {
      userTags: access.tag
    })
    for (const p of profiles) {
      if ((p as any).personUuid === account) return true
    }
  }
  return false
}

/**
 * Extracts AccountUuid for the employee referenced by a TxMixin on TaggedProfile.
 * Bug 1 fix: objectId is the Employee _id, not the AccountUuid — must load doc and read personUuid.
 */
async function resolveAccountUuid (
  mixinTx: TxMixin<Employee, TaggedProfile>,
  control: TriggerControl
): Promise<AccountUuid | undefined> {
  const profiles = await control.findAll(control.ctx, tagSharing.mixin.TaggedProfile, {
    _id: mixinTx.objectId as Ref<any>
  })
  const profile = profiles[0]
  if (profile === undefined) return undefined
  return (profile as any).personUuid as AccountUuid | undefined
}

/**
 * Trigger: fired when TaggedProfile mixin changes (updateMixin call).
 *
 * Supports two update shapes (Bug 2 fix):
 *   1. Atomic ops — attributes.$push.userTags or attributes.$pull.userTags
 *   2. Full array set — attributes.userTags is a new array; reconcile via diff against all spaces
 */
export async function OnTagAssignmentChanged (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []

  for (const tx of txes) {
    if (tx._class !== core.class.TxMixin) continue
    const mixinTx = tx as TxMixin<Employee, TaggedProfile>

    // Bug 1 fix: load Employee doc to extract personUuid
    const account = await resolveAccountUuid(mixinTx, control)
    if (account === undefined) continue

    const attrs = mixinTx.attributes as any

    // Case 1: atomic $push — one tag was added
    const pushedTag = attrs.$push?.userTags as Ref<UserTag> | undefined
    if (pushedTag !== undefined) {
      const spaces = await getSpacesWithTag(pushedTag, control)
      for (const space of spaces) {
        if (!space.members.includes(account)) {
          result.push(
            control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, {
              $push: { members: account }
            })
          )
        }
      }
    }

    // Case 1b: atomic $pull — one tag was removed
    const pulledTag = attrs.$pull?.userTags as Ref<UserTag> | undefined
    if (pulledTag !== undefined) {
      const spaces = await getSpacesWithTag(pulledTag, control)
      for (const space of spaces) {
        if (space.members.includes(account)) {
          const stillHasTagAccess = await hasTagAccess(account, space, control)
          if (!stillHasTagAccess) {
            result.push(
              control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, {
                $pull: { members: account }
              })
            )
          }
        }
      }
    }

    // Case 2: full array set — UI sends entire new array, no $push/$pull
    // Bug 2 fix: reconcile access for ALL spaces based on the new tag set
    const newTagsRaw = attrs.userTags
    if (pushedTag === undefined && pulledTag === undefined && Array.isArray(newTagsRaw)) {
      const newTags = newTagsRaw as Ref<UserTag>[]

      // Load every SpaceTagAccess and group by space
      const allAccesses = await control.findAll(control.ctx, tagSharing.class.SpaceTagAccess, {})
      const spaceIds = [...new Set(allAccesses.map((a) => a.space))]
      if (spaceIds.length === 0) continue

      const spaces = await control.findAll(control.ctx, core.class.Space, { _id: { $in: spaceIds } })
      for (const space of spaces) {
        const spaceTags = allAccesses.filter((a) => a.space === space._id).map((a) => a.tag)
        const shouldHaveAccess = newTags.some((t) => spaceTags.includes(t))
        const hasAccess = space.members.includes(account)

        if (shouldHaveAccess && !hasAccess) {
          result.push(
            control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, {
              $push: { members: account }
            })
          )
        } else if (!shouldHaveAccess && hasAccess) {
          // Known limitation (Bug 3): if account had direct access + tag access, both are removed here.
          result.push(
            control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, {
              $pull: { members: account }
            })
          )
        }
      }
    }
  }

  return result
}

/**
 * Trigger: fired when SpaceTagAccess is created or removed.
 * Adds/removes all accounts with that tag from Space.members.
 */
export async function OnSpaceTagAccessChanged (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []

  for (const tx of txes) {
    if (tx._class === core.class.TxCreateDoc) {
      const createTx = tx as TxCreateDoc<SpaceTagAccess>
      const { space: spaceId, tag } = createTx.attributes

      const spaces = await control.findAll(control.ctx, core.class.Space, { _id: spaceId })
      const space = spaces[0]
      if (space === undefined) continue

      const accounts = await getAccountsWithTag(tag, control)
      for (const account of accounts) {
        if (!space.members.includes(account)) {
          result.push(
            control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, {
              $push: { members: account }
            })
          )
        }
      }
    }

    if (tx._class === core.class.TxRemoveDoc) {
      const removeTx = tx as TxRemoveDoc<SpaceTagAccess>
      // Doc is already removed — read from the tx itself via a pre-remove snapshot
      // The server passes the doc state before deletion via findAll on the same tx batch
      const removedAccess = await control.findAll(control.ctx, tagSharing.class.SpaceTagAccess, {
        _id: removeTx.objectId
      })
      if (removedAccess.length === 0) continue
      const { space: spaceId, tag } = removedAccess[0]

      const spaces = await control.findAll(control.ctx, core.class.Space, { _id: spaceId })
      const space = spaces[0]
      if (space === undefined) continue

      const accounts = await getAccountsWithTag(tag, control)
      for (const account of accounts) {
        if (space.members.includes(account)) {
          const stillHasAccess = await hasTagAccess(account, space, control)
          if (!stillHasAccess) {
            result.push(
              control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, {
                $pull: { members: account }
              })
            )
          }
        }
      }
    }
  }

  return result
}

export default async () => ({
  trigger: {
    OnTagAssignmentChanged,
    OnSpaceTagAccessChanged
  }
})
