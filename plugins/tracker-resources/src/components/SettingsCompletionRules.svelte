<!--
// Copyright © 2024 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import { type Space } from '@hcengineering/core'
  import { Breadcrumb, Header } from '@hcengineering/ui'
  import tracker from '../plugin'
  import EditCompletionRules from './EditCompletionRules.svelte'

  export let value: Space | undefined
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={tracker.icon.Issues} label={tracker.string.CompletionRules} size={'large'} isCurrent />
  </Header>
  <EditCompletionRules {value} />
</div>
