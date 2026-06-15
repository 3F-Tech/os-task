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
  import { ClientStage } from '@hcengineering/tracker'

  // Presenter de VALOR (recebe a etapa direta, não a Issue). Usado em cabeçalhos
  // de agrupamento (kanban/lista) e filtros, via view.class.AttrPresenter.
  export let value: ClientStage | string | undefined

  const options: Record<string, { label: string, color: string }> = {
    [ClientStage.Onboarding]: { label: 'Onboarding', color: '#3b82f6' },
    [ClientStage.Expansion]: { label: 'Expansão', color: '#10b981' },
    [ClientStage.Retention]: { label: 'Retenção', color: '#f59e0b' },
    [ClientStage.Churned]: { label: 'Churned', color: '#ef4444' }
  }

  $: option = value != null ? options[value] : undefined
</script>

{#if option}
  <span class="stage-badge" style:background-color={option.color}>
    {option.label}
  </span>
{:else}
  <span class="stage-empty">Sem etapa</span>
{/if}

<style lang="scss">
  .stage-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 11px;
    white-space: nowrap;
  }

  .stage-empty {
    color: var(--theme-dark-color);
    font-size: 11px;
    font-weight: 500;
  }
</style>
