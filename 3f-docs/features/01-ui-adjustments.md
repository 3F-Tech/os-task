# UI Adjustments — F09 Client Fields + F04 PDCA

**Status:** 🔧 Planejado  
**Branch:** `develop`  
**Scope:** Ajustes visuais e comportamentais em features já implementadas

---

## Visão Geral

Quatro ajustes independentes em features já implementadas no 3F Hub.
Nenhum altera o modelo de dados — apenas componentes de UI e strings de tradução.

---

## Ajuste 1 — Badges de cliente inline na list view

### Problema

Os campos `clientName` e `clientStage` foram adicionados ao `issueConfig()` de
`models/tracker/src/viewlets.ts` na última sessão, mas a exibição ainda precisa de
refinamento visual: os badges precisam aparecer adjacentes ao título sem quebrar o layout
quando títulos são longos.

### Estado atual

`issueConfig()` já tem entradas para `clientName` e `clientStage` com `compression: true`.
Componentes `ClientNamePresenter` e `ClientStagePresenter` existem e estão registrados.
O problema visual é que `TitlePresenter.svelte` usa `flex-shrink: 1` mas os badges ao lado
podem empurrar o título ou sumir em títulos longos.

### Solução planejada

**Arquivo:** `plugins/tracker-resources/src/components/issues/ClientNamePresenter.svelte`

- Adicionar `flex-shrink: 0` para garantir que o badge não seja comprimido pelo título
- Garantir `max-width: 8rem` com `text-overflow: ellipsis` e `overflow: hidden`
- O badge de `clientName` deve ter um tooltip com o nome completo

**Arquivo:** `plugins/tracker-resources/src/components/issues/ClientStagePresenter.svelte`

- `flex-shrink: 0` — badge colorido nunca deve sumir
- Garantir que o span usa `white-space: nowrap`

**Arquivo:** `models/tracker/src/viewlets.ts`

- Verificar se `displayProps.compression = true` é suficiente para ocultar em modo compacto
- Considerar adicionar `displayProps.grow = false` para que essas colunas não cresçam

### Validação

- Abrir list view com issue de título curto: badges aparecem ao lado do título
- Abrir list view com título de 80+ chars: título truncado, badges continuam visíveis
- Redimensionar janela para < 900px: badges somem (compression) sem quebrar layout

---

## Ajuste 2 — Corrigir labels bugados dos campos na task

### Problema

O painel lateral da issue exibe as chaves internas no lugar dos labels traduzidos:

```
tracker:string:ClientName   →  deveria mostrar: Nome do Cliente
tracker:string:ClientStage  →  deveria mostrar: Etapa
```

### Causa raiz

As chaves `ClientName` e `ClientStage` foram adicionadas ao objeto `string` em
`plugins/tracker/src/index.ts` (linhas 599-600), mas **não foram adicionadas** ao arquivo
de strings `plugins/tracker-assets/lang/en.json`.

O Huly resolve string IDs via lookup no arquivo de lang. Se a chave não existe no JSON,
ele exibe o ID bruto como fallback.

### Solução planejada

**Arquivo:** `plugins/tracker-assets/lang/en.json`

Adicionar após as entradas de PDCA existentes:

```json
"ClientName": "Nome do Cliente",
"ClientStage": "Etapa"
```

**Verificar também:**

- `plugins/tracker-assets/lang/pt.json` (se existir) — adicionar as mesmas chaves
- Outros idiomas (cs, de, es, fr): adicionar com valores em inglês como fallback

### Arquivo correto

A sequência de onde adicionar, encontrada no `en.json`:
```json
"PdcaCycleMonthly": "Monthly",
"ClientName": "Nome do Cliente",   ← INSERIR AQUI
"ClientStage": "Etapa"             ← INSERIR AQUI
```

### Validação

- Abrir qualquer issue → painel lateral exibe "Nome do Cliente" e "Etapa"
- Nenhum `tracker:string:*` visível ao usuário final

---

## Ajuste 3 — Substituir `<select>` nativo no ClientStageSelector

### Problema

`ClientStageSelector.svelte` usa um `<select>` HTML nativo customizado com CSS.
Isso não segue o padrão visual do Huly, que usa `Button` + `SelectPopup`/`DropdownLabels`
para todos os dropdowns do sistema.

O painel da issue mostra o selector de Etapa como um input generic com borda, fora do
padrão visual de todos os outros campos (Status, Priority, Assignee, etc.).

### Solução planejada

**Arquivo:** `plugins/tracker-resources/src/components/issues/ClientStageSelector.svelte`

