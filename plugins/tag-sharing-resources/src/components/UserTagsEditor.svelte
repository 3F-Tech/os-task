<!--
  Inline editor shown on a user's profile to assign/remove UserTags.
  Reads and writes the TaggedProfile mixin on the Employee.
-->
<script lang="ts">
  import { type Employee } from '@hcengineering/contact'
  import { type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { type TaggedProfile, type UserTag } from '@hcengineering/tag-sharing'
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

  export let employee: Employee
  export let readonly: boolean = false

  const client = getClient()
  const hierarchy = client.getHierarchy()

  let tags: UserTag[] = []
  let selectedRefs: Ref<UserTag>[] = []

  $: if (hierarchy.hasMixin(employee, tagSharing.mixin.TaggedProfile)) {
    const mixed = hierarchy.as(employee, tagSharing.mixin.TaggedProfile) as TaggedProfile
    selectedRefs = mixed.userTags ?? []
  } else {
    selectedRefs = []
  }

  const tagQuery = createQuery()
  $: tagQuery.query(
    tagSharing.class.UserTag,
    { _id: { $in: selectedRefs } },
    (res) => { tags = res }
  )

  async function removeTag (tagId: Ref<UserTag>): Promise<void> {
    const next = selectedRefs.filter(r => r !== tagId)
    await client.updateMixin(employee._id, employee._class, employee.space, tagSharing.mixin.TaggedProfile, {
      userTags: next
    })
  }

  function openSelector (evt: MouseEvent): void {
    showPopup(
      UserTagSelector,
      { selected: [...selectedRefs] },
      evt.target as HTMLElement,
      async (result: Ref<UserTag>[] | undefined) => {
        if (result === undefined) return
        await client.updateMixin(employee._id, employee._class, employee.space, tagSharing.mixin.TaggedProfile, {
          userTags: result
        })
      }
    )
  }
</script>

<div class="user-tags-editor">
  <div class="tags-row">
    {#each tags as tag (tag._id)}
      {@const colorDef = getPlatformColorDef(tag.color, $themeStore.dark)}
      <span
        class="tag-badge"
        style="background-color: {colorDef.background ?? colorDef.color}; color: {colorDef.title ?? '#fff'};"
      >
        {tag.title}
        {#if !readonly}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <span class="remove-btn" on:click={() => removeTag(tag._id)}>×</span>
        {/if}
      </span>
    {/each}
    {#if tags.length === 0}
      <span class="no-tags"><Label label={tagSharing.string.NoTags} /></span>
    {/if}
  </div>
  {#if !readonly}
    <Button icon={IconAdd} kind="ghost" size="small" on:click={openSelector} />
  {/if}
</div>

<style lang="scss">
  .user-tags-editor {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .tags-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    align-items: center;
  }

  .tag-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.375rem;
    border-radius: 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    gap: 0.25rem;
  }

  .remove-btn {
    cursor: pointer;
    opacity: 0.7;
    line-height: 1;

    &:hover {
      opacity: 1;
    }
  }

  .no-tags {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
</style>
