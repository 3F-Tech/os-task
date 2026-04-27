import { type Class, type Doc, type Mixin, type Ref, type Space } from '@hcengineering/core'
import type { Asset, IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import { type AnyComponent } from '@hcengineering/ui'

export interface UserTag extends Doc {
  title: string
  description?: string
  color: number
}

export interface SpaceTagAccess extends Doc {
  space: Ref<Space>
  tag: Ref<UserTag>
}

export interface TaggedProfile extends Doc {
  userTags: Ref<UserTag>[]
}

export const tagSharingId = 'tag-sharing' as Plugin

export default plugin(tagSharingId, {
  class: {
    UserTag: '' as Ref<Class<UserTag>>,
    SpaceTagAccess: '' as Ref<Class<SpaceTagAccess>>
  },
  mixin: {
    TaggedProfile: '' as Ref<Mixin<TaggedProfile>>
  },
  icon: {
    UserTag: '' as Asset,
    TagSharing: '' as Asset
  },
  component: {
    UserTagsPanel: '' as AnyComponent,
    EditUserTag: '' as AnyComponent,
    UserTagSelector: '' as AnyComponent,
    UserTagPresenter: '' as AnyComponent,
    UserTagsEditor: '' as AnyComponent,
    SpaceTagAccessEditor: '' as AnyComponent
  },
  string: {
    UserTag: '' as IntlString,
    UserTags: '' as IntlString,
    TagSharing: '' as IntlString,
    AddTag: '' as IntlString,
    RemoveTag: '' as IntlString,
    TagTitle: '' as IntlString,
    TagDescription: '' as IntlString,
    TagColor: '' as IntlString,
    TagMembers: '' as IntlString,
    NewTag: '' as IntlString,
    EditTag: '' as IntlString,
    DeleteTag: '' as IntlString,
    DeleteTagConfirm: '' as IntlString,
    NoTags: '' as IntlString,
    TagsWithAccess: '' as IntlString,
    AssignTag: '' as IntlString,
    TagTitlePlaceholder: '' as IntlString,
    TagDescriptionPlaceholder: '' as IntlString
  }
})
