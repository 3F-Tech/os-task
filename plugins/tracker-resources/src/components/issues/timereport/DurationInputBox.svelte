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
  Campo de duração no formato HH:MM (caixa segmentada estilo relógio).
  Inspirado no TimeInputBox do calendário, porém opera direto em hora/minuto
  inteiros e expõe o valor em HORAS DECIMAIS (man hours), para casar com o
  schema de TimeSpendReport. Sem Date/timezone.
-->
<script lang="ts">
  import { afterUpdate, createEventDispatcher, onMount, tick } from 'svelte'

  // Duração em horas decimais (ex.: 1h30 = 1.5). undefined = ainda não informado.
  export let value: number | undefined = undefined
  export let disabled: boolean = false
  export let autoFocus: boolean = false

  const MAX_HOUR = 23
  const MAX_MIN = 59

  type Seg = 'hour' | 'min'
  const segs: Seg[] = ['hour', 'min']

  const dispatch = createEventDispatcher()

  let h = 0
  let m = 0
  let lastValue: number | undefined
  let selected: Seg | null = null
  // Quando true, o próximo dígito digitado substitui o segmento (em vez de acumular).
  let startTyping = false
  const els: Record<Seg, HTMLElement | undefined> = { hour: undefined, min: undefined }

  function clampH (x: number): number {
    return Math.max(0, Math.min(MAX_HOUR, x))
  }
  function clampM (x: number): number {
    return Math.max(0, Math.min(MAX_MIN, x))
  }

  // Sincroniza o estado interno quando `value` muda POR FORA (atalhos, edição de
  // relatório existente). O guard `lastValue` evita re-entrada após o próprio emit().
  $: if (value !== lastValue) {
    lastValue = value
    const v = value ?? 0
    let hh = Math.floor(v + 1e-6)
    let mm = Math.round((v - hh) * 60)
    if (mm >= 60) {
      mm -= 60
      hh += 1
    }
    h = clampH(hh)
    m = clampM(mm)
  }

  function emit (): void {
    const v = h + m / 60
    lastValue = v
    value = v
    dispatch('change', v)
  }

  function getVal (s: Seg): number {
    return s === 'hour' ? h : m
  }
  function setVal (s: Seg, x: number): void {
    if (s === 'hour') h = clampH(x)
    else m = clampM(x)
  }
  function getMax (s: Seg): number {
    return s === 'hour' ? MAX_HOUR : MAX_MIN
  }

  function focusSeg (s: Seg): void {
    selected = s
    startTyping = true
  }

  // ↑ com carry: minuto 59 -> 00 e +1h; trava no topo 23:59 e na hora 23.
  function stepUp (s: Seg): void {
    if (s === 'min') {
      if (m >= MAX_MIN) {
        if (h >= MAX_HOUR) return
        m = 0
        h = clampH(h + 1)
      } else {
        m = m + 1
      }
    } else {
      if (h >= MAX_HOUR) return
      h = h + 1
    }
    emit()
  }

  // ↓ com carry: minuto 00 -> 59 e -1h; trava no piso 00:00.
  function stepDown (s: Seg): void {
    if (s === 'min') {
      if (m <= 0) {
        if (h <= 0) return
        m = MAX_MIN
        h = clampH(h - 1)
      } else {
        m = m - 1
      }
    } else {
      if (h <= 0) return
      h = h - 1
    }
    emit()
  }

  function keydown (ev: KeyboardEvent, s: Seg): void {
    if (disabled) return
    selected = s
    const idx = segs.indexOf(s)
    if (ev.key >= '0' && ev.key <= '9') {
      ev.preventDefault()
      const num = parseInt(ev.key, 10)
      // segundo dígito (não estava em startTyping) sempre avança o foco depois
      const advanceAfter = !startTyping
      if (startTyping) {
        setVal(s, num)
        startTyping = false
      } else {
        let next = getVal(s) * 10 + num
        if (next > getMax(s)) next = getMax(s)
        setVal(s, next)
      }
      emit()
      // auto-avanço hora -> minuto (no 2º dígito, ou no 1º dígito >= 3)
      if (s === 'hour' && (advanceAfter || h > 2)) {
        selected = 'min'
        startTyping = true
      }
    } else if (ev.code === 'ArrowUp') {
      ev.preventDefault()
      stepUp(s)
    } else if (ev.code === 'ArrowDown') {
      ev.preventDefault()
      stepDown(s)
    } else if (ev.code === 'Backspace') {
      ev.preventDefault()
      setVal(s, 0)
      startTyping = true
      emit()
    } else if (ev.code === 'ArrowLeft') {
      ev.preventDefault()
      selected = segs[Math.max(0, idx - 1)]
    } else if (ev.code === 'ArrowRight') {
      ev.preventDefault()
      selected = segs[Math.min(segs.length - 1, idx + 1)]
    } else if (ev.key === 'Enter') {
      ev.preventDefault()
      ev.stopPropagation()
      dispatch('submit')
    }
  }

  $: if (selected != null && els[selected] != null) els[selected]?.focus()

  afterUpdate(() => {
    if (selected != null && els[selected] != null) els[selected]?.focus()
  })

  onMount(() => {
    if (!autoFocus) return
    selected = 'hour'
    startTyping = true
    // O form abre junto com a lista de relatórios; foca após o DOM assentar e reforça num
    // defer curto para vencer qualquer foco concorrente da lista.
    const grab = (): void => els.hour?.focus()
    void tick().then(grab)
    setTimeout(grab, 60)
  })
</script>

<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="duration-input" class:disabled>
  <span
    bind:this={els.hour}
    class="digit"
    tabindex="0"
    on:keydown={(ev) => keydown(ev, 'hour')}
    on:focus={() => focusSeg('hour')}
    on:blur={() => (selected = null)}
  >
    {h.toString().padStart(2, '0')}
  </span>
  <span class="separator">:</span>
  <span
    bind:this={els.min}
    class="digit"
    tabindex="0"
    on:keydown={(ev) => keydown(ev, 'min')}
    on:focus={() => focusSeg('min')}
    on:blur={() => (selected = null)}
  >
    {m.toString().padStart(2, '0')}
  </span>
</div>

<style lang="scss">
  .duration-input {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    font-family: inherit;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
    background-color: var(--theme-bg-color);
    border: 1px solid var(--theme-button-border);
    border-radius: 0.375rem;
    padding: 0.25rem 0.5rem;
    transition: border-color 0.15s ease;

    &:hover {
      border-color: var(--theme-button-default);
    }
    &:focus-within {
      border-color: var(--primary-edit-border-color);
      color: var(--theme-caption-color);
    }
    &.disabled {
      color: var(--theme-darker-color);
      pointer-events: none;
    }

    .digit {
      min-width: 1.25em;
      padding: 0 0.125rem;
      height: 1.5rem;
      line-height: 1.5rem;
      text-align: center;
      color: var(--theme-caption-color);
      outline: none;
      border-radius: 0.125rem;
      cursor: text;
    }
    &:not(.disabled) .digit:focus {
      color: var(--primary-button-color);
      background-color: var(--primary-button-default);
    }
    .separator {
      margin: 0 0.1rem;
    }
  }
</style>
