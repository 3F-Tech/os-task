# API do 3F Tasks — Documentação para MCP

Este diretório documenta a API interna do 3F Tasks para integração com o **3F OS** via MCP (Model Context Protocol).

---

## Índice

| Documento | Conteúdo |
|---|---|
| [autenticacao.md](./autenticacao.md) | Como obter tokens, autenticação por email/senha e por token |
| [api-rest.md](./api-rest.md) | Endpoints REST disponíveis (find-all, tx, search, account) |
| [tarefas.md](./tarefas.md) | CRUD completo de tarefas (Issues) e subtarefas |
| [projetos.md](./projetos.md) | Listar e consultar projetos do workspace |
| [construindo-mcp.md](./construindo-mcp.md) | Guia passo a passo para criar o MCP server |

---

## Resumo rápido

A API do 3F Tasks funciona em dois níveis:

1. **Autenticação** — via Account Service (porta `3000`), retorna um JWT
2. **Operações** — via REST (`/api/v1/*`) no Transactor (porta `3332` exposta como HTTP)

Não existe OpenAPI/Swagger. A fonte da verdade é o pacote `@hcengineering/api-client` dentro do próprio monorepo.

---

## URLs base

**Ambiente local (dev):**
```
Account Service:  http://localhost:3000
Transactor REST:  http://localhost:3332
App:              http://localhost:7000
Collaborator:     http://localhost:3078
```

**Produção (VPS):** Todos os serviços vivem no mesmo domínio, em portas distintas (TLS):
```
App:              https://3ftasks.3fventure.tech
Account Service:  https://3ftasks.3fventure.tech:3000
Transactor REST:  https://3ftasks.3fventure.tech:3332
Collaborator:     https://3ftasks.3fventure.tech:3078
```

> O nginx (`dev/nginx/3ftasks.conf`) faz TLS-termination nas portas 3000/3332/3078 e encaminha para os containers internos (13000/13332/13078). Para o MCP em produção, use as URLs `https://...:3000` e `https://...:3332`.

---

## Stack do cliente

O cliente oficial é o `@hcengineering/api-client`, disponível no monorepo em:

```
foundations/core/packages/api-client/
```

Para uso externo (no 3F OS), instalar via npm:

```bash
npm install @hcengineering/api-client
```
