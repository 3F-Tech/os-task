<script lang="ts">
  import { Issue } from '@hcengineering/tracker'
  import { DocReferencePresenter } from '@hcengineering/view-resources'

  export let value: Issue
</script>

<DocReferencePresenter {value} overrideLabel={value.clientName} on:click>
  <slot />
</DocReferencePresenter>
