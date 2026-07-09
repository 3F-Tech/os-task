# F09 — Campos de Cliente (Nome do Cliente + Etapa)

## Status
✅ Implementada

**Branch:** `feature/client-fields`  
**Prioridade:** Alta

---

## Objetivo

Adicionar dois campos padronizados em todas as issues para identificar o cliente associado à tarefa e em qual etapa do ciclo de vida o cliente se encontra. Estes campos devem aparecer visíveis na list view (inline na linha da issue).

---

## Campos

| Campo | Tipo | Obrigatório | Valores possíveis |
|---|---|---|---|
| `Nome do Cliente` | Texto (string) | Sim | Ex: "Seed", "Bomma", "ProdutoX" |
| `Etapa` | Dropdown | Sim | Onboarding / Expansão / Retenção / Churned |

---

## Comportamento esperado

### Na criação de uma issue
- Campos `Nome do Cliente` e `Etapa` aparecem no formulário de criação
- Ambos são obrigatórios (validação antes de salvar)
- `Etapa` padrão sugerida: `Onboarding` (configurável por Space Type)

### Na list view (vinculado a F07)
- `Nome do Cliente` aparece inline na linha da issue
- `Etapa` aparece como badge colorido (ex: Onboarding = azul, Churned = vermelho)

### Exemplo visual na list view
```
SEPF-1  [A FAZER]  [CLIENTE] Nome da tarefa  Bomma  [Onboarding]  [Miguel]
SEPF-2  [EM ANDAMENTO]  Setup de Contas  Seed  [Expansão]  [Ana]
```

### Filtragem e agrupamento
- Permitir filtrar issues por `Nome do Cliente`
- Permitir filtrar issues por `Etapa`
- Permitir agrupar issues por `Etapa` na board/list view

---

## Arquitetura (implementada)

### Campos reais no modelo `Issue`

Os campos foram adicionados **diretamente no modelo `Issue`** (não são custom fields via Settings). Isso viabiliza queries server-side (dashboard, relatórios) e list view.

```typescript
// plugins/tracker/src/index.ts
export enum ClientStage {
  Onboarding = 'onboarding',
  Expansion = 'expansion',
  Retention = 'retention',
  Churned = 'churned'
}

// interface Issue
clientName: string
clientStage: ClientStage
```

```typescript
// models/tracker/src/types.ts (~321, ~325) — classe TIssue
@Prop(...) clientName: string
@Prop(...) clientStage: ClientStage
```

Além disso, o projeto ganhou a flag `Project.useClientName?: boolean` (`plugins/tracker/src/index.ts` ~89) para controlar se o campo Nome do Cliente é usado naquele projeto.

**Para exibição na list view:** depende de F07 estar implementado.

---

## Mapeamento por BU

A etapa do cliente é global (todas as BUs usam o mesmo ciclo de vida):

| Etapa | Descrição | Cor sugerida |
|---|---|---|
| Onboarding | Cliente recém-chegado, em setup inicial | Azul |
| Expansão | Cliente ativo, crescendo | Verde |
| Retenção | Cliente em risco, precisa de atenção | Amarelo |
| Churned | Cliente que cancelou | Vermelho |

---

## Relação com outras features

| Feature | Relação |
|---|---|
| F05 — Onboarding Automático | Issues criadas no onboarding devem ter `Etapa = Onboarding` e `Nome do Cliente` preenchidos automaticamente |
| F07 — Custom Fields na List View | `Nome do Cliente` e `Etapa` precisam ser visíveis inline na list view |
| F06 — BUs e Controle de Acesso | A `Etapa` pode ser usada para filtros por BU no dashboard |

---

## Decisões de design

| Decisão | Escolha | Motivo |
|---|---|---|
| Custom field vs campo no modelo | **Campo no modelo `Issue`** | Habilita queries server-side (dashboard/relatórios) e list view |
| Etapa como dropdown vs tag | Dropdown fixo (`enum ClientStage`) | Etapas são fixas e têm semântica de negócio clara |
| Obrigatoriedade | `clientStage` não-opcional no modelo | Toda tarefa da 3F está associada a um cliente |
| Valores do dropdown | 4 fixos (`enum`) | Etapas do ciclo de vida do cliente são definição de negócio |

---

## Arquivos a criar/modificar

| Arquivo | Ação | Observação |
|---|---|---|
| `plugins/tracker/src/index.ts` | Modificado | `enum ClientStage` + `clientName`/`clientStage` na interface `Issue` + `Project.useClientName` |
| `models/tracker/src/types.ts` | Modificado | `@Prop` de `clientName`/`clientStage` na classe `TIssue` (~321, ~325) |
| `models/tracker/src/migration.ts` | Modificado | Migration para popular os campos em issues existentes |
| `plugins/tracker-resources/src/` | Modificado (list view) | Depende de F07 |

---

## Estado atual

Os campos `clientName` e `clientStage` já são campos reais do modelo `Issue` em todos os projetos — não há configuração manual via Settings. A exibição inline na list view depende de F07.
