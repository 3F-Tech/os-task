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
  import { Label, showPopup } from '@hcengineering/ui'
  import { type EfficiencyRow } from '../metricsGreen'
  import operationalDashboard from '../plugin'
  import IssueListModal from './IssueListModal.svelte'

  export let rows: EfficiencyRow[] = []
  // Meta de entrega no prazo (linha-guia vertical no eixo X).
  export let target: number | undefined = undefined
  // Limiares de WIP (carga) — faixas ocioso/ideal/sobrecarga no eixo Y.
  export let wipLow: number = 3
  export let wipHigh: number = 8

  // Clique no nome → tarefas que compõem a taxa no prazo da pessoa (mesmas
  // issues do cálculo de eficiência). Sem issues → não abre.
  function openPerson (r: EfficiencyRow): void {
    if (r.issues.length === 0) return
    showPopup(IssueListModal, { titleText: r.name, rows: r.issues }, 'center')
  }
  function onNameKey (e: KeyboardEvent, r: EfficiencyRow): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPerson(r)
    }
  }

  // Eixo X = % no prazo (0–100). Eixo Y = WIP (contagem). O topo do Y é
  // dinâmico: acomoda o maior WIP presente COM folga (headroom de 20%), para a
  // bolinha mais alta não encostar/estourar a borda superior (o plot-area tem
  // overflow hidden), e pelo menos ~1.5×wipHigh p/ a faixa de sobrecarga
  // ficar visível mesmo quando ninguém está sobrecarregado.
  $: maxWip = rows.reduce((m, r) => Math.max(m, r.wipCount), 0)
  $: maxY = Math.max(Math.ceil(wipHigh * 1.5), Math.ceil(maxWip * 1.2), wipLow + 1, 6)

  function scaleX (pct: number | null): number {
    if (pct == null) return 0
    return Math.max(0, Math.min(100, pct))
  }

  function scaleY (wip: number): number {
    return Math.max(0, Math.min(100, (wip / maxY) * 100))
  }

  // Precisa de % no prazo p/ posicionar no X; WIP sempre existe.
  $: validRows = rows.filter((r) => r.onTimePct != null)

  // Tabela ordenada por nota composta (maior primeiro; sem nota ao fim).
  $: sortedRows = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
</script>

