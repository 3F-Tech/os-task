import type { AccountUuid, Ref, Space, Tx, TxCreateDoc, TxRemoveDoc, TxUpdateDoc } from '@hcengineering/core'
import core from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import type { SpaceTagAccess, TaggedProfile, UserTag } from '@hcengineering/tag-sharing'
import tagSharing from '@hcengineering/tag-sharing'

/**
 * Resolves all AccountUuids that have a given tag via TaggedProfile mixin.
 */
async function getAccountsWithTag (tag: Ref<UserTag>, control: TriggerControl): Promise<AccountUuid[]> {
  const profiles = await control.findAll(control.ctx, tagSharing.mixin.TaggedProfile, { userTags: tag })
  return profiles
    .filter((p): p is typeof p & { personUuid: AccountUuid } => p.personUuid !== undefined)
    .map((p) => p.personUuid as AccountUuid)
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
      userTags: access.tag,
      personUuid: account
    })
    if (profiles.length > 0) return true
  }
  return false
}

/**
 * Trigger: fired when TaggedProfile.userTags changes ($push or $pull of a tag).
 * Updates Space.members for all spaces that grant access to the changed tag.
 */
export async function OnTagAssignmentChanged (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []

  for (const tx of txes) {
    const updateTx = tx as TxUpdateDoc<TaggedProfile>
    const account = updateTx.objectId as unknown as AccountUuid

    const pushedTag = updateTx.operations.$push?.userTags as Ref<UserTag> | undefined
    const pulledTag = updateTx.operations.$pull?.userTags as Ref<UserTag> | undefined

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

    if (pulledTag !== undefined) {
      const spaces = await getSpacesWithTag(pulledTag, control)
      for (const space of spaces) {
        if (space.members.includes(account)) {
          const stillHasAccess = await hasTagAccess(account, space, control)
          const hasDirectAccess = await control.findAll(control.ctx, core.class.Space, {
            _id: space._id,
            members: account
          })
          const directEntry = hasDirectAccess[0]?.members ?? []
          if (!stillHasAccess && directEntry.includes(account)) {
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
