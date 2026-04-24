import type { Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import { type TriggerFunc } from '@hcengineering/server-core'

export const serverTagSharingId = 'server-tag-sharing' as Plugin

export default plugin(serverTagSharingId, {
  trigger: {
    OnTagAssignmentChanged: '' as Resource<TriggerFunc>,
    OnSpaceTagAccessChanged: '' as Resource<TriggerFunc>
  }
})
