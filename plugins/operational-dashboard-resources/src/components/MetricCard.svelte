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
  import { createEventDispatcher } from 'svelte'

  export let title: IntlString
  export let value: string | number = '—'
  export let subtitle: string | undefined = undefined
  export let tone: 'positive' | 'negative' | 'neutral' = 'neutral'
  export let clickable: boolean = false

  const dispatch = createEventDispatcher()

  function handleClick (): void {
    if (clickable) dispatch('click')
  }

  function handleKeydown (e: KeyboardEvent): void {
    if (!clickable) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      dispatch('click')
    }
  }
</script>

<div
  class="metric-card"
  class:positive={tone === 'positive'}
  class:negative={tone === 'negative'}
  class:clickable
  role={clickable ? 'button' : undefined}
  tabindex={clickable ? 0 : undefined}
  on:click={handleClick}
  on:keydown={handleKeydown}
>
  <div class="title"><Label label={title} /></div>
  <div class="value">{value}</div>
  {#if subtitle}
    <div class="subtitle">{subtitle}</div>
  {/if}
</div>

<style lang="scss">
  .metric-card {
    background: var(--theme-button-bg);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.625rem;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-height: 8rem;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;

    &.clickable {
      cursor: pointer;

      &:hover {
        background: var(--theme-button-hovered);
        border-color: var(--theme-caption-color);
        transform: translateY(-1px);
      }

      &:focus-visible {
        outline: 2px solid var(--theme-caption-color);
        outline-offset: 2px;
      }
    }

    .title {
      font-size: 0.75rem;
      color: var(--theme-dark-color);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 500;
    }

    .value {
      font-size: 2.25rem;
      font-weight: 600;
      color: var(--theme-caption-color);
      line-height: 1.1;
      margin-top: auto;
    }

    .subtitle {
      font-size: 0.8125rem;
      color: var(--theme-content-color);
    }

    &.positive .value {
      color: #2ecc71;
    }

    &.negative .value {
      color: #e74c3c;
    }
  }
</style>
