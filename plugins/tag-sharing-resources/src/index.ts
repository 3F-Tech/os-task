import { type Resources } from '@hcengineering/platform'
import EditUserTag from './components/EditUserTag.svelte'
import SpaceTagAccessEditor from './components/SpaceTagAccessEditor.svelte'
import UserTagPresenter from './components/UserTagPresenter.svelte'
import UserTagSelector from './components/UserTagSelector.svelte'
import UserTagsEditor from './components/UserTagsEditor.svelte'
import UserTagsPanel from './components/UserTagsPanel.svelte'

export { default as UserTagPresenter } from './components/UserTagPresenter.svelte'
export { default as UserTagsEditor } from './components/UserTagsEditor.svelte'
export { default as SpaceTagAccessEditor } from './components/SpaceTagAccessEditor.svelte'

export default async (): Promise<Resources> => ({
  component: {
    UserTagsPanel,
    EditUserTag,
    UserTagSelector,
    UserTagPresenter,
    UserTagsEditor,
    SpaceTagAccessEditor
  }
})