<div class="efficiency-container">
  <div class="scatter-card">
    <div class="scatter-header">
      <h3><Label label={operationalDashboard.string.EfficiencyTitle} /></h3>
      <div class="legend">
        <span class="legend-item"><span class="dot optimal"></span><Label label={operationalDashboard.string.StatusOptimal} /></span>
        <span class="legend-item"><span class="dot idle"></span><Label label={operationalDashboard.string.StatusIdle} /></span>
        <span class="legend-item"><span class="dot overloaded"></span><Label label={operationalDashboard.string.StatusOverloaded} /></span>
      </div>
    </div>

    <div class="explain">
      <p><Label label={operationalDashboard.string.WipExplainHint} /></p>
      <p><Label label={operationalDashboard.string.ScoreHint} /></p>
    </div>

    {#if validRows.length === 0}
      <div class="empty-chart">
        <Label label={operationalDashboard.string.NoIssuesInMetric} />
      </div>
    {:else}
      <div class="plot-container">
        <!-- Y-Axis label -->
        <div class="y-axis-title"><Label label={operationalDashboard.string.WipLoad} /></div>

        <!-- The grid area -->
        <div class="plot-area">
          <!-- Guide lines -->
          {#if target != null}
            <div class="guide-line x-target" style="left: {target}%">
              <span class="guide-label">Meta: {target}%</span>
            </div>
          {/if}
          <div class="guide-line y-low" style="bottom: {(wipLow / maxY) * 100}%">
            <span class="guide-label">Ocioso: &lt;{wipLow}</span>
          </div>
          <div class="guide-line y-high" style="bottom: {(wipHigh / maxY) * 100}%">
            <span class="guide-label">Sobrecarga: &gt;{wipHigh}</span>
          </div>

          <!-- Quadrant regions -->
          <div class="quadrant risk" style="width: {target ?? 80}%; height: {100 - (wipHigh / maxY) * 100}%; left: 0; top: 0;">
            <span class="quad-label">Risco (Atraso + Sobrecarga)</span>
          </div>
          <div class="quadrant efficient" style="width: {100 - (target ?? 80)}%; height: {((wipHigh - wipLow) / maxY) * 100}%; right: 0; bottom: {(wipLow / maxY) * 100}%;">
            <span class="quad-label">Alta Performance (Ideal)</span>
          </div>

          <!-- Points -->
          {#each validRows as r}
            {@const px = scaleX(r.onTimePct)}
            {@const py = scaleY(r.wipCount)}
            <div
              class="point {r.status}"
              class:edge-left={px < 18}
              class:edge-right={px > 82}
              class:edge-top={py > 78}
              style="left: {px}%; bottom: {py}%"
            >
              <div class="dot-marker"></div>
              <div class="tooltip">
                <div class="name">{r.name}</div>
                <div class="stat">Prazo: {r.onTimePct}%</div>
                <div class="stat">WIP: {r.wipCount}</div>
                {#if r.score != null}<div class="stat">Nota: {r.score}</div>{/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- X-Axis label -->
        <div class="x-axis-title"><Label label={operationalDashboard.string.OnTimePct} /></div>
      </div>
    {/if}
  </div>

  <div class="table-card">
    <table>
      <thead>
        <tr>
          <th><Label label={operationalDashboard.string.Assignee} /></th>
          <th class="num"><Label label={operationalDashboard.string.OnTimePct} /></th>
          <th class="num"><Label label={operationalDashboard.string.WipShort} /></th>
          <th class="num"><Label label={operationalDashboard.string.PrecisionShort} /></th>
          <th class="num"><Label label={operationalDashboard.string.ReworkPct} /></th>
          <th class="num"><Label label={operationalDashboard.string.Score} /></th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {#each sortedRows as r}
          <tr>
            <td>
              {#if r.issues.length > 0}
                <span
                  class="name-link"
                  role="button"
                  tabindex="0"
                  on:click={() => openPerson(r)}
                  on:keydown={(e) => onNameKey(e, r)}
                >
                  {r.name}
                </span>
              {:else}
                {r.name}
              {/if}
            </td>
            <td class="num">{r.onTimePct == null ? '—' : `${r.onTimePct}%`}</td>
            <td class="num">{r.wipCount}</td>
            <td class="num">{r.effortPct == null ? '—' : `${r.effortPct}%`}</td>
            <td class="num">{r.reworkPct == null ? '—' : `${r.reworkPct}%`}</td>
            <td class="num"><span class="score {r.status}">{r.score == null ? '—' : r.score}</span></td>
            <td>
              <span class="status-badge {r.status}">
                <Label label={
                  r.status === 'overloaded'
                    ? operationalDashboard.string.StatusOverloaded
                    : (r.status === 'idle' ? operationalDashboard.string.StatusIdle : operationalDashboard.string.StatusOptimal)
                } />
              </span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style lang="scss">
  .efficiency-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .scatter-card {
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.625rem;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .scatter-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;

    h3 {
      margin: 0;
      font-size: 0.95rem;
      color: var(--theme-caption-color);
    }
  }

  .legend {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: var(--theme-content-color);

    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;

      &.optimal { background: #2ecc71; }
      &.idle { background: #f39c12; }
      &.overloaded { background: #e74c3c; }
    }
  }

  .explain {
    margin: -0.25rem 0 0.25rem;
    padding: 0.5rem 0.75rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;

    p {
      margin: 0;
      font-size: 0.75rem;
      line-height: 1.35;
      color: var(--theme-dark-color);

      & + p {
        margin-top: 0.25rem;
      }
    }
  }

  .empty-chart {
    height: 18rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--theme-dark-color);
    font-size: 0.875rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.375rem;
  }

  .plot-container {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: 1fr auto;
    gap: 0.5rem;
    padding: 1rem 0.5rem;
  }

  .y-axis-title {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    text-align: center;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--theme-dark-color);
    align-self: center;
  }

  .x-axis-title {
    grid-column: 2;
    text-align: center;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--theme-dark-color);
    margin-top: 0.5rem;
  }

  .plot-area {
    position: relative;
    height: 20rem;
    border-left: 2px solid var(--theme-divider-color);
    border-bottom: 2px solid var(--theme-divider-color);
    background: rgba(var(--theme-dark-color-rgb, 120, 120, 120), 0.02);
    overflow: hidden;
  }

  .guide-line {
    position: absolute;
    border: 1px dashed rgba(var(--theme-dark-color-rgb, 120, 120, 120), 0.35);
    z-index: 1;

    &.x-target {
      top: 0;
      bottom: 0;
      width: 0;
    }

    &.y-low, &.y-high {
      left: 0;
      right: 0;
      height: 0;
    }

    .guide-label {
      position: absolute;
      font-size: 0.625rem;
      color: var(--theme-dark-color);
      white-space: nowrap;
      padding: 0.125rem 0.25rem;
      background: var(--theme-bg-color);
      border-radius: 0.125rem;
      border: 1px solid var(--theme-divider-color);
      z-index: 2;
    }

    &.x-target .guide-label {
      bottom: 0.25rem;
      left: 0.25rem;
    }

    &.y-low .guide-label, &.y-high .guide-label {
      left: 0.25rem;
      top: -0.75rem;
    }
  }

  .quadrant {
    position: absolute;
    z-index: 0;
    opacity: 0.04;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;

    &.risk {
      background: #e74c3c;
      color: #e74c3c;
    }

    &.efficient {
      background: #2ecc71;
      color: #2ecc71;
    }

    .quad-label {
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  }

  .point {
    position: absolute;
    width: 0.75rem;
    height: 0.75rem;
    transform: translate(-50%, 50%);
    z-index: 10;
    cursor: pointer;

    .dot-marker {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--theme-caption-color);
      border: 2px solid var(--theme-bg-color);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      transition: transform 0.1s ease;
    }

    &:hover {
      z-index: 100;
      .dot-marker {
        transform: scale(1.3);
      }
      .tooltip {
        opacity: 1;
        visibility: visible;
      }
    }

    &.optimal .dot-marker { background: #2ecc71; }
    &.idle .dot-marker { background: #f39c12; }
    &.overloaded .dot-marker { background: #e74c3c; }

    .tooltip {
      position: absolute;
      bottom: 1.25rem;
      left: 50%;
      transform: translateX(-50%);
      background: var(--theme-bg-color);
      border: 1px solid var(--theme-divider-color);
      border-radius: 0.375rem;
      padding: 0.5rem 0.625rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      white-space: nowrap;
      z-index: 200;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s ease, visibility 0.15s ease;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;

      .name {
        font-weight: 600;
        font-size: 0.75rem;
        color: var(--theme-caption-color);
      }

      .stat {
        font-size: 0.6875rem;
        color: var(--theme-content-color);
      }
    }

    // Perto das bordas, ancora o tooltip pra dentro em vez de centralizar
    // (senão metade dele vaza e é cortado pelo overflow do plot-area).
    &.edge-left .tooltip {
      left: 0;
      right: auto;
      transform: none;
    }

    &.edge-right .tooltip {
      left: auto;
      right: 0;
      transform: none;
    }

    // Perto do topo, abre o tooltip PRA BAIXO da bolinha.
    &.edge-top .tooltip {
      bottom: auto;
      top: 1.25rem;
    }
  }

  .table-card {
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.625rem;
    padding: 0.75rem 1.25rem;

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;

      th, td {
        padding: 0.5rem 0.625rem;
        text-align: left;
        border-bottom: 1px solid var(--theme-divider-color);
        color: var(--theme-content-color);
      }

      th {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--theme-dark-color);
        font-weight: 500;
      }

      .num {
        text-align: right;
        width: 7rem;
      }

      .name-link {
        cursor: pointer;
        color: var(--theme-caption-color);
        border-bottom: 1px dashed var(--theme-divider-color);

        &:hover {
          color: var(--theme-content-color);
          border-bottom-color: var(--theme-content-color);
        }
      }

      .score {
        font-weight: 600;
        color: var(--theme-caption-color);

        &.optimal { color: #2ecc71; }
        &.idle { color: #f39c12; }
        &.overloaded { color: #e74c3c; }
      }

      .status-badge {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        background: rgba(var(--theme-dark-color-rgb, 120, 120, 120), 0.1);
        color: var(--theme-dark-color);

        &.optimal {
          background: rgba(46, 204, 113, 0.15);
          color: #2ecc71;
        }

        &.idle {
          background: rgba(243, 156, 18, 0.15);
          color: #f39c12;
        }

        &.overloaded {
          background: rgba(231, 76, 60, 0.15);
          color: #e74c3c;
        }
      }
    }
  }
</style>
