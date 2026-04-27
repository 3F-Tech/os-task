import { AccountRole, type Domain, IndexKind, type Ref, type Space } from '@hcengineering/core'
import {
  ArrOf,
  Index,
  Mixin,
  Model,
  Prop,
  TypeNumber,
  TypeRef,
  TypeString,
  type Builder
} from '@hcengineering/model'
import contact, { TEmployee } from '@hcengineering/model-contact'
import core, { TDoc } from '@hcengineering/model-core'
import setting from '@hcengineering/setting'
import tagSharing, { type SpaceTagAccess, type TaggedProfile, type UserTag } from '@hcengineering/tag-sharing'

export const DOMAIN_TAG_SHARING = 'tag-sharing' as Domain

@Model(tagSharing.class.UserTag, core.class.Doc, DOMAIN_TAG_SHARING)
export class TUserTag extends TDoc implements UserTag {
  @Prop(TypeString(), tagSharing.string.TagTitle)
  @Index(IndexKind.FullText)
    title!: string

  @Prop(TypeString(), tagSharing.string.TagDescription)
    description?: string

  @Prop(TypeNumber(), tagSharing.string.TagColor)
    color!: number
}

@Model(tagSharing.class.SpaceTagAccess, core.class.Doc, DOMAIN_TAG_SHARING)
export class TSpaceTagAccess extends TDoc implements SpaceTagAccess {
  @Prop(TypeRef(core.class.Space), tagSharing.string.TagSharing)
  @Index(IndexKind.Indexed)
  declare space: Ref<Space>

  @Prop(TypeRef(tagSharing.class.UserTag), tagSharing.string.UserTag)
  @Index(IndexKind.Indexed)
    tag!: Ref<UserTag>
}

@Mixin(tagSharing.mixin.TaggedProfile, contact.mixin.Employee)
export class TTaggedProfile extends TEmployee implements TaggedProfile {
  @Prop(ArrOf(TypeRef(tagSharing.class.UserTag)), tagSharing.string.UserTags)
    userTags!: Ref<UserTag>[]
}

export function createModel (builder: Builder): void {
  builder.createModel(TUserTag, TSpaceTagAccess, TTaggedProfile)

  builder.createDoc(setting.class.WorkspaceSettingCategory, core.space.Model, {
    name: 'userTags',
    label: tagSharing.string.UserTags,
    icon: tagSharing.icon.TagSharing,
    component: tagSharing.component.UserTagsPanel,
    group: 'settings-editor',
    role: AccountRole.Maintainer,
    order: 5100
  })
}

export { tagSharingId } from '@hcengineering/tag-sharing'
export * from './migration'
