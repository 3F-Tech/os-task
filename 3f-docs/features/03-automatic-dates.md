# Feature: Datas Automáticas (Start Date & Completed Date)

**Branch:** `feature/automatic-dates`  
**Prioridade:** Alta  
**Status:** Planejado

---

## Visão Geral

Adicionar dois campos de data às Issues do Tracker:

| Campo | Comportamento | Editável pelo usuário |
|---|---|---|
| `startDate` | Preenchida automaticamente com o timestamp de criação, se não informada manualmente | Sim |
| `completedDate` | Preenchida automaticamente quando o status muda para categoria **Won** (Done), se não informada manualmente | Sim |

Ambos os campos são distintos do `dueDate` (prazo), que já existe.

---

## Estado Atual do Código

### O que já existe
- `DueDate` — campo completo: interface, model (`@Prop`), string label, `DueDateEditor.svelte`, renderização no `ControlPanel.svelte`
- `StartDate` — **string label existe** em `plugins/tracker-resources/src/plugin.ts:77`, mas o campo não existe na interface `Issue` nem no model `TIssue`
- Sistema de triggers — `OnIssueUpdate` em `server-plugins/tracker-resources/src/index.ts:207`
- Categorias de status — `task.statusCategory.Won` = Done / `task.statusCategory.Lost` = Canceled

### O que não existe
- Campo `startDate` na interface `Issue` e no model `TIssue`
- Campo `completedDate` em qualquer lugar (interface, model, string label, UI)
- Trigger para preencher esses campos automaticamente

---

## Modelo de Dados

### Interface (`plugins/tracker/src/index.ts`)

Adicionar à interface `Issue` após `dueDate`:

```typescript
// Data real de início (timestamp de criação se não informada manualmente)
startDate: Timestamp | null

// Data real de conclusão (preenchida automaticamente no status Done)
completedDate: Timestamp | null
```

### Model (`models/tracker/src/types.ts`)

Adicionar à classe `TIssue` após a declaração de `dueDate` (linha 237):

```typescript
@Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.StartDate)
declare startDate: Timestamp | null

@Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.CompletedDate)
declare completedDate: Timestamp | null
```

### String Labels (`plugins/tracker-resources/src/plugin.ts`)

`StartDate` já existe na linha 77. Adicionar `CompletedDate`:

```typescript
StartDate: '' as IntlString,    // já existe
CompletedDate: '' as IntlString, // NOVO
```

---

## Fluxo Técnico dos Triggers

### Trigger 1 — startDate na criação

**Quando dispara:** `TxCreateDoc` em `tracker.class.Issue`  
**Lógica:** Se `attributes.startDate` não foi informado → adicionar `TxUpdateDoc` definindo `startDate = tx.modifiedOn`

**Implementação:** Dentro do `OnIssueUpdate` já existente, no bloco `if (actualTx._class === core.class.TxCreateDoc)` (linha 222):

```typescript
if (control.hierarchy.isDerived(createTx.objectClass, tracker.class.Issue)) {
  const issue = TxProcessor.createDoc2Doc(createTx)
  updateIssueParentEstimations(issue, result, control, [], issue.parents)

  // NOVO: auto-fill startDate se não informado
  if (issue.startDate == null) {
    result.push(
      control.txFactory.createTxUpdateDoc(
        createTx.objectClass,
        createTx.objectSpace,
        createTx.objectId,
        { startDate: createTx.modifiedOn }
      )
    )
  }
  continue
}
```

### Trigger 2 — completedDate na mudança de status para Done

**Quando dispara:** `TxUpdateDoc` em `tracker.class.Issue` com mudança de `status`  
**Lógica:** Se `operations.status` foi alterado → verificar categoria do novo status → se Won → e `completedDate` ainda não preenchido → setar `completedDate = tx.modifiedOn`

**Implementação:** Dentro de `doIssueUpdate` (chamado pelo `OnIssueUpdate` para TxUpdateDoc de Issues):

