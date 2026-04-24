<!--
  Section in a Space's settings that lets owners manage which UserTags give access to this Space.
-->
<script lang="ts">
  import { type Ref, type Space } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { type SpaceTagAccess, type UserTag } from '@hcengineering/tag-sharing'
  import {
    Button,
    getPlatformColorDef,
    IconAdd,
    Label,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import tagSharing from '../plugin'
  import UserTagSelector from './UserTagSelector.svelte'

  export let space: Space
  export let readonly: boolean = false

  const client = getClient()

  let accessDocs: SpaceTagAccess[] = []
  let accessTags: UserTag[] = []

  const accessQuery = createQuery()
  $: accessQuery.query(
    tagSharing.class.SpaceTagAccess,
    { space: space._id },
    (res) => { accessDocs = res }
  )

  $: assignedTagIds = accessDocs.map(d => d.tag)

  const tagQuery = createQuery()
  $: tagQuery.query(
    tagSharing.class.UserTag,
    { _id: { $in: assignedTagIds } },
    (res) => { accessTags = res }
  )

  async function removeAccess (tagId: Ref<UserTag>): Promise<void> {
    const doc = accessDocs.find(d => d.tag === tagId)
    if (doc !== undefined) {
      await client.removeDoc(tagSharing.class.SpaceTagAccess, doc.space, doc._id)
    }
  }

  function openSelector (evt: MouseEvent): void {
    showPopup(
      UserTagSelector,
      { selected: [...assignedTagIds] },
      evt.target as HTMLElement,
      async (result: Ref<UserTag>[] | undefined) => {
        if (result === undefined) return
        const toAdd = result.filter(r => !assignedTagIds.includes(r))
        const toRemove = assignedTagIds.filter(r => !result.includes(r))
        for (const tagId of toAdd) {
          await client.createDoc(tagSharing.class.SpaceTagAccess, space._id as unknown as Ref<any>, {
            space: space._id,
            tag: tagId
          })
        }
        for (const tagId of toRemove) {
          await removeAccess(tagId)
        }
      }
    )
  }
</script>

<div class="space-tag-access">
  <div class="section-header">
    <span class="section-title"><Label label={tagSharing.string.TagsWithAccess} /></span>
    {#if !readonly}
      <Button icon={IconAdd} kind="ghost" size="small" on:click={openSelector} />
    {/if}
  </div>
  <div class="tags-row">
    {#if accessTags.length === 0}
      <span class="empty"><Label label={tagSharing.string.NoTags} /></span>
    {:else}
      {#each accessTags as tag (tag._id)}
        {@const colorDef = getPlatformColorDef(tag.color, $themeStore.dark)}
        <span
          class="tag-badge"
          style="background-color: {colorDef.background ?? colorDef.color}; color: {colorDef.title ?? '#fff'};"
        >
          {tag.title}
          {#if !readonly}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <span class="remove-btn" on:click={() => removeAccess(tag._id)}>×</span>
          {/if}
        </span>
      {/each}
    {/if}
  </div>
</div>

<style lang="scss">
  .space-tag-access {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--theme-content-accent-color);
  }

  .tags-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .tag-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    gap: 0.25rem;
  }

  .remove-btn {
    cursor: pointer;
    opacity: 0.7;

    &:hover {
      opacity: 1;
    }
  }

  .empty {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
</style>
