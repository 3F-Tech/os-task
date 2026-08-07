<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { ClientStage } from '@hcengineering/tracker'
  import { Button, SelectPopup, eventToHTMLElement, showPopup, ButtonKind, ButtonSize } from '@hcengineering/ui'

  export let value: ClientStage
  export let kind: ButtonKind = 'link-bordered'
  export let size: ButtonSize = 'medium'
  export let disabled: boolean = false

  const dispatch = createEventDispatcher()

  const options = [
    { id: ClientStage.Onboarding, label: 'Onboarding', color: '#3b82f6' },
    { id: ClientStage.Expansion, label: 'Expansão', color: '#10b981' },
    { id: ClientStage.Retention, label: 'Retenção', color: '#f59e0b' },
    { id: ClientStage.Churned, label: 'Churned', color: '#ef4444' }
  ]

  $: current = options.find((o) => o.id === value) ?? options[0]

  function openPopup (event: MouseEvent): void {
    if (disabled) return
    // SelectPopup: `text` é string crua; `label` é IntlString (id p/ traduzir).
    // Usar `text` evita o erro "Invalid Id: <etapa>" ao tentar traduzir o rótulo.
    const items = options.map((o) => ({
      id: o.id,
      text: o.label,
      isSelected: o.id === value
    }))
    showPopup(SelectPopup, { value: items }, eventToHTMLElement(event), (selected: ClientStage | undefined) => {
      if (selected !== undefined && selected !== value) {
        value = selected
        dispatch('change', selected)
      }
    })
  }
</script>

<Button
  {kind}
  {size}
  disabled={disabled}
  width={'100%'}
  justify={'left'}
  on:click={openPopup}
>
  <svelte:fragment slot="content">
    <span class="stage-badge" style:background-color={current.color}>
      {current.label}
    </span>
  </svelte:fragment>
</Button>

<style lang="scss">
  .stage-badge {
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
