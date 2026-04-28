<!--
  Modal for creating or editing a UserTag (title, description, color).
-->
<script lang="ts">
  import core, { type Data } from '@hcengineering/core'
  import { Card, getClient } from '@hcengineering/presentation'
  import { type UserTag } from '@hcengineering/tag-sharing'
  import {
    EditBox,
    eventToHTMLElement,
    getPlatformColorDef,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import { ColorsPopup } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import tagSharing from '../plugin'

  export let value: UserTag | undefined = undefined

  const dispatch = createEventDispatcher()
  const client = getClient()

  const isNew = value === undefined

  let title = value?.title ?? ''
  let description = value?.description ?? ''
  let color = value?.color ?? Math.floor(Math.random() * 14)

  $: colorDef = getPlatformColorDef(color, $themeStore.dark)

  async function save (): Promise<void> {
    if (isNew) {
      await client.createDoc(tagSharing.class.UserTag, core.space.Workspace, {
        title: title.trim(),
        description: description.trim() || undefined,
        color
      } as Data<UserTag>)
    } else if (value !== undefined) {
      const upd: Partial<Data<UserTag>> = {}
      if (title.trim() !== value.title) upd.title = title.trim()
      if (description.trim() !== (value.description ?? '')) upd.description = description.trim() || undefined
      if (color !== value.color) upd.color = color
      if (Object.keys(upd).length > 0) await client.update(value, upd)
    }
    dispatch('close')
  }

  function pickColor (evt: MouseEvent): void {
    showPopup(
      ColorsPopup,
      { selected: colorDef.name },
      eventToHTMLElement(evt),
      (col: number | undefined) => { if (col != null) color = col }
    )
  }
</script>

<Card
  label={isNew ? tagSharing.string.NewTag : tagSharing.string.EditTag}
  okAction={save}
  canSave={title.trim().length > 0}
  on:close={() => dispatch('close')}
  on:changeContent
>
  <div class="flex-row-top clear-mins">
    <button
      class="color-swatch mr-3 flex-no-shrink"
      style="background-color: {colorDef.color};"
      on:click={pickColor}
    />
    <div class="flex-grow">
      <EditBox
        placeholder={tagSharing.string.TagTitlePlaceholder}
        bind:value={title}
        kind="large-style"
        autoFocus
      />
      <div class="mt-2">
        <EditBox
          placeholder={tagSharing.string.TagDescriptionPlaceholder}
          bind:value={description}
        />
      </div>
    </div>
  </div>
</Card>

<style lang="scss">
  .color-swatch {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.375rem;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    margin-top: 0.25rem;

    &:hover {
      opacity: 0.8;
    }
  }
</style>
