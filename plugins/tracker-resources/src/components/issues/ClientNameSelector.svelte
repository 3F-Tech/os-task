<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { createEventDispatcher, onMount } from 'svelte'
  import tracker from '@hcengineering/tracker'
  import { Button, type ButtonKind, type ButtonSize, EditBox, Spinner, tooltip } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { clientsStore, ensureClients, clientLabel, openClientPopup } from '../../clients'

  // The issue's current client. `clientCoreId` set = linked to the Core registry;
  // absent + non-empty `clientName` = legacy free-text pending manual linking.
  export let clientName: string = ''
  export let clientCoreId: number | undefined = undefined
  export let kind: ButtonKind = 'regular'
  export let size: ButtonSize = 'large'
  export let disabled: boolean = false
  export let focusIndex: number = -1
  // Indicador "não vinculado" (itálico + ponto). Desligável em contextos que só
  // guardam o nome e nunca o clientCoreId (ex.: templates) — ali "pendente" não
  // faz sentido e confundiria.
  export let showPending: boolean = true

  const dispatch = createEventDispatcher()

  onMount(() => {
    void ensureClients()
  })

  $: state = $clientsStore
  $: linked = clientCoreId !== undefined
  $: resolved = clientCoreId !== undefined ? state.byId.get(clientCoreId) : undefined
  $: displayName = resolved !== undefined ? clientLabel(resolved) : clientName
  // Core indisponível → cai para texto livre, para não travar a criação/edição.
  $: coreDown = state.status === 'error'

  function openPopup (event: MouseEvent): void {
    if (disabled) return
    openClientPopup(event, clientCoreId, (c) => {
      clientCoreId = c.id
      clientName = clientLabel(c)
      dispatch('change', { clientName, clientCoreId })
    })
  }

  function onFreeText (): void {
    // Digitação livre desvincula (vira texto pendente).
    clientCoreId = undefined
    dispatch('change', { clientName, clientCoreId: undefined })
  }
</script>

{#if coreDown}
  <EditBox
    {focusIndex}
    bind:value={clientName}
    placeholder={tracker.string.ClientName}
    kind={'editbox'}
    {disabled}
    on:change={onFreeText}
  />
{:else}
  <Button {kind} {size} {disabled} {focusIndex} width={'100%'} justify={'left'} on:click={openPopup}>
    <svelte:fragment slot="content">
      {#if state.status === 'loading' || state.status === 'idle'}
        <Spinner size={'small'} />
      {:else if displayName.length > 0}
        <span class="label" class:pending={!linked && showPending}>{displayName}</span>
        {#if !linked && showPending}
          <span
            class="pending-dot"
            use:tooltip={{ label: getEmbeddedLabel('Cliente não vinculado ao cadastro — clique para vincular') }}
            >●</span
          >
        {/if}
      {:else}
        <span class="placeholder">Selecionar cliente</span>
      {/if}
    </svelte:fragment>
  </Button>
{/if}

<style lang="scss">
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &.pending {
      font-style: italic;
      color: var(--theme-warning-color, #f59e0b);
    }
  }

  .pending-dot {
    margin-left: 0.25rem;
    color: var(--theme-warning-color, #f59e0b);
    font-size: 0.6rem;
    flex-shrink: 0;
  }

  .placeholder {
    color: var(--theme-dark-color);
  }
</style>
