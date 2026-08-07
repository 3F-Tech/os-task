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
<!--
  F12 — presenter do "Nome do cliente" na lista/kanban. Além de exibir, permite
  editar inline: clicar abre o seletor da 3F Core e grava clientName+clientCoreId
  na issue (o trigger OnIssueClientPropagate cascateia para as sub-issues).
  "pending" (itálico/âmbar) = nome livre ainda não vinculado ao cadastro.
  Com `showStage`, mostra o badge da Etapa do cliente colado ao nome (também
  editável) — usado na lista para juntar cliente + etapa numa única célula.
-->
<script lang="ts">
  import { type Issue } from '@hcengineering/tracker'
  import { getClient } from '@hcengineering/presentation'
  import { tooltip } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { onMount } from 'svelte'
  import { ensureClients, openClientPopup, clientLabel } from '../../clients'
  import ClientStagePresenter from './ClientStagePresenter.svelte'

  export let value: Issue
  // Edição inline pela lista; desligável se algum contexto quiser só leitura.
  export let editable: boolean = true
  // Mostra o badge da etapa colado ao nome (usado na lista de tarefas).
  export let showStage: boolean = false
  // Limite de largura do nome na célula: nomes longos truncam com "…" em vez de
  // estourar a linha (ex.: "CULTIVO FERTILIZANTES DO BRASIL, INDÚSTRIA…"). O
  // tooltip continua mostrando o nome completo.
  export let maxWidth: string = '12rem'

  const client = getClient()

  onMount(() => {
    void ensureClients()
  })

  $: hasName = value.clientName != null && value.clientName.length > 0
  $: pending = hasName && value.clientCoreId === undefined

  function openEditor (event: MouseEvent): void {
    if (!editable) return
    openClientPopup(event, value.clientCoreId, (c) => {
      void client.updateDoc(value._class, value.space, value._id, {
        clientCoreId: c.id,
        clientName: clientLabel(c)
      })
    })
  }

  $: tip = getEmbeddedLabel(
    pending
      ? `${value.clientName ?? ''} — não vinculado ao cadastro (clique para vincular)`
      : hasName
        ? (value.clientName ?? '')
        : 'Selecionar cliente'
  )
</script>

{#if editable}
  <div class="client-cell">
    <button
      class="name-btn"
      class:pending
      style:max-width={maxWidth}
      on:click|stopPropagation={openEditor}
      use:tooltip={{ label: tip }}
    >
      {#if hasName}
        <span class="name">{value.clientName}</span>
        {#if pending}<span class="dot">●</span>{/if}
      {:else}
        <span class="placeholder">—</span>
      {/if}
    </button>
    {#if showStage && hasName}
      <ClientStagePresenter {value} />
    {/if}
  </div>
{:else if hasName}
  <span class="client-name" class:pending style:max-width={maxWidth} use:tooltip={{ label: tip }}>{value.clientName}</span>
{/if}

<style lang="scss">
  .client-cell {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: 100%;
    min-width: 0;
  }
  .name-btn {
    display: flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    padding: 0.125rem 0.25rem;
    margin: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    color: var(--theme-caption-color);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--theme-button-hovered);
      border-color: var(--theme-divider-color);
    }
    &.pending {
      font-style: italic;
      color: var(--theme-warning-color, #f59e0b);
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dot {
      margin-left: 0.25rem;
      color: var(--theme-warning-color, #f59e0b);
      font-size: 0.6rem;
      flex-shrink: 0;
    }
    .placeholder {
      color: var(--theme-dark-color);
    }
  }

  .client-name {
    flex-shrink: 0;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--theme-caption-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;

    &.pending {
      font-style: italic;
      color: var(--theme-warning-color, #f59e0b);
    }
  }
</style>
