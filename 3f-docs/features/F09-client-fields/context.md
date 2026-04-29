# F09 — Campos de Cliente (Nome do Cliente + Etapa)

## Status
🔲 A desenvolver

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

## Arquitetura planejada

### Abordagem recomendada: Custom Fields nativos do Huly

Usar o sistema de custom fields já existente no Huly, configurado via **Settings → Space Types → Task Types → Propriedades**.

**Não** adicionar campos diretamente no modelo `Issue` — isso requer migration de schema e polui o modelo com campos de negócio da 3F.

**Configuração manual inicial (sem código):**
1. Settings → Space Types → [qualquer Space Type] → Task Types → Padrão
2. Adicionar propriedade: `Nome do Cliente` (tipo: Texto)
3. Adicionar propriedade: `Etapa` (tipo: Dropdown com valores: Onboarding, Expansão, Retenção, Churned)
4. Repetir para todos os Space Types

**Para exibição na list view:** depende de F07 estar implementado.

### Alternativa: campos no modelo Issue (não recomendado para MVP)

Se precisar de queries server-side (ex: dashboard, relatórios), pode-se adicionar ao modelo:

```typescript
// plugins/tracker/src/index.ts
clientName?: string
clientStage?: 'onboarding' | 'expansion' | 'retention' | 'churned'
```

Isso exige migration transaction:
```typescript
// models/tracker/src/migration.ts
await tx.createDoc(core.class.TxMixin, ...) // adicionar campos
```

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
| Custom field vs campo no modelo | Custom field (MVP) | Sem migration, configurável via UI |
| Etapa como dropdown vs tag | Dropdown fixo | Etapas são fixas e têm semântica de negócio clara |
| Obrigatoriedade | Ambos obrigatórios | Toda tarefa da 3F está associada a um cliente |
| Valores do dropdown | 4 fixos (sem configuração) | Etapas do ciclo de vida do cliente são definição de negócio |

---

## Arquivos a criar/modificar

| Arquivo | Ação | Observação |
|---|---|---|
| Nenhum (MVP) | — | MVP usa custom fields nativos via Settings UI |
| `plugins/tracker/src/index.ts` | Modificar (se migrar para modelo) | Adicionar string IDs `clientName`, `clientStage` |
| `models/tracker/src/types.ts` | Modificar (se migrar para modelo) | Adicionar campos no interface `Issue` |
| `models/tracker/src/migration.ts` | Modificar (se migrar para modelo) | Migration para adicionar campos |
| `plugins/tracker-resources/src/` | Modificar (para list view) | Depende de F07 |

---

## MVP sem código (configuração manual)

Para começar a usar imediatamente sem desenvolvimento:

1. Acesse **Settings → Space Types → Performance → Task Types → Padrão → Propriedades**
2. Clique em "+ Add property"
3. Adicione `Nome do Cliente` (tipo: String, obrigatório)
4. Adicione `Etapa` (tipo: Dropdown, valores: Onboarding, Expansão, Retenção, Churned, obrigatório)
5. Repita para todos os Space Types: Planejamento & Design, Audiovisual, Branding, Site LP, Tecnologia - Chamados, Tecnologia - Automações

Os campos estarão disponíveis dentro da issue imediatamente, mas **não** na list view até F07 ser implementado.
