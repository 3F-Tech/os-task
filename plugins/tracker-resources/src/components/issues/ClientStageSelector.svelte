<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { ClientStage } from '@hcengineering/tracker'

  export let value: ClientStage
  export let kind: 'regular' | 'large' = 'regular'
  export let size: 'small' | 'large' = 'large'
  export let disabled: boolean = false

  const dispatch = createEventDispatcher()

  const options = [
    { id: ClientStage.Onboarding, label: 'Onboarding', color: '#3b82f6' }, // Blue
    { id: ClientStage.Expansion, label: 'Expansão', color: '#10b981' },   // Green
    { id: ClientStage.Retention, label: 'Retenção', color: '#f59e0b' },   // Yellow
    { id: ClientStage.Churned, label: 'Churned', color: '#ef4444' }       // Red
  ]
</script>

<div class="client-stage-selector">
  <select
    {disabled}
    bind:value
    on:change={() => dispatch('change', value)}
    class="stage-select {kind} {size}"
    style="--stage-color: {options.find(o => o.id === value)?.color}"
  >
    {#each options as option}
      <option value={option.id}>{option.label}</option>
    {/each}
  </select>
</div>

<style lang="scss">
  .stage-select {
    appearance: none;
    background: var(--theme-box-background);
    border: 1px solid var(--theme-border-color);
    border-radius: var(--theme-border-radius);
    padding: 0.5rem 1rem;
    cursor: pointer;
    color: var(--stage-color);
    font-weight: 600;
    width: 100%;

    &.large {
        padding: 0.75rem 1.25rem;
    }

    &:focus {
        outline: none;
        border-color: var(--stage-color);
    }
  }
</style>
