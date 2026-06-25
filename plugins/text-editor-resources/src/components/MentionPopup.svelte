<!--
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2023, 2024 Hardcore Engineering Inc.
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
  import core, { SearchResultDoc, Ref, Class, Doc } from '@hcengineering/core'
  import presentation, {
    SearchResult,
    reduceCalls,
    searchFor,
    type SearchItem,
    getClient
  } from '@hcengineering/presentation'
  import { Label, ListView, resizeObserver } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import contact from '@hcengineering/contact'
  import { getReferenceLabel, getReferenceObject } from './extension/reference'
  import { getResource, translate } from '@hcengineering/platform'

  export let query: string = ''
  export let multipleMentions: boolean = false
  export let docClass: Ref<Class<Doc>> | undefined = undefined

  let items: SearchItem[] = []

  const dispatch = createEventDispatcher()
  const client = getClient()

  let list: ListView
  let scrollContainer: HTMLElement
  let selection = 0

  const employeeSearchCategory = client
    .getModel()
    .findAllSync(presentation.class.ObjectSearchCategory, { classToSearch: contact.mixin.Employee })[0]

  async function getMultipleEmployeeSearchItems (localQuery: string, lastIndex: number): Promise<SearchItem[]> {
    if (!multipleMentions) return []
    if (employeeSearchCategory === undefined) return []

    const clazz =
      docClass != null && client.getHierarchy().hasClass(docClass)
        ? client.getHierarchy().getClass(docClass)
        : undefined
    const docTitle = await translate(clazz?.label ?? core.string.Object, {})

    const everyoneDescription = await translate(contact.string.EveryoneDescription, {
      title: docTitle.toLowerCase()
    })
    const hereDescription = await translate(contact.string.HereDescription, {
      title: docTitle.toLowerCase()
    })
    const everyoneTitle = await translate(contact.string.Everyone, {})
    const hereTitle = await translate(contact.string.Here, {})
    return [
      {
        num: 0,
        category: employeeSearchCategory,
        item: {
          id: contact.mention.Everyone,
          title: everyoneTitle,
          description: everyoneDescription,
          emojiIcon: '📢',
          doc: {
            _id: contact.mention.Everyone,
            _class: contact.mixin.Employee
          }
        }
      },
      {
        num: 0,
        category: employeeSearchCategory,
        item: {
          id: contact.mention.Here,
          title: hereTitle,
          description: hereDescription,
          emojiIcon: '📢',
          doc: {
            _id: contact.mention.Here,
            _class: contact.mixin.Employee
          }
        }
      }
    ]
      .filter((it) => it.item.title.toLowerCase().includes(localQuery.toLowerCase()))
      .map((it, idx) => ({ ...it, num: lastIndex + 1 + idx }))
  }

  async function handleSelectItem (item: SearchResultDoc): Promise<void> {
    if ([contact.mention.Here, contact.mention.Everyone].includes(item.id as any)) {
      dispatch('close', {
        id: item.doc._id,
        label: item.title?.toLowerCase() ?? '',
        objectclass: item.doc._class
      })
      return
    }

    const obj = (await getReferenceObject(item.doc._class, item.doc._id)) ?? item.doc
    const label = await getReferenceLabel(obj._class, obj._id)
    dispatch('close', {
      id: obj._id,
      label,
      objectclass: obj._class
    })
  }

  export function onKeyDown (key: KeyboardEvent): boolean {
    if (key.key === 'ArrowDown') {
      key.stopPropagation()
      key.preventDefault()
      list?.select(selection + 1)
      return true
    }
    if (key.key === 'ArrowUp') {
      key.stopPropagation()
      key.preventDefault()
      if (selection === 0 && scrollContainer !== undefined) {
        scrollContainer.scrollTop = 0
      }
      list?.select(selection - 1)
      return true
    }
    if (key.key === 'Enter' || key.key === 'Tab') {
      key.preventDefault()
      key.stopPropagation()
      if (selection < items.length) {
        const searchItem = items[selection]
        void handleSelectItem(searchItem.item)
        return true
      } else {
        return false
      }
    }
    return false
  }

  // Remove acentos/diacríticos e normaliza caixa, para casar "joao" com "João".
  function normalizeText (s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
  }

  // Relevância (menor = mais relevante): nome que COMEÇA com o texto primeiro,
  // depois quem tem alguma palavra começando com o texto, e por fim quem só
  // contém o texto no meio. Ninguém é descartado — só reordenado.
  function relevanceRank (title: string, normalizedQuery: string): number {
    if (normalizedQuery === '') return 0
    const n = normalizeText(title)
    if (n.startsWith(normalizedQuery)) return 0
    if (n.split(/\s+/).some((w) => w.startsWith(normalizedQuery))) return 1
    return 2
  }

  const updateItems = reduceCalls(async function (localQuery: string): Promise<void> {
    const r = await searchFor('mention', localQuery)
    if (r.query !== query) return

    // O @ busca apenas PESSOAS — descartamos tarefas e demais categorias.
    const fulltextEmployees = r.items.filter((it) => it.category.classToSearch === contact.mixin.Employee)

    // Lista determinística de pessoas: substring + acento-insensível, sempre
    // executada (o fulltext sozinho perde acentos e tem ranking imprevisível).
    let employeeItems: SearchItem[] = []
    if (localQuery !== '' && employeeSearchCategory !== undefined) {
      try {
        const queryFn = await getResource(employeeSearchCategory.query)
        const employeeResults = await queryFn(client, localQuery)
        const nq = normalizeText(localQuery)
        employeeResults.sort((a, b) => relevanceRank(a.title, nq) - relevanceRank(b.title, nq))
        employeeItems = employeeResults.slice(0, 20).map((result) => ({
          num: 0,
          category: employeeSearchCategory,
          item: {
            id: result.doc._id as Ref<Doc>,
            title: result.title,
            iconComponent: {
              component: contact.component.AvatarRef as any,
              props: { _id: result.doc._id as string }
            },
            doc: result.doc
          } as SearchResultDoc
        }))
      } catch {}
    }

    // Acrescenta funcionários que só o fulltext achou (ex.: por e-mail), sem duplicar.
    if (employeeItems.length > 0) {
      const seen = new Set(employeeItems.map((it) => it.item.doc._id))
      for (const it of fulltextEmployees) {
        if (!seen.has(it.item.doc._id)) employeeItems.push(it)
      }
    } else {
      employeeItems = fulltextEmployees
    }

    // Renumera para o cabeçalho da categoria aparecer uma única vez.
    employeeItems = employeeItems.map((it, idx) => ({ ...it, num: idx }))

    const multipleEmployeeSearchItems = await getMultipleEmployeeSearchItems(localQuery, employeeItems.length - 1)

    items = [...employeeItems, ...multipleEmployeeSearchItems]
  })
  $: void updateItems(query)
