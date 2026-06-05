<!--
// Copyright © 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { Button, ToggleWithLabel, tooltip } from '@hcengineering/ui'
  import { Viewlet } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import view from '../plugin'
  import { AttributeConfig, Config, isAttribute } from '../viewOptions'

  export let viewlet: Viewlet
  export let items: Array<Config | AttributeConfig> = []
  // 3F — Visível só quando o popup está em project scope e o usuário tem
  // core.permission.UpdateSpace no projeto. Disparado pelo pai (ViewletSetting).
  export let showSetAsProjectDefault: boolean = false

  const dispatch = createEventDispatcher()

  function dragEnd () {
    selected = undefined
    dispatch('save', items)
  }

  function dragOver (e: DragEvent, i: number) {
    e.preventDefault()
    e.stopPropagation()
    const s = selected as number
    if (dragswap(e, i, s)) {
      ;[items[i], items[s]] = [items[s], items[i]]
      selected = i
    }
  }

  const elements: HTMLElement[] = []

  function dragswap (ev: MouseEvent, i: number, s: number): boolean {
    if (i < s) {
      return ev.offsetY < elements[i].offsetHeight / 2
    } else if (i > s) {
      return ev.offsetY > elements[i].offsetHeight / 2
    }
    return false
  }

  function change (item: Config, value: boolean): void {
    if (isAttribute(item)) {
      item.enabled = value
      dispatch('save', items)
    }
  }

  let selected: number | undefined
</script>

<!-- 3F — flex-wrap permite os botões caírem em linhas separadas
quando o popup é estreito (labels longos em pt-br) em vez do primeiro
ser empurrado para fora pela esquerda pelo flex-row-reverse. -->
<div class="flex-row-reverse flex-wrap mb-2 mr-2 gap-1">
  <Button
    on:click={() => dispatch('restoreDefaults')}
    label={view.string.RestoreDefaults}
    size={'x-small'}
    kind={'link'}
    noFocus
  />
  <div use:tooltip={{ label: view.string.RestoreSystemDefaultTooltip, direction: 'top' }}>
    <Button
      on:click={() => dispatch('restoreSystemDefault')}
      label={view.string.RestoreSystemDefault}
      size={'x-small'}
      kind={'link'}
      noFocus
    />
  </div>
  {#if showSetAsProjectDefault}
    <div use:tooltip={{ label: view.string.SetAsProjectDefaultTooltip, direction: 'top' }}>
      <Button
        on:click={() => dispatch('setAsProjectDefault', items)}
        label={view.string.SetAsProjectDefault}
        size={'x-small'}
        kind={'link'}
        noFocus
      />
    </div>
  {/if}
</div>
{#each items as item, i}
  {#if isAttribute(item)}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="menu-item flex-row-center"
      bind:this={elements[i]}
      draggable={viewlet.configOptions?.sortable && item.enabled}
      on:dragstart={(ev) => {
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'move'
          ev.dataTransfer.dropEffect = 'move'
        }
        // ev.preventDefault()
        ev.stopPropagation()
        selected = i
      }}
      on:dragover|preventDefault={(e) => {
        dragOver(e, i)
      }}
      on:dragend={dragEnd}
    >
      <ToggleWithLabel
        on={item.enabled}
        label={item.label}
        on:change={(e) => {
          change(item, e.detail)
        }}
      />
    </div>
  {:else}
    <div class="antiDivider" />
  {/if}
{/each}
