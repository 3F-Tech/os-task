<!--
// Copyright © 2026 3F Venture
// Licensed under the Eclipse Public License, Version 2.0
-->
<script lang="ts">
  import { Breadcrumb, Button, Header, Label, showPopup } from '@hcengineering/ui'

  import tracker from '../../plugin'
  import NewClientOnboardingModal from './NewClientOnboardingModal.svelte'
  import { type BU, type BommaVariant } from './onboarding-config'

  interface HistoryEntry {
    date: string
    clientName: string
    bu: BU
    variant?: BommaVariant
    count: number
  }

  let historico: HistoryEntry[] = []

  function formatDate (): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function buLabel (entry: HistoryEntry): string {
    if (entry.bu === 'Bomma') {
      return `Bomma ${entry.variant === 'com SM' ? 'SM' : 'sem SM'}`
    }
    return entry.bu
  }

  function openOnboardingModal (): void {
    showPopup(
      NewClientOnboardingModal,
      {
        onComplete: (entry: { clientName: string, bu: BU, variant?: BommaVariant, count: number }) => {
          historico = [
            { date: formatDate(), clientName: entry.clientName, bu: entry.bu, variant: entry.variant, count: entry.count },
            ...historico
          ]
        }
      },
      'top'
    )
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={tracker.icon.Issue} label={tracker.string.AutomationScripts} size={'large'} isCurrent />
  </Header>

  <div class="page-body">
    <p class="page-description">
      <Label label={tracker.string.AutomationScriptsDescription} />
    </p>

    <section class="script-card">
      <div class="script-info">
        <h3 class="script-title"><Label label={tracker.string.ClientOnboarding} /></h3>
        <p class="script-description">
          <Label label={tracker.string.ClientOnboardingDescription} />
        </p>
      </div>
      <div class="script-action">
        <Button
          label={tracker.string.NewClientOnboarding}
          kind="primary"
          size="medium"
          on:click={openOnboardingModal}
        />
      </div>
    </section>

    <div class="divider" />

    <section class="history-section">
      <h3 class="section-title"><Label label={tracker.string.OnboardingHistorySession} /></h3>
      {#if historico.length === 0}
        <p class="empty-history">
          <Label label={tracker.string.OnboardingHistoryEmpty} />
        </p>
      {:else}
        <ul class="history-list">
          {#each historico as entry, i (i)}
            <li class="history-row">
              <span class="history-icon">✅</span>
              <span class="history-date">{entry.date}</span>
              <span class="history-client">{entry.clientName}</span>
              <span class="history-sep">—</span>
              <span class="history-bu">{buLabel(entry)}</span>
              <span class="history-count">
                {entry.count}
                <Label label={tracker.string.OnboardingTasksCount} />
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>

<style lang="scss">
  .page-body {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
    max-width: 48rem;
  }

  .page-description {
    margin: 0;
    color: var(--theme-dark-color);
    font-size: 0.875rem;
  }

  .script-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background-color: var(--theme-comp-header-color);
  }

  .script-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .script-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }

  .script-description {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
    max-width: 28rem;
  }

  .script-action {
    flex-shrink: 0;
  }

  .divider {
    height: 1px;
    background-color: var(--theme-divider-color);
  }

  .history-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-title {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--theme-caption-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .empty-history {
    margin: 0;
    color: var(--theme-dark-color);
    font-size: 0.8125rem;
  }

  .history-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .history-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);

    &:hover {
      background-color: var(--theme-button-hovered);
    }
  }

  .history-icon {
    flex-shrink: 0;
  }

  .history-date {
    color: var(--theme-dark-color);
    font-variant-numeric: tabular-nums;
  }

  .history-client {
    font-weight: 500;
    color: var(--theme-caption-color);
  }

  .history-sep {
    color: var(--theme-dark-color);
  }

  .history-bu {
    color: var(--theme-content-color);
  }

  .history-count {
    margin-left: auto;
    color: var(--theme-dark-color);
    font-variant-numeric: tabular-nums;
  }
</style>
