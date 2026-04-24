import { mergeIds } from '@hcengineering/platform'
import tagSharing, { tagSharingId } from '@hcengineering/tag-sharing'
import { type AnyComponent } from '@hcengineering/ui/src/types'

export default mergeIds(tagSharingId, tagSharing, {
  component: {
    UserTagsPanel: '' as AnyComponent,
    EditUserTag: '' as AnyComponent,
    UserTagSelector: '' as AnyComponent,
    UserTagPresenter: '' as AnyComponent,
    UserTagsEditor: '' as AnyComponent,
    SpaceTagAccessEditor: '' as AnyComponent
  }
})