```typescript
async function doIssueUpdate(
  updateTx: TxUpdateDoc<Issue>,
  control: TriggerControl
): Promise<Tx[]> {
  const result: Tx[] = []

  // ... lógica existente de parents/estimations ...

  // NOVO: auto-fill completedDate ao atingir status Done
  if (updateTx.operations.status !== undefined) {
    const [issue] = await control.findAll(
      control.ctx,
      tracker.class.Issue,
      { _id: updateTx.objectId },
      { lookup: { status: tracker.class.IssueStatus } }
    )

    if (issue !== undefined) {
      const statusCategory = (issue.$lookup as any)?.status?.category
      const isDone = statusCategory === task.statusCategory.Won

      if (isDone && (issue as any).completedDate == null) {
        result.push(
          control.txFactory.createTxUpdateDoc(
            updateTx.objectClass,
            updateTx.objectSpace,
            updateTx.objectId,
            { completedDate: updateTx.modifiedOn }
          )
        )
      }

      // Se saiu do Done (mudou para outro status), limpar completedDate
      if (!isDone && (issue as any).completedDate != null) {
        result.push(
          control.txFactory.createTxUpdateDoc(
            updateTx.objectClass,
            updateTx.objectSpace,
            updateTx.objectId,
            { completedDate: null }
          )
        )
      }
    }
  }

  return result
}
```

> **Nota sobre reset:** Limpar `completedDate` quando o status sai de Done é opcional mas recomendado — evita data de conclusão falsa se a issue for reaberta.

---

## Componentes Svelte a Modificar

### 1. Novo componente: `StartDateEditor.svelte`

**Path:** `plugins/tracker-resources/src/components/issues/StartDateEditor.svelte`

Baseado em `DueDateEditor.svelte`. Diferenças:
- Campo alvo: `startDate` em vez de `dueDate`
- Sem lógica de "overdue" (não há cor de alerta para start date)
- Usa `client.updateCollection()` com `{ startDate: newDate }`

### 2. Novo componente: `CompletedDateEditor.svelte`

**Path:** `plugins/tracker-resources/src/components/issues/CompletedDateEditor.svelte`

Baseado em `DueDateEditor.svelte`. Diferenças:
- Campo alvo: `completedDate`
- Sem alerta de overdue
- Quando `completedDate` foi definido automaticamente pelo trigger, ainda permite edição manual
- Usa `client.updateCollection()` com `{ completedDate: newDate }`

### 3. `ControlPanel.svelte` — adicionar renderização dos novos campos

**Path:** `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte`

**Adicionar à lista `ignoreKeys`** (linha 55-68): `'startDate'` e `'completedDate'`

**Adicionar renderização** após o bloco do `dueDate` (linha 205-212):

```svelte
<!-- Start Date -->
<span class="labelOnPanel">
  <Label label={tracker.string.StartDate} />
</span>
<StartDateEditor value={issue} width={'100%'} editable={!readonly} />

<div class="divider" />

<!-- Completed Date (só mostra se preenchida) -->
{#if issue.completedDate !== null}
  <span class="labelOnPanel">
    <Label label={tracker.string.CompletedDate} />
  </span>
  <CompletedDateEditor value={issue} width={'100%'} editable={!readonly} />
{/if}
```

---

## Migration

Como os campos são novos (`startDate` e `completedDate`), issues existentes terão `undefined`/`null` nesses campos. O trigger de criação não vai retroativamente preencher `startDate` para issues antigas.

**Estratégia:** Sem migration automática para issues existentes. Issues antigas terão `startDate = null` e o campo ficará vazio — aceitável, pois a data real de criação ainda está em `createdOn` do Doc base (não exposta na UI do Tracker).

Se futuramente quiser backfill, adicionar em `models/tracker/src/migration.ts`:

```typescript
async function migrateStartDates(client: MigrationClient): Promise<void> {
  await client.update(
    DOMAIN_TASK,
    { _class: tracker.class.Issue, startDate: { $exists: false } },
    [{ $set: { startDate: null } }]  // ou usar createdOn: complexo, depende do schema
  )
}
```

---

## Passo a Passo de Implementação

### Fase 1 — Modelo de dados (estimativa: 1h)

1. **`plugins/tracker/src/index.ts`** — Adicionar `startDate` e `completedDate` à interface `Issue`
2. **`models/tracker/src/types.ts`** — Adicionar `@Prop` para ambos os campos em `TIssue`
3. **`plugins/tracker-resources/src/plugin.ts`** — Adicionar `CompletedDate` às strings (StartDate já existe)

### Fase 2 — Trigger no servidor (estimativa: 2h)

4. **`server-plugins/tracker/src/index.ts`** — Adicionar `OnAutomaticDates` ao objeto `trigger`
5. **`server-plugins/tracker-resources/src/index.ts`** — Implementar e exportar `OnAutomaticDates`
6. **`models/server-tracker/src/index.ts`** — Registrar o novo trigger com `builder.createDoc`

> **Alternativa:** Incorporar a lógica diretamente no `OnIssueUpdate` existente, evitando novo trigger. Mais simples mas menos isolado.

### Fase 3 — UI (estimativa: 2h)