</script>

{#if (items.length === 0 && query !== '') || items.length > 0}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <form class="antiPopup mentionPoup" on:keydown={onKeyDown} use:resizeObserver={() => dispatch('changeSize')}>
    <div class="ap-scroll" bind:this={scrollContainer}>
      <div class="ap-box">
        {#if items.length === 0 && query !== ''}
          <div class="noResults"><Label label={presentation.string.NoResults} /></div>
        {/if}
        {#if items.length > 0}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <ListView bind:this={list} bind:selection count={items.length}>
            <svelte:fragment slot="category" let:item={num}>
              {@const item = items[num]}
              {#if item.num === 0}
                <div class="mentonCategory">
                  <Label label={item.category.title} />
                </div>
              {/if}
            </svelte:fragment>
            <svelte:fragment slot="item" let:item={num}>
              {@const item = items[num]}
              {@const doc = item.item}
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                class="ap-menuItem withComp h-8"
                on:click={() => {
                  void handleSelectItem(doc)
                }}
              >
                <SearchResult value={doc} />
              </div>
            </svelte:fragment>
          </ListView>
        {/if}
      </div>
    </div>
    <div class="ap-space x2" />
  </form>
{/if}

<style lang="scss">
  .noResults {
    display: flex;
    padding: 0.25rem 1rem;
    align-items: center;
    align-self: stretch;
  }

  .mentionPoup {
    padding-top: 0.5rem;
  }

  .mentonCategory {
    padding: 0.5rem 1rem;
    font-size: 0.625rem;
    letter-spacing: 0.0625rem;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    line-height: 1rem;
  }
</style>
