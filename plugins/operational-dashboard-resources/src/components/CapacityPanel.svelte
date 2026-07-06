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
  import { type CapacityResult } from '../metricsGreen'
  import operationalDashboard from '../plugin'

  export let result: CapacityResult

  $: tone = result.pct == null ? 'neutral' : (result.pct > result.highPct ? 'overloaded' : (result.pct < result.lowPct ? 'idle' : 'optimal'))
  $: statusLabel = tone === 'overloaded' 
    ? operationalDashboard.string.StatusOverloaded 
    : (tone === 'idle' ? operationalDashboard.string.StatusIdle : operationalDashboard.string.StatusOptimal)
  $: breakdown = result.pct != null 
    ? `${result.committedHours.toFixed(1)}h de ${result.availableHours.toFixed(1)}h ocupadas · `
    : ''
</script>

<div class="capacity-panel">
  <h3><Label label={operationalDashboard.string.CapacityTitle} /></h3>

  {#if !result.configured}
    <div class="hint"><Label label={operationalDashboard.string.CapacityHint} /></div>
  {:else if result.pct == null}
    <div class="hint"><Label label={operationalDashboard.string.NoEventsInMetric} /></div>
  {:else}
    <div class="headline">
      <span class="value" class:positive={tone === 'optimal'} class:warning={tone === 'idle'} class:negative={tone === 'overloaded'}>
        {result.pct}%
      </span>
      <span class="breakdown">
        {breakdown}
        <span class="status-badge" class:positive={tone === 'optimal'} class:warning={tone === 'idle'} class:negative={tone === 'overloaded'}>
          <Label label={statusLabel} />
        </span>
      </span>
    </div>
  {/if}
</div>

<style lang="scss">
  .capacity-panel {
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

      &.warning {
        color: #f39c12;
      }

      &.negative {
        color: #e74c3c;
      }
    }

    .breakdown {
      font-size: 0.8125rem;
      color: var(--theme-content-color);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  }

  .status-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(var(--theme-dark-color-rgb, 120, 120, 120), 0.1);
    color: var(--theme-dark-color);

    &.positive {
      background: rgba(46, 204, 113, 0.15);
      color: #2ecc71;
    }

    &.warning {
      background: rgba(243, 156, 18, 0.15);
      color: #f39c12;
    }

    &.negative {
      background: rgba(231, 76, 60, 0.15);
      color: #e74c3c;
    }
  }
</style>
