# Endpoints REST

**Base URL:**
- Local (dev): `http://localhost:3332`
- Produção (VPS): `https://3ftasks.3fventure.tech:3332`

Todos os endpoints exigem o header:
```
Authorization: Bearer <token-do-workspace>
```

---

## GET /api/v1/find-all/:workspace

Busca documentos de qualquer tipo (tarefas, projetos, membros, etc.).

**Parâmetros de query:**

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `class` | string | Sim | Classe do documento (ex: `tracker:class:Issue`) |
| `query` | JSON string | Não | Filtros de busca |
| `options` | JSON string | Não | Paginação, ordenação, lookup |

**Exemplo — listar todas as tarefas de um projeto:**
```http
GET /api/v1/find-all/uuid-workspace?class=tracker:class:Issue&query={"space":"uuid-projeto"}
Authorization: Bearer eyJ...
```

**Exemplo — listar com limite e ordenação:**
```http
GET /api/v1/find-all/uuid-workspace
  ?class=tracker:class:Issue
  &query={"space":"uuid-projeto","status":"uuid-status"}
  &options={"limit":50,"sort":{"modifiedOn":-1}}
Authorization: Bearer eyJ...
```

**Exemplo — filtrando por campos customizados 3F (cliente, etapa, ciclo PDCA):**
```http
GET /api/v1/find-all/uuid-workspace
  ?class=tracker:class:Issue
  &query={"space":"uuid-projeto","clientName":"Acme Ltda","clientStage":"onboarding","pdcaCycleActive":true}
Authorization: Bearer eyJ...
```

Os campos customizados disponíveis no Issue:

| Campo | Tipo | Indexado | Obs |
|---|---|---|---|
| `clientName` | string | ✓ | Nome do cliente (obrigatório) |
| `clientStage` | `'onboarding' \| 'expansion' \| 'retention' \| 'churned'` | ✓ | Etapa do cliente (obrigatório) |
| `pdcaCycleActive` | boolean | — | Ciclo PDCA ativo |
| `pdcaCycleFrequency` | `'weekly' \| 'biweekly' \| 'monthly' \| 'quarterly'` | — | Frequência do PDCA |
| `pdcaCycleResetStatus` | `Ref<IssueStatus>` | ✓ | Status para o qual a issue volta a cada ciclo |
| `pdcaNextCycleDate` | Timestamp | — | Próxima data de execução do ciclo |
| `pdcaCycleDueDays` | number[] | — | Dias da semana/mês para o ciclo |
| `pdcaCycleDuplicate` | boolean | — | Duplicar a issue a cada ciclo em vez de resetar |

**Resposta:**
```json
[
  {
    "_id": "uuid-da-tarefa",
    "_class": "tracker:class:Issue",
    "title": "Nome da tarefa",
    "status": "uuid-status",
    "priority": 2,
    "assignee": "uuid-responsavel",
    "space": "uuid-projeto",
    "identifier": "PROJ-1",
    "modifiedOn": 1704067200000,
    "createdOn": 1704067100000
  }
]
```

---

## POST /api/v1/tx/:workspace

Executa uma transação (criar, atualizar, deletar documentos).

**Body:** objeto `Tx` serializado como JSON

**Tipos de transação:**

| Tipo | Descrição |
|---|---|
| `TxCreateDoc` | Cria um novo documento |
| `TxUpdateDoc` | Atualiza campos de um documento |
| `TxRemoveDoc` | Remove um documento |
| `TxCollectionCUD` | Cria/atualiza/remove itens de coleção (ex: comentários) |

**Exemplo — criar tarefa:**
```http
POST /api/v1/tx/uuid-workspace
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "_class": "core:class:TxCreateDoc",
  "objectClass": "tracker:class:Issue",
  "objectSpace": "uuid-projeto",
  "objectId": "uuid-novo-gerado-pelo-cliente",
  "attributes": {
    "title": "Minha nova tarefa",
    "status": "uuid-status-a-fazer",
    "priority": 2,
    "assignee": "uuid-responsavel",
    "estimation": 2,
    "attachedTo": "uuid-projeto",
    "attachedToClass": "tracker:class:Project",
    "collection": "issues"
  }
}
```

> Na prática, use o `TxOperations` do api-client — ele monta a estrutura correta da transação automaticamente. Ver [tarefas.md](./tarefas.md).

---

## GET /api/v1/account/:workspace

Retorna informações da conta autenticada.

```http
GET /api/v1/account/uuid-workspace
Authorization: Bearer eyJ...
```

**Resposta:**
```json
{
  "uuid": "uuid-conta",
  "role": 1,
  "primarySocialId": "uuid-social",
  "socialIds": ["uuid-social"],
  "fullSocialIds": [
    { "_id": "uuid-social", "type": "email", "value": "usuario@exemplo.com" }
  ]
}
```

> O endpoint retorna a interface `Account` (`foundations/core/packages/core/src/classes.ts:73`). Não há campos `_id` nem `email` — o email só aparece dentro de `fullSocialIds[i].value` para social IDs do tipo `email`.

---

## GET /api/v1/load-model/:workspace

Retorna o modelo de dados completo do workspace (hierarquia de classes, mixins, etc.).

```http
GET /api/v1/load-model/uuid-workspace
Authorization: Bearer eyJ...

# Para modelo completo:
GET /api/v1/load-model/uuid-workspace?full=true
```

Útil para resolver os IDs das classes e entender a hierarquia do modelo.

---

## GET /api/v1/search-fulltext/:workspace

Busca textual em todos os documentos indexados.

**Parâmetros de query:**

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `query` | string | Texto a buscar |
| `classes` | JSON | Filtrar por classes específicas |
| `spaces` | JSON | Filtrar por espaços específicos |
| `limit` | number | Máximo de resultados |

```http
GET /api/v1/search-fulltext/uuid-workspace
  ?query=reunião+onboarding
  &classes=["tracker:class:Issue"]
  &limit=10
Authorization: Bearer eyJ...
```

---

## Códigos de resposta

| Código | Significado |
|---|---|
| `200` | Sucesso |
| `401` | Token inválido ou expirado |
| `403` | Sem permissão para o workspace |
| `404` | Documento não encontrado |
| `429` | Rate limit excedido |
| `500` | Erro interno |

---

## Código fonte de referência

- Implementação dos endpoints: `foundations/core/packages/api-client/src/rest/rest.ts`
- Tipos de transação: `foundations/core/packages/core/src/tx.ts`
