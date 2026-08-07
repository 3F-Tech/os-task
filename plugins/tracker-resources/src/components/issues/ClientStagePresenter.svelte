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
  F12 — presenter da "Etapa do cliente" (enum local, não depende da 3F Core).
  Além de exibir o badge colorido, permite editar inline: clicar abre um popup
  com as 4 etapas e grava clientStage na issue (o trigger OnIssueClientPropagate
  cascateia para as sub-issues).
-->
<script lang="ts">
  import { ClientStage, type Issue } from '@hcengineering/tracker'
  import { getClient } from '@hcengineering/presentation'
  import { SelectPopup, eventToHTMLElement, showPopup } from '@hcengineering/ui'

  export let value: Issue
  // Edição inline por clique; desligável se algum contexto quiser só leitura.
  export let editable: boolean = true

  const client = getClient()

  const options: Array<{ id: ClientStage, label: string, color: string }> = [
    { id: ClientStage.Onboarding, label: 'Onboarding', color: '#3b82f6' },
    { id: ClientStage.Expansion, label: 'Expansão', color: '#10b981' },
    { id: ClientStage.Retention, label: 'Retenção', color: '#f59e0b' },
    { id: ClientStage.Churned, label: 'Churned', color: '#ef4444' }
  ]

  $: stage = value.clientStage ?? ClientStage.Onboarding
  $: option = options.find((o) => o.id === stage)

  function openEditor (event: MouseEvent): void {
    if (!editable) return
    const items = options.map((o) => ({ id: String(o.id), text: o.label, isSelected: o.id === stage }))
    showPopup(SelectPopup, { value: items }, eventToHTMLElement(event), (selectedId: string | null) => {
      if (selectedId == null) return
      void client.updateDoc(value._class, value.space, value._id, { clientStage: selectedId as ClientStage })
    })
  }
</script>

{#if option}
  {#if editable}
    <button class="stage-badge" style:background-color={option.color} on:click|stopPropagation={openEditor}>
      {option.label}
    </button>
  {:else}
    <span class="stage-badge" style:background-color={option.color}>{option.label}</span>
  {/if}
{/if}

<style lang="scss">
  .stage-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: white;
    padding: 2px 8px;
    border: none;
    border-radius: 12px;
    font-family: inherit;
    font-weight: 600;
    font-size: 11px;
    line-height: 1.5;
    white-space: nowrap;
  }
  button.stage-badge {
    cursor: pointer;
    &:hover {
      filter: brightness(1.1);
    }
  }
</style>
