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

{#if option}
  <span style="color: white; background-color: {option.color}; padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 11px;">
    {option.label}
  </span>
{/if}
