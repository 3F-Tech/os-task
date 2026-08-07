<!--
// Copyright © 2025 3F Venture
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
  F12 — filtro do "Nome do cliente" COM busca. O `ValueFilter` padrão só mostra
  a caixa de busca para `TypeNumber`/`EnumOf`; `clientName` é `TypeString`, então
  ficava uma checklist sem busca — inviável com ~300 clientes. Aqui a lista de
  clientes presentes nas issues é carregada uma vez e filtrada client-side pela
  busca (sem `$like` por tecla, evitando query repetida na tabela `task`).
  Mantém o contrato do Filter: `filter.value = [[chave, [nomesOriginais]]]`
  (o `valueInResult` casa por `p[1]` — os nomes originais gravados na issue).
-->
<script lang="ts">
  import { type Class, type Doc, getObjectValue, type Ref, SortingOrder, type Space } from '@hcengineering/core'
  import presentation, { getClient } from '@hcengineering/presentation'
  import { deviceOptionsStore, EditWithIcon, Icon, IconCheck, IconSearch, Loading, resizeObserver } from '@hcengineering/ui'
  import view, { type Filter, type ViewOptions } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import { normalizeClient } from '../../clients'

  export let _class: Ref<Class<Doc>>
  export let space: Ref<Space> | undefined = undefined
  export let filter: Filter
  export let onChange: (e: Filter) => void
  export let viewOptions: ViewOptions | undefined = undefined

  filter.modes = [view.filter.FilterValueIn, view.filter.FilterValueNin]
  filter.mode = filter.mode === undefined ? filter.modes[0] : filter.mode

  const client = getClient()
  const dispatch = createEventDispatcher()

  // Chave de deduplicação (caixa-alta/trim) → conjunto dos nomes ORIGINAIS que a
  // geraram (o filtro casa pelos originais, que é o que está gravado na issue).
  const realValues = new Map<string, Set<string>>()
  const selectedValues = new Set<string>(filter.value.map((p) => p[0]))
  let allKeys: string[] = []
  let loading = true
  let search = ''

  function keyOf (raw: string): string {
    return raw.trim().toUpperCase()
  }

  async function load (): Promise<void> {
    loading = true
    realValues.clear()
    const keys = new Set<string>()
    const res = await client.findAll(
      _class,
      { ...(space !== undefined ? { space } : {}) },
      {
        projection: { clientName: 1 } as any,
        sort: { modifiedOn: SortingOrder.Descending },
        showArchived: viewOptions?.hideArchived === false
      }
    )
    for (const obj of res) {
      const raw = getObjectValue('clientName', obj as any)
      if (typeof raw !== 'string' || raw.trim().length === 0) continue
      const k = keyOf(raw)
      keys.add(k)
      realValues.set(k, (realValues.get(k) ?? new Set<string>()).add(raw))
    }
    for (const v of selectedValues) keys.add(v)
    allKeys = [...keys].sort((a, b) => a.localeCompare(b))
    loading = false
  }

  void load()

  function labelOf (key: string): string {
    return [...(realValues.get(key) ?? [])][0] ?? key
  }
  function isSelected (key: string): boolean {
    return selectedValues.has(key)
  }
  function toggle (key: string): void {
    if (selectedValues.has(key)) {
      selectedValues.delete(key)
    } else {
      selectedValues.add(key)
    }
    filter.value = [...selectedValues].map((k) => [k, [...(realValues.get(k) ?? [k])]])
    onChange(filter)
  }

  $: shown =
    search.trim() === ''
      ? allKeys
      : allKeys.filter((k) => {
          const term = normalizeClient(search)
          if (normalizeClient(k).includes(term)) return true
          return [...(realValues.get(k) ?? [])].some((r) => normalizeClient(r).includes(term))
        })
</script>

<div class="selectPopup" use:resizeObserver={() => dispatch('changeContent')}>
  <div class="header">
    <EditWithIcon
      icon={IconSearch}
      size={'large'}
      width={'100%'}
      autoFocus={!$deviceOptionsStore.isMobile}
      bind:value={search}
      placeholder={presentation.string.Search}
    />
  </div>
  <div class="scroll">
    <div class="box">
      {#if loading}
        <Loading />
      {:else}
        {#each shown as key}
          <button class="menu-item no-focus content-pointer-events-none" on:click={() => toggle(key)}>
            <div class="clear-mins flex-grow">
              <span class="overflow-label">{labelOf(key)}</span>
            </div>
            <div class="check pointer-events-none">
              {#if isSelected(key)}
                <Icon icon={IconCheck} size={'small'} />
              {/if}
            </div>
          </button>
        {/each}
      {/if}
    </div>
  </div>
  <div class="menu-space" />
</div>
