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
  import { Label } from '@hcengineering/ui'
  import operationalDashboard from '../plugin'

  export let count: number
  export let configured: boolean
  export let activeCount: number

  $: breakdown = configured ? `${count} tarefas aguardando aprovação · de ${activeCount} ativas` : ''
</script>

<div class="waiting-panel">
  <h3><Label label={operationalDashboard.string.WaitingApprovalTitle} /></h3>

  {#if !configured}
    <div class="hint"><Label label={operationalDashboard.string.WaitingApprovalHint} /></div>
  {:else}
    <div class="headline">
      <span class="value">{count}</span>
      <span class="breakdown">{breakdown}</span>
    </div>
  {/if}
</div>

<style lang="scss">
  .waiting-panel {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 1rem 1.25rem;
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.625rem;

    h3 {
      margin: 0;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--theme-dark-color);
      font-weight: 500;
    }
  }

  .hint {
    color: var(--theme-dark-color);
    font-size: 0.875rem;
  }

  .headline {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-wrap: wrap;

    .value {
      font-size: 2rem;
      font-weight: 600;
      color: var(--theme-caption-color);
      line-height: 1.1;
    }

    .breakdown {
      font-size: 0.8125rem;
      color: var(--theme-content-color);
    }
  }
</style>