Reescrever usando `Button` + `showPopup(SelectPopup, ...)` — mesmo padrão de
`StatusEditor`, `PriorityEditor`, etc.

```
Estrutura nova:
  <Button kind="link-bordered" size="medium" on:click={openPopup}>
    <svelte:fragment slot="content">
      <div class="stage-badge" style="background: {currentOption.color}">
        {currentOption.label}
      </div>
    </svelte:fragment>
  </Button>
```

O popup usa `SelectPopup` com itens tipados, cada item mostrando a cor do estágio como
ícone colorido ao lado do label (ex: ● Onboarding).

**Referência de implementação:**
`plugins/tracker-resources/src/components/issues/PriorityEditor.svelte` — padrão exato a
seguir: Button com ícone/label + showPopup.

### Passos de implementação

1. Mapear os 4 `ClientStage` para `ButtonItem[]` com `{ id, label, icon, color }`
2. `Button` exibe o estágio atual como badge colorido (mesmo visual do `ClientStagePresenter`)
3. `on:click` abre `SelectPopup` com os 4 opções
4. `on:change` despacha o evento igual ao componente atual para manter compatibilidade com
   `ControlPanel.svelte`

### Validação

- Clicar no campo "Etapa" no painel abre um popup (não um select nativo)
- Popup mostra os 4 estágios com cores
- Selecionar atualiza o campo imediatamente (optimistic UI)
- Visual consistente com Priority e Status editors

---

## Ajuste 4 — Redesign visual da seção PDCA Cycle na task

### Problema

O componente `PdcaCycleSection.svelte` usa pares simples de `<span class="labelOnPanel">` +
`<select>` (HTML nativo) dentro do grid de `ControlPanel`. Isso:

- Não cria nenhuma hierarquia visual — a seção PDCA se mistura com os outros campos
- Usa `<select>` nativo, diferente de todos os outros dropdowns do Huly
- O toggle de ativo/inativo fica desconexo do contexto da seção
- "Próximo ciclo" é uma linha solta sem destaque visual

### Referência visual (ClickUp recurrence pattern)

```
┌─────────────────────────────────────────┐
│  ↻ Ciclo PDCA                  [●  ON]  │
│─────────────────────────────────────────│
│  Frequência       [Semanal          ▾]  │
│  Reset para       [A FAZER          ▾]  │
│  📅 Próximo ciclo   05 Mai 2026         │
└─────────────────────────────────────────┘
```

### Arquitetura do novo componente

**Arquivo:** `plugins/tracker-resources/src/components/issues/PdcaCycleSection.svelte`

O componente deixa de ser uma série de pares labelOnPanel/field e se torna um **card
auto-contido** usando as CSS variables do Huly.

```
Estrutura do template:
  <div class="pdca-card">
    <div class="pdca-header">
      <div class="pdca-title">
        <Icon icon={tracker.icon.Pdca} />   ← ícone de recorrência (ou IconRepeat)
        <Label label={tracker.string.PdcaCycleActive} />
      </div>
      <Toggle on={isActive} on:change={...} />  ← toggle existente, mantido
    </div>

    {#if isActive}
    <div class="pdca-body">
      <div class="pdca-row">
        <span class="pdca-label"><Label label={...PdcaCycleFrequency} /></span>
        <Button kind="link-bordered" on:click={openFrequencyPopup}>
          {frequencyLabel}
        </Button>
      </div>

      <div class="pdca-row">
        <span class="pdca-label"><Label label={...PdcaCycleResetStatus} /></span>
        <Button kind="link-bordered" on:click={openStatusPopup}>
          {resetStatusLabel}
        </Button>
      </div>

      {#if issue.pdcaNextCycleDate != null}
      <div class="pdca-row pdca-next">
        <Icon icon={IconCalendar} size="small" />
        <span class="pdca-next-label">
          <Label label={tracker.string.PdcaNextCycleDate} />
        </span>
        <DueDatePresenter kind="link" value={issue.pdcaNextCycleDate} editable={false} />
      </div>
      {/if}
    </div>
    {/if}
  </div>
```

### CSS do card

Usar variáveis CSS do Huly (não valores hardcoded):

```scss
.pdca-card {
  grid-column: 1 / -1;   // ocupa as 2 colunas do grid do ControlPanel
  border: 1px solid var(--theme-divider-color);
  border-radius: var(--medium-focus-BorderRadius, 6px);
  background: var(--theme-bg-color);
  overflow: hidden;
}

.pdca-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--theme-button-default);
}

.pdca-body {
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.pdca-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;

  .pdca-label {
    flex: 1;
    font-size: 0.75rem;
    color: var(--theme-content-color);
  }
}

.pdca-next {
  margin-top: 0.25rem;
  padding-top: 0.375rem;
  border-top: 1px solid var(--theme-divider-color);
  color: var(--theme-caption-color);
}
```

