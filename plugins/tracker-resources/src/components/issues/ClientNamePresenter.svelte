<script lang="ts">
  import { type Issue } from '@hcengineering/tracker'
  import { tooltip } from '@hcengineering/ui'

  export let value: Issue
</script>

{#if value.clientName}
  <span class="client-name" use:tooltip={{ label: undefined, title: value.clientName }}>
    {value.clientName}
  </span>
{/if}

<style lang="scss">
  .client-name {
    flex-shrink: 0;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--theme-caption-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }
</style>
