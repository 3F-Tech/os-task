<!--
  Admin panel listing all UserTags workspace-wide with create / edit / delete actions.
-->
<script lang="ts">
  import { createQuery, getClient, MessageBox } from '@hcengineering/presentation'
  import { type UserTag } from '@hcengineering/tag-sharing'
  import {
    Button,
    eventToHTMLElement,
    getPlatformColorDef,
    IconAdd,
    Label,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import tagSharing from '../plugin'
  import EditUserTag from './EditUserTag.svelte'

  const client = getClient()

  let tags: UserTag[] = []
  const query = createQuery()
  query.query(tagSharing.class.UserTag, {}, (res) => { tags = res }, { sort: { title: 1 } })

  function openCreate (evt: MouseEvent): void {
    showPopup(EditUserTag, {}, eventToHTMLElement(evt))
  }

  function openEdit (evt: MouseEvent, tag: UserTag): void {
    showPopup(EditUserTag, { value: tag }, eventToHTMLElement(evt))
  }

  function confirmDelete (tag: UserTag): void {
    showPopup(
      MessageBox,
      {
        label: tagSharing.string.DeleteTag,
        message: tagSharing.string.DeleteTagConfirm
      },
      undefined,
      async (result: boolean) => {
        if (result === true) {
          await client.removeDoc(tagSharing.class.UserTag, tag.space, tag._id)
        }
      }
    )
  }
</script>

<div class="panel-container">
  <div class="panel-header">
    <span class="panel-title"><Label label={tagSharing.string.UserTags} /></span>
    <Button icon={IconAdd} label={tagSharing.string.NewTag} kind="primary" size="small" on:click={openCreate} />
  </div>

  {#if tags.length === 0}
    <div class="empty-state">
      <Label label={tagSharing.string.NoTags} />
    </div>
  {:else}
    <div class="tag-list">
      {#each tags as tag (tag._id)}
        {@const colorDef = getPlatformColorDef(tag.color, $themeStore.dark)}
        <div class="tag-row">
          <span
            class="tag-color"
            style="background-color: {colorDef.color};"
          />
          <span class="tag-title">{tag.title}</span>
          {#if tag.description}
            <span class="tag-desc">{tag.description}</span>
          {/if}
          <div class="actions">
            <Button
              label={tagSharing.string.EditTag}
              kind="ghost"
              size="small"
              on:click={(e) => openEdit(e, tag)}
            />
            <Button
              label={tagSharing.string.DeleteTag}
              kind="ghost"
              size="small"
              on:click={() => confirmDelete(tag)}
            />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .panel-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .panel-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--theme-content-accent-color);
  }

  .tag-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tag-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    background-color: var(--theme-button-default);

    &:hover {
      background-color: var(--theme-button-hovered);
    }
  }

  .tag-color {
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tag-title {
    font-size: 0.875rem;
    font-weight: 500;
    flex-shrink: 0;
  }

  .tag-desc {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
    flex-shrink: 0;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
    color: var(--theme-dark-color);
  }
</style>
