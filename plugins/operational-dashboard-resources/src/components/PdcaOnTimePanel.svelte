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
  import { toneForTarget } from '../metrics'
  import { type PdcaOnTimeResult } from '../metricsGreen'
  import operationalDashboard from '../plugin'

  export let result: PdcaOnTimeResult
  export let target: number | undefined = undefined

  $: tone = result.pct == null ? 'neutral' : toneForTarget(result.pct, target)
  $: breakdown = result.pct != null ? `${result.onTime}/${result.total} no prazo` : ''
</script>

<div class="pdca-panel">
  <h3><Label label={operationalDashboard.string.PdcaOnTimeTitle} /></h3>

  {#if !result.hasPdca}
    <div class="hint"><Label label={operationalDashboard.string.NoPdcaTasks} /></div>
  {:else if result.pct == null}
    <div class="hint"><Label label={operationalDashboard.string.NoIssuesInMetric} /></div>
  {:else}
    <div class="headline">
      <span class="value" class:positive={tone === 'positive'} class:negative={tone === 'negative'}>{result.pct}%</span>
      <span class="breakdown">{breakdown}</span>
    </div>
  {/if}
</div>

<style lang="scss">
  .pdca-panel {
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

      &.positive {
        color: #2ecc71;
      }

      &.negative {
        color: #e74c3c;
      }
    }

    .breakdown {
      font-size: 0.8125rem;
      color: var(--theme-content-color);
    }
  }
</style>
