<!--
// Copyright © 2024 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import { Label, Button } from '@hcengineering/ui'
  import type { IntlString } from '@hcengineering/platform'
  import tracker from '../../plugin'
  import { createEventDispatcher } from 'svelte'

  export let violations: { labelId: string, params?: Record<string, any> }[] = []
  export let isSubIssue: boolean = false

  const dispatch = createEventDispatcher()
  const closeLabel = 'Close' as unknown as IntlString

  function close (): void {
    dispatch('close')
  }
</script>

<div class="popup">
  <div class="popup-header">
    <span class="title">
      <Label label={tracker.string.CompletionBlocked} />
    </span>
  </div>

  <div class="popup-body">
    <p class="description">
      {#if isSubIssue}
        <Label label={tracker.string.CompletionBlockedSubtask} />
      {:else}
        <Label label={tracker.string.CompletionBlockedTask} />
      {/if}
    </p>

    <ul class="violations-list">
      {#each violations as v}
        <li class="violation-item">
          <span class="violation-dot" />
          <!-- svelte-ignore a11y-label-has-associated-control -->
          <Label label={v.labelId} params={v.params} />
        </li>
      {/each}
    </ul>
  </div>

  <div class="popup-footer">
    <Button label={tracker.string.ConfigureCompletionRules} kind={'ghost'} size={'medium'} on:click={close} />
    <Button label={closeLabel} kind={'primary'} size={'medium'} on:click={close} />
  </div>
</div>

<style lang="scss">
  .popup {
    display: flex;
    flex-direction: column;
    min-width: 20rem;
    max-width: 28rem;
    padding: 1rem 1.25rem;
    gap: 0.75rem;
  }

  .popup-header {
    .title {
      font-weight: 600;
      font-size: 1rem;
      color: var(--theme-caption-color);
    }
  }

  .popup-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    .description {
      margin: 0;
      font-size: 0.875rem;
      color: var(--theme-content-color);
    }
  }

  .violations-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .violation-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--theme-caption-color);

    .violation-dot {
      width: 0.375rem;
      height: 0.375rem;
      border-radius: 50%;
      background-color: var(--theme-warning-color);
      flex-shrink: 0;
    }
  }

  .popup-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
</style>