7. Criar `StartDateEditor.svelte`
8. Criar `CompletedDateEditor.svelte`
9. **`ControlPanel.svelte`** — Importar e renderizar os dois novos editores, adicionar chaves ao `ignoreKeys`

### Fase 4 — Verificação e testes (estimativa: 1h)

10. Testar criação de issue sem startDate → verificar se é preenchido automaticamente
11. Testar criação com startDate manual → verificar que o valor informado é respeitado
12. Testar mudança de status para Done → verificar preenchimento de completedDate
13. Testar edição manual de completedDate → verificar que é respeitada
14. Testar reabertura de issue (sair do Done) → verificar reset de completedDate

---

## Arquivos a Modificar

| Arquivo | Ação | Seção |
|---|---|---|
| `plugins/tracker/src/index.ts` | Modificar | Interface `Issue` — adicionar 2 campos |
| `models/tracker/src/types.ts` | Modificar | Classe `TIssue` — adicionar 2 `@Prop` |
| `plugins/tracker-resources/src/plugin.ts` | Modificar | `string` — adicionar `CompletedDate` |
| `server-plugins/tracker/src/index.ts` | Modificar | `trigger` — adicionar `OnAutomaticDates` |
| `server-plugins/tracker-resources/src/index.ts` | Modificar | Implementar lógica do trigger |
| `models/server-tracker/src/index.ts` | Modificar | Registrar novo trigger |
| `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte` | Modificar | Renderizar novos campos + ignoreKeys |

## Novos Arquivos a Criar

| Arquivo | Propósito |
|---|---|
| `plugins/tracker-resources/src/components/issues/StartDateEditor.svelte` | Editor de startDate |
| `plugins/tracker-resources/src/components/issues/CompletedDateEditor.svelte` | Editor de completedDate |

---

## Riscos Técnicos

### 1. Race condition no trigger de criação (médio)
O `TxCreateDoc` gera a issue, e imediatamente geramos um `TxUpdateDoc` para `startDate`. Em condições normais isso é OK pois as Tx são processadas em sequência. Risco: se outro trigger ou processo ler a issue entre o Create e o Update, verá `startDate = null`. Mitigação: enviar `startDate` no próprio `TxCreateDoc` via hook no frontend ao invés do trigger.

**Abordagem alternativa (mais robusta):** Preencher `startDate` no próprio `CreateIssuePopup.svelte` antes de submeter — nesse caso o campo já vai populado na criação e o trigger só serve de fallback.

### 2. Lookup de status no trigger (baixo)
O trigger recebe o `TxUpdateDoc` com `operations.status = <new status id>`. Para saber a categoria do novo status, é necessário fazer `findAll` na `IssueStatus`. Esse é o padrão já usado em `DueDateEditor.svelte` via `$lookup` no frontend. No trigger, usar `control.findAll` com `{ _id: operations.status }`.

### 3. Conflito com edição manual simultânea (baixo)
Se o usuário define `completedDate` manualmente e depois o trigger também tenta setá-la, haverá duas Tx. O trigger deve verificar se o campo já foi informado na mesma Tx ou buscar o estado atual do documento antes de sobrescrever. A condição `issue.completedDate == null` na lógica do trigger protege isso.

### 4. Regressão no `doIssueUpdate` (médio)
A função `doIssueUpdate` é complexa e cuida de estimativas e parents. Qualquer mudança nela pode quebrar funcionalidades existentes. Isolar a lógica de datas automáticas em subfunção dedicada (`handleAutomaticDates`) antes de adicionar ao fluxo.

---

## Estimativa de Esforço

| Fase | Estimativa |
|---|---|
| Fase 1 — Modelo | ~1h |
| Fase 2 — Trigger | ~2h |
| Fase 3 — UI | ~2h |
| Fase 4 — Testes | ~1h |
| **Total** | **~6h** |

---

## Decisões de Design

| Questão | Decisão | Justificativa |
|---|---|---|
| `startDate` preenchido no trigger ou no frontend? | Trigger (com fallback) | Consistente com padrão do Huly; o frontend pode opcionalmente preencher também |
| `completedDate` reseta ao sair do Done? | Sim | Evita data de conclusão falsa em issues reabertas |
| `completedDate` aparece na UI quando nula? | Não (só após preenchida) | Reduz ruído visual; segue o padrão do `dueDate` no ControlPanel |
| `startDate` obrigatório na listagem? | Sempre visível | É informação de auditoria fundamental |
| Backfill de issues antigas? | Não (fase 1) | Complexidade vs. benefício; `createdOn` do Doc ainda disponível para consulta |
