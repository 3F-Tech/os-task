import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/core'
import tagSharing from '@hcengineering/tag-sharing'
import serverCore from '@hcengineering/server-core'
import serverTagSharing from '@hcengineering/server-tag-sharing'

export { serverTagSharingId } from '@hcengineering/server-tag-sharing'

export function createModel (builder: Builder): void {
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverTagSharing.trigger.OnTagAssignmentChanged,
    txMatch: {
      _class: core.class.TxMixin,
      mixin: tagSharing.mixin.TaggedProfile
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverTagSharing.trigger.OnSpaceTagAccessChanged,
    txMatch: {
      objectClass: tagSharing.class.SpaceTagAccess
    }
  })
}
