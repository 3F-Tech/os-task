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
  Popup de estimativa no MESMO formato do lançamento de tempo gasto
  (TimeSpendReportPopup): campo HH:MM segmentado + atalhos de duração, Enter
  salva. Substitui o EditBoxPopup numérico, que obrigava a digitar horas
  decimais ("1.5" para 1h30).

  Não grava sozinho — devolve o valor por `onChange`, porque cada chamador tem
  sua própria lógica de persistência (Tx na issue, mutação de draft, ou update
  de template + evento de analytics).
-->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import presentation, { Card } from '@hcengineering/presentation'
  import { Issue } from '@hcengineering/tracker'
  import { Button, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import tracker from '../../../plugin'
  import TitlePresenter from '../TitlePresenter.svelte'
  import DurationInputBox from './DurationInputBox.svelte'

  export let value: number | undefined = undefined
  // Só para o cabeçalho — ausente quando a estimativa é de um draft ou template.
  export let issue: Issue | undefined = undefined
  // O mesmo popup serve os atributos Estimativa e Tempo restante, daí o rótulo
  // ser parametrizável.
  export let label: IntlString = tracker.string.Estimation
  export let onChange: (value: number) => void

  // Uma tarefa pode ser estimada em dias, então o segmento de hora não usa o
  // teto de relógio (23) do lançamento de tempo gasto.
  const MAX_ESTIMATION_HOURS = 999

  const dispatch = createEventDispatcher()

  const data = { value: value ?? 0 }

  let submitting = false

  export function canClose (): boolean {
    return true
  }

  function save (): void {
    if (!canSave) return
    onChange(data.value)
  }

  // Enter no campo de duração salva e fecha, como no popup de tempo gasto.
  async function submit (): Promise<void> {
    if (!canSave || submitting) return
    submitting = true
    try {
      save()
      dispatch('close')
    } finally {
      submitting = false
    }
  }

  // Zero é válido aqui (é como se limpa a estimativa), ao contrário do
  // lançamento de tempo gasto.
  $: canSave = Number.isFinite(data.value)
</script>

<Card
  {label}
  {canSave}
  okAction={save}
  okLabel={presentation.string.Save}
  gap={'gapV-4'}
  on:close
  on:changeContent
>
  <svelte:fragment slot="header">
    {#if issue}
      <TitlePresenter showParent={false} value={issue} />
    {/if}
  </svelte:fragment>
  <div class="flex-row-center gap-2">
    <span class="content-dark-color"><Label {label} /></span>
    <DurationInputBox autoFocus maxHour={MAX_ESTIMATION_HOURS} bind:value={data.value} on:submit={submit} />
    <Button kind={'link-bordered'} on:click={() => (data.value = 0.25)}>
      <span slot="content">15<Label label={tracker.string.MinuteLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 0.5)}>
      <span slot="content">30<Label label={tracker.string.MinuteLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 1)}>
      <span slot="content">1<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 2)}>
      <span slot="content">2<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 4)}>
      <span slot="content">4<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 6)}>
      <span slot="content">6<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 7)}>
      <span slot="content">7<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 8)}>
      <span slot="content">8<Label label={tracker.string.HourLabel} /></span>
    </Button>
  </div>
</Card>
