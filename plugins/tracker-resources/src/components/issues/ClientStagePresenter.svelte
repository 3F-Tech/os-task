<script lang="ts">
  import { ClientStage, type Issue } from '@hcengineering/tracker'

  export let value: Issue

  const options = {
    [ClientStage.Onboarding]: { label: 'Onboarding', color: '#3b82f6' },
    [ClientStage.Expansion]: { label: 'Expansão', color: '#10b981' },
    [ClientStage.Retention]: { label: 'Retenção', color: '#f59e0b' },
    [ClientStage.Churned]: { label: 'Churned', color: '#ef4444' }
  }

  $: stage = value.clientStage ?? ClientStage.Onboarding
  $: option = options[stage]
</script>

<div class="stage-container">
  {#if option}
    <span class="stage-badge" style:background-color={option.color}>
      {option.label}
    </span>
  {/if}
</div>

<style lang="scss">
  .stage-container {
    width: 100%;
    display: flex;
    align-items: center;
  }

  .stage-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 11px;
    white-space: nowrap;
  }
</style>
