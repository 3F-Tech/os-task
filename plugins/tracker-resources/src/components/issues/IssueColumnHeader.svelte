<!--
// Copyright © 2026 3F Venture — Tracker Column Header
// Clone estrutural exato da linha de tarefa (ListItem.svelte)
// para garantir alinhamento pixel-perfect via mesmas regras CSS.
-->
<script lang="ts">
  import { FixedColumn } from '@hcengineering/view-resources'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'

  export let itemModels: any = undefined
  export let _class: any = undefined
  export let docs: any[] = []
  
  let model: any[] = []

  function findModel(itemModels: any, docClass: any, firstDoc: any) {
    if (!itemModels || itemModels.size === 0) return []

    // Tenta usar a classe do primeiro documento como referência se disponível
    const targetClass = firstDoc ? (firstDoc.class ?? firstDoc._class ?? docClass) : docClass

    if (targetClass) {
      // 1. Tenta get direto
      let res = itemModels.get(targetClass)
      if (res) return res

      // 2. Tenta por _id
      for (const [key, val] of itemModels.entries()) {
        if (key._id === targetClass._id || key === targetClass) return val
      }

      // 3. Tenta hierarquia
      try {
        for (const ac of getClient().getHierarchy().getAncestors(targetClass)) {
          res = itemModels.get(ac)
          if (res) return res
          for (const [key, val] of itemModels.entries()) {
            if (key._id === ac._id) return val
          }
        }
      } catch (e) {}
    }

    // 4. Fallback final garantido: pegar o primeiro model disponível no Map
    // (na maioria das views de lista há apenas 1 model no map)
    return Array.from(itemModels.values())[0] || []
  }

  $: model = findModel(itemModels, _class, docs?.[0])

  // Filtramos as colunas que têm compression: true (ficam dentro da compression-bar)
  $: compressionCols = model.filter((m: any) => m.displayProps?.compression === true)
  
  // Colunas fixas fora da compression-bar (ex: assignee)
  $: fixedRightCols = model.filter((m: any) => m.displayProps?.fixed && !m.displayProps?.compression)
  
</script>

<div class="listGrid row header-row">
  <!-- Placeholder do checkbox area (mesma largura do flex-center.relative.mr-1) -->
  <div class="flex-center relative mr-1 header-checkbox-placeholder"></div>

  <!-- NOME / Título -->
  <span class="col-label nome-label">NOME</span>

  <!-- GrowPresenter clone (mesmo CSS) -->
  <div class="grow-container"></div>

  <!-- compression-bar clone (mesma classe CSS do Huly) -->
  <div class="compression-bar">
    {#each compressionCols as col, i}
      {#if col.displayProps?.dividerBefore === true && i > 0}
        <span class="header-divider" />
      {/if}
      <FixedColumn key={`list_item_${col.displayProps.key}`} justify={col.displayProps.fixed || 'left'}>
        <span class="col-label">
          {#if col.label}
            <Label label={col.label} />
          {:else if col.attribute?.label}
            <Label label={col.attribute.label} />
          {:else}
            {col.attribute?.name ?? ''}
          {/if}
        </span>
      </FixedColumn>
    {/each}
  </div>

  <!-- Colunas Fixas (ex: Assignee) fora da compression-bar -->
  {#each fixedRightCols as col, i}
    {#if col.displayProps?.dividerBefore === true && i > 0}
      <span class="header-divider" />
    {/if}
    <FixedColumn key={`list_item_${col.displayProps.key}`} justify={col.displayProps.fixed || 'left'}>
      <span class="col-label">
        {#if col.label}
          <Label label={col.label} />
        {:else if col.attribute?.label}
          <Label label={col.attribute.label} />
        {:else}
          {col.attribute?.name ?? ''}
        {/if}
      </span>
    </FixedColumn>
  {/each}
</div>

<style lang="scss">
  .header-row {
    border-bottom: 1px solid var(--theme-divider-color);
    margin-top: 0.5rem;
    user-select: none;
    pointer-events: none;
  }

  .header-checkbox-placeholder {
    width: 2.375rem;
    flex-shrink: 0;
    visibility: hidden;
  }

  .grow-container {
    display: flex;
    flex-grow: 1;
    min-width: 0;
    flex-shrink: initial;
    flex-basis: initial;
  }

  .nome-label {
    margin-left: 0.25rem;
  }

  .col-label {
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--theme-halfcontent-color);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
    padding: 0 0.5rem;
  }

  /* Espelha exatamente o DividerPresenter.svelte para alinhamento perfeito */
  .header-divider {
    flex-shrink: 0;
    margin: 0 0.375rem 0 0.875rem;
    width: 1px;
    height: 1.5rem;
    min-width: 1px;
    background-color: var(--theme-list-divider-color);
  }
</style>
