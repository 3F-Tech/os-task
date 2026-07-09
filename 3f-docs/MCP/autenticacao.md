# Autenticação

## Método recomendado — Token de API (gerado pela UI)

O 3F Tasks possui geração de token direto na interface. É a forma mais simples para integrar o MCP.

**Onde gerar:**
`Settings → General → API Access → Generate API Token`
(URL: `/workbench/3fventure/setting/setting/general`)

O token gerado é um JWT de workspace já completo. Exemplo de payload decodificado:

```json
{
  "extra": { "authMethod": "password" },
  "account": "00000000-0000-0000-0000-000000000000",
  "workspace": "b001f439-0561-4eea-b40d-5d6df7972a79"
}
```

O UUID do workspace já está embutido no token — não é necessário chamar `selectWorkspace` separadamente.

**Como usar diretamente na API REST:**

```http
GET /api/v1/find-all/b001f439-0561-4eea-b40d-5d6df7972a79?class=tracker:class:Issue
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
```

**Como usar no api-client:**

```typescript
import { createRestTxOperations } from '@hcengineering/api-client'

const WORKSPACE_ID = 'b001f439-0561-4eea-b40d-5d6df7972a79' // do payload do token
const API_TOKEN = 'eyJ0eXAiOiJKV1Qi...'                      // gerado na UI

const client = await createRestTxOperations(
  'http://localhost:3332',
  WORKSPACE_ID,
  API_TOKEN
)
```

---

## Método alternativo — Login programático (dois passos)

Use apenas se não for possível gerar o token pela UI (ex: fluxo automatizado sem acesso à interface).

### Passo 1 — Login

> Endpoint do Account Service:
> - Local: `http://localhost:3000`
> - Produção: `https://3ftasks.3fventure.tech:3000`

```http
POST http://localhost:3000/
Content-Type: application/json

{
  "method": "login",
  "params": {
    "email": "seu@email.com.br",
    "password": "suasenha"
  }
}
```

**Resposta:**
```json
{
  "result": {
    "token": "eyJ...",
    "account": "uuid-da-conta"
  }
}
```

### Passo 2 — Selecionar Workspace

```http
POST http://localhost:3000/
Content-Type: application/json
Authorization: Bearer <token-do-passo-1>

{
  "method": "selectWorkspace",
  "params": {
    "workspaceUrl": "3fventure",
    "kind": "external",
    "externalRegions": []
  }
}
```

**Resposta:**
```json
{
  "result": {
    "token": "eyJ...",
    "endpoint": "ws://localhost:3332",
    "workspace": "b001f439-0561-4eea-b40d-5d6df7972a79"
  }
}
```

O `token` desta resposta é equivalente ao gerado pela UI. O `endpoint` é a URL base do Transactor (`ws://` → `http://` para REST).

---

## Headers obrigatórios em todas as chamadas REST

```http
Authorization: Bearer <token>
Content-Type: application/json
```

---

## Validade do token

O token gerado pela UI **não tem expiração curta** — é um token de longa duração adequado para integrações. Para revogar, basta gerar um novo token na UI (o anterior deixa de funcionar).

---

## Rate Limiting

A API retorna headers de rate limit em todas as respostas:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 998
X-RateLimit-Reset: 1704067200000
```

Em caso de limite excedido (`HTTP 429`), aguardar o tempo indicado em `Retry-After` ou `Retry-After-ms`.

---

## Código fonte de referência

- Geração do token na UI: `plugins/setting-resources/src/components/General.svelte` linha 156
- Popup exibindo o token: `plugins/setting-resources/src/components/ApiTokenPopup.svelte`
- `selectWorkspace` (server): `server/account/src/utils.ts` linha 733
- Tipos de auth: `foundations/core/packages/api-client/src/types.ts` linhas 170-198
