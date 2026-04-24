<!--
  Renders a single UserTag as a colored badge with its title.
-->
<script lang="ts">
  import { getPlatformColorDef, themeStore } from '@hcengineering/ui'
  import { type UserTag } from '@hcengineering/tag-sharing'

  export let value: UserTag | undefined = undefined
</script>

{#if value}
  {@const colorDef = getPlatformColorDef(value.color, $themeStore.dark)}
  <span
    class="user-tag-badge"
    style="background-color: {colorDef.background ?? colorDef.color}; color: {colorDef.title ?? '#fff'};"
  >
    {value.title}
  </span>
{/if}

<style lang="scss">
  .user-tag-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 10rem;
  }
</style>
