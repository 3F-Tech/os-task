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
  import { type IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import operationalDashboard from '../plugin'
  import { dashboardFilters, type DateRangePreset, setPreset } from '../stores'

  // Formata em horário local — toISOString() usaria UTC e deslocaria o dia em UTC-3.
  function toIsoDate (ts: number): string {
    const d = new Date(ts)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
  }

  // new Date('YYYY-MM-DD') interpreta como meia-noite UTC; parseia em horário local.
  function parseLocalDate (value: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (m == null) return null
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }

  function onCustomFromChange (e: Event): void {
    const value = (e.currentTarget as HTMLInputElement).value
    const d = parseLocalDate(value)
    if (d != null) {
      dashboardFilters.update((f) => ({ ...f, dateFrom: d.getTime(), preset: 'custom' }))
    }
  }

  function onCustomToChange (e: Event): void {
    const value = (e.currentTarget as HTMLInputElement).value
    const d = parseLocalDate(value)
    if (d != null) {
      // Fim do dia — inclui aprovações ocorridas durante o próprio dia selecionado.
      d.setHours(23, 59, 59, 999)
      dashboardFilters.update((f) => ({ ...f, dateTo: d.getTime(), preset: 'custom' }))
    }
  }

  const presets: Array<{ value: DateRangePreset, label: IntlString }> = [
    { value: 'week', label: operationalDashboard.string.ThisWeek },
    { value: 'month', label: operationalDashboard.string.ThisMonth },
    { value: 'last-month', label: operationalDashboard.string.LastMonth },
    { value: 'quarter', label: operationalDashboard.string.LastQuarter },
    { value: 'custom', label: operationalDashboard.string.Custom }
  ]
</script>

<div class="picker">
  <div class="presets">
    {#each presets as p (p.value)}
      <button
        class:active={$dashboardFilters.preset === p.value}
        on:click={() => setPreset(p.value)}
      >
        <Label label={p.label} />
      </button>
    {/each}
  </div>

  {#if $dashboardFilters.preset === 'custom'}
    <div class="custom-inputs">
      <label>
        <span class="lbl"><Label label={operationalDashboard.string.From} /></span>
        <input type="date" value={toIsoDate($dashboardFilters.dateFrom)} on:change={onCustomFromChange} />
      </label>
      <label>
        <span class="lbl"><Label label={operationalDashboard.string.To} /></span>
        <input type="date" value={toIsoDate($dashboardFilters.dateTo)} on:change={onCustomToChange} />
      </label>
    </div>
  {/if}
</div>

<style lang="scss">
  .picker {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .presets {
    display: flex;
    gap: 0.125rem;
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    padding: 0.125rem;

    button {
      background: none;
      border: none;
      padding: 0.375rem 0.75rem;
      color: var(--theme-content-color);
      cursor: pointer;
      font-size: 0.8125rem;
      border-radius: 0.375rem;
      transition: background 0.15s ease, color 0.15s ease;

      &.active {
        background: var(--theme-button-hovered);
        color: var(--theme-caption-color);
      }

      &:hover:not(.active) {
        color: var(--theme-caption-color);
      }
    }
  }

  .custom-inputs {
    display: flex;
    gap: 0.5rem;
    align-items: center;

    label {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.8125rem;
      color: var(--theme-content-color);
    }

    .lbl {
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--theme-dark-color);
      font-size: 0.75rem;
    }

    input[type='date'] {
      padding: 0.25rem 0.5rem;
      border-radius: 0.375rem;
      border: 1px solid var(--theme-divider-color);
      background: var(--theme-bg-color);
      color: var(--theme-caption-color);
      font-size: 0.875rem;
    }
  }
</style>
