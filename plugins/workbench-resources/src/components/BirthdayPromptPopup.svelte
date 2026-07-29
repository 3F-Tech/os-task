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
  import { closePopup, Spinner } from '@hcengineering/ui'
  import { submitBirthday, BIRTHDAY_PROMPT_POPUP_CATEGORY } from '../birthdayPrompt'

  // Texto fixo em português (pt-BR) — ferramenta interna da 3F; o popup é sempre
  // em PT, independente do idioma selecionado pelo usuário.

  let value = ''
  let saving = false
  let errored = false

  // `YYYY-MM-DD` de hoje — teto do seletor (sem datas futuras).
  const today = new Date().toISOString().slice(0, 10)

  $: valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today && value.slice(0, 4) >= '1900'

  // Modal bloqueante: o PopupInstance consulta canClose() antes de fechar por
  // Escape ou clique no overlay. Retornar false trava ambos — o modal só sai
  // pelo closePopup() explícito abaixo, após gravar o aniversário com sucesso.
  export function canClose (): boolean {
    return false
  }

  async function save (): Promise<void> {
    if (!valid || saving) return
    saving = true
    errored = false
    try {
      await submitBirthday(value)
      closePopup(BIRTHDAY_PROMPT_POPUP_CATEGORY)
    } catch {
      errored = true
      saving = false
    }
  }

  function onKeydown (ev: KeyboardEvent): void {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      void save()
    }
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="birthdayPrompt" on:keydown={onKeydown}>
  <div class="title">Complete seu perfil</div>
  <div class="body">
    Antes de continuar, informe sua data de nascimento. Essa informação está faltando no seu perfil da 3F.
  </div>

  <label class="field">
    <span class="fieldLabel">Data de nascimento</span>
    <!-- svelte-ignore a11y-autofocus -->
    <input type="date" max={today} bind:value disabled={saving} autofocus />
  </label>

  {#if errored}
    <div class="error">Não foi possível salvar sua data de nascimento. Tente novamente.</div>
  {/if}

  <div class="actions">
    <button class="primary" on:click={save} disabled={!valid || saving}>
      {#if saving}
        <Spinner size={'small'} />
      {:else}
        Salvar
      {/if}
    </button>
  </div>
</div>

<style lang="scss">
  .birthdayPrompt {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 2rem;
    max-width: 30rem;
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 1rem;
    box-shadow: var(--theme-popup-shadow);
  }

  .title {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.875rem;
    color: var(--theme-caption-color);
  }

  .body {
    margin-top: 1rem;
    font-size: 1rem;
    line-height: 1.5rem;
    color: var(--theme-content-color);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1.75rem;

    .fieldLabel {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--theme-caption-color);
    }

    input {
      padding: 0.625rem 0.75rem;
      font-size: 0.9375rem;
      color: var(--theme-caption-color);
      background: var(--theme-editbox-color, transparent);
      border: 1px solid var(--theme-popup-divider);
      border-radius: 0.625rem;
      outline: none;
      color-scheme: light dark;

      &:focus {
        border-color: var(--primary-button-default);
      }

      &:disabled {
        opacity: 0.6;
      }
    }
  }

  .error {
    margin-top: 0.875rem;
    font-size: 0.875rem;
    line-height: 1.25rem;
    color: var(--theme-error-color, #eb5757);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 2rem;
  }

  button.primary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 7rem;
    min-height: 2.5rem;
    padding: 0.625rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 0.625rem;
    cursor: pointer;
    border: 1px solid var(--theme-caption-color);
    color: var(--theme-popup-color);
    background: var(--theme-caption-color);
    white-space: nowrap;

    &:hover:not(:disabled) {
      opacity: 0.9;
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
</style>