### Mudança no ControlPanel

`ControlPanel.svelte` atualmente renderiza `<PdcaCycleSection>` solto dentro do grid.
Como o novo componente usa `grid-column: 1 / -1`, ele vai ocupar ambas as colunas
automaticamente — **sem alterar o ControlPanel**.

A única mudança necessária: remover os dois `<span class="labelOnPanel">` que hoje
envolvem a seção PDCA no ControlPanel, pois o card tem seu próprio header.

Verificar linhas 268-269 de `ControlPanel.svelte`:
```html
<div class="divider" />
<PdcaCycleSection {issue} {readonly} />
```
→ Manter igual. O card se auto-contém.

### Dropdowns a usar

- **Frequência:** `DropdownLabelsIntl` com itens `frequencyOptions` já definidos no componente
- **Reset status:** `Button kind="link-bordered"` + `showPopup(SelectPopup, { items: statuses })`

### Validação

- Com PDCA inativo: card exibe apenas header com toggle OFF (compacto)
- Com PDCA ativo: card expande mostrando frequência, reset status e próximo ciclo
- Toggle ativa/desativa e expande/colapsa o body animado
- Dropdowns abrem popup (não `<select>` nativo)
- Visual segue o mesmo padrão de outros cards do Huly (mesmas variáveis CSS)

---

### Ajuste 5 — Reescrever ClientStageSelector (1h)
Seguir exatamente o planejado no ultraplan seção "Ajuste 3":

Substituir `<select>` HTML nativo por `Button` + `showPopup(SelectPopup)`
seguindo o padrão exato de `PriorityEditor.svelte` como referência.

- Button exibe estágio atual como badge colorido
- on:click abre SelectPopup com os 4 estágios e suas cores
- Manter assinatura de evento `on:change` com `detail: ClientStage`
  para não quebrar ControlPanel.svelte

Validação:
- Clicar em "Etapa" abre popup (não select nativo)
- Popup mostra 4 opções com cores
- Selecionar atualiza o campo imediatamente
- Visual consistente com Priority e Status editors
## Ordem de execução recomendada

| # | Ajuste | Esforço | Risco |
|---|--------|---------|-------|
| 1 | Labels bugados (Ajuste 2) | ~15 min | Mínimo — só JSON |
| 2 | Badges na list view (Ajuste 1) | ~30 min | Baixo — CSS only |
| 3 | ClientStageSelector (Ajuste 3) | ~1h | Médio — reescrever componente |
| 4 | PDCA Card redesign (Ajuste 4) | ~2h | Médio — redesign de componente |
| 5 | Reescrever ClientStageSelector (Ajuste 5) | ~1h | Médio — reescrever componente |
**Começar pelo Ajuste 2** (fix de labels) pois é o menor esforço e maior visibilidade.

---

## Arquivos a tocar

| Arquivo | Ajuste | Tipo de mudança |
|---------|--------|-----------------|
| `plugins/tracker-assets/lang/en.json` | 2 | Adicionar 2 chaves |
| `plugins/tracker-resources/src/components/issues/ClientNamePresenter.svelte` | 1 | CSS tweak |
| `plugins/tracker-resources/src/components/issues/ClientStagePresenter.svelte` | 1 | CSS tweak |
| `models/tracker/src/viewlets.ts` | 1 | Verificar displayProps |
| `plugins/tracker-resources/src/components/issues/ClientStageSelector.svelte` | 3 | Reescrever |
| `plugins/tracker-resources/src/components/issues/PdcaCycleSection.svelte` | 4 | Redesign |

---

## Dependências e restrições

- Não alterar o modelo de dados (`plugins/tracker/src/index.ts`, `models/tracker/src/types.ts`)
- Não alterar `ControlPanel.svelte` além de remoção de divider se necessário
- Manter a assinatura de eventos do `ClientStageSelector` (`on:change` com `detail: ClientStage`)
  para não quebrar `ControlPanel.svelte`
- `PdcaCycleSection` deve usar apenas componentes já importados no projeto
  (`Button`, `Toggle`, `Label`, `Icon`, `DueDatePresenter`, `DropdownLabelsIntl`)
- CSS deve usar **exclusivamente** variáveis CSS do Huly — sem valores hexadecimais hardcoded
  (exceto nas cores semânticas do `ClientStage` que são mapeamento de negócio)
