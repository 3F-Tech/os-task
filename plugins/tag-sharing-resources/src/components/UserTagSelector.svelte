+<!--
  Popup for selecting one or multiple UserTags from the full list.
  Emits 'close' with the selected Ref<UserTag>[].
-->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { type UserTag } from '@hcengineering/tag-sharing'
  import {
    Button,
    EditBox,
    getPlatformColorDef,
    Label,
    themeStore
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import tagSharing from '../plugin'

  export let selected: Ref<UserTag>[] = []

  const dispatch = createEventDispatcher()

  let search = ''
  let allTags: UserTag[] = []
  const query = createQuery()
  query.query(tagSharing.class.UserTag, {}, (res) => { allTags = res }, { sort: { title: 1 } })

  $: filtered = search.trim().length > 0
    ? allTags.filter(t => t.title.toLowerCase().includes(search.trim().toLowerCase()))
    : allTags

  function toggle (id: Ref<UserTag>): void {
    if (selected.includes(id)) {
      selected = selected.filter(s => s !== id)
    } else {
      selected = [...selected, id]
    }
  }

  function confirm (): void {
    dispatch('close', selected)
  }
</script>

<div class="popup-container">
  <div class="p-2">
    <EditBox bind:value={search} placeholder={tagSharing.string.AssignTag} kind="search-style" />
  </div>
  <div class="tag-list">
    {#if filtered.length === 0}
      <div class="empty-state">
        <Label label={tagSharing.string.NoTags} />
      </div>
    {:else}
      {#each filtered as tag (tag._id)}
        {@const colorDef = getPlatformColorDef(tag.color, $themeStore.dark)}
        {@const isSelected = selected.includes(tag._id)}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="tag-item"
          class:selected={isSelected}
          on:click={() => toggle(tag._id)}
        >
          <span
            class="tag-dot"
            style="background-color: {colorDef.color};"
          />
          <span class="tag-title">{tag.title}</span>
          {#if isSelected}
            <span class="checkmark">✓</span>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
  <div class="footer p-2">
    <Button label={tagSharing.string.AddTag} kind="primary" size="small" on:click={confirm} />
  </div>
</div>

<style lang="scss">
  .popup-container {
    display: flex;
    flex-direction: column;
    min-width: 16rem;
    max-height: 24rem;
    background-color: var(--theme-panel-background-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    box-shadow: var(--theme-shadow-large);
    overflow: hidden;
  }

  .tag-list {
    overflow-y: auto;
    flex: 1;
    padding: 0.25rem 0;
  }

  .tag-item {
    display: flex;
    align-items: center;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border-radius: 0.375rem;
    margin: 0.125rem 0.5rem;
    gap: 0.75rem;
    transition: background-color 0.15s ease, transform 0.1s ease;

    &:hover {
      background-color: var(--theme-button-hovered);
      transform: translateX(2px);
    }

    &.selected {
      background-color: var(--theme-button-pressed);
      .tag-title {
        font-weight: 600;
        color: var(--theme-content-accent-color);
      }
    }
  }

  .tag-dot {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 2px var(--theme-divider-color);
  }

  .tag-title {
    flex: 1;
    font-size: 0.875rem;
    color: var(--theme-content-primary-color);
  }

  .checkmark {
    color: var(--theme-content-accent-color);
    font-size: 0.875rem;
    font-weight: bold;
  }

  .empty-state {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--theme-dark-color);
    font-size: 0.875rem;
  }

  .footer {
    border-top: 1px solid var(--theme-divider-color);
    display: flex;
    justify-content: flex-end;
    background-color: var(--theme-background-secondary-color);
  }
</style>
