---
title: 3F Tasks Native Toolkit (`tasks3f`)
version: 1.0
date_created: 2026-05-18
last_updated: 2026-05-18
owner: usuario@exemplo.com
status: Planned
tags: feature, toolkit, integration, 3f-tasks, hcengineering
---

# Plano: Toolkit nativo `tasks3f` para o 3F OS

Implementar 14 ferramentas nativas que permitem ao LLM do 3F OS criar, ler e modificar tarefas/projetos no 3F Tasks (plataforma Huly/Hcengineering) via REST API do Transactor, seguindo o padrão dos toolkits existentes (Google Drive, Meta Ads, Gmail).

---

## 0. Assumptions surfaced

Antes de qualquer linha de código, registrando as suposições. Corrigir agora caso alguma esteja errada:

1. **Arquitetura nativa, não MCP.** As tools vivem dentro do monorepo do 3F OS (`src/lib/3f-tasks/tools.ts`), expostas no toolkit `tasks3f` — não como processo filho (como `meta-mcp-main/`). Confirmado.
2. **Token por usuário via `integrationsRepository`.** Cada usuário gera o seu token na UI do 3F Tasks (`Settings → General → API Access`) e o cola no `/connections` do 3F OS, igual ao fluxo do Meta. O token armazena workspace embutido no JWT — não precisa de email/senha. Confirmado.
3. **Multi-tenant real.** O `workspace UUID` sai do payload JWT do token de cada usuário em runtime; nunca está hardcoded em env var no servidor. Cada chamada decodifica o token uma vez e cacheia o workspace por sessão da factory.
4. **URL base por env var (não por usuário).** `HUB_TRANSACTOR_URL` no `.env` aponta para `https://3ftasks.3fventure.tech:3332` em prod e `http://localhost:3332` em dev. Único valor para toda a instância do 3F OS — não há multi-instância de 3F Tasks por usuário.
5. **Cliente `@hcengineering/api-client` carregado dinamicamente.** Para evitar inflar o bundle e por o package ser node-only, importar via `await import(...)` dentro de cada `execute`. O `createRestClient` (leitura) e `createRestTxOperations` (escrita) ficam por trás de um helper `getClients(userId)` cacheado por requisição.
6. **Sem novo papel/role no 3F OS.** O gate de role do 3F Tasks (Maintainer pra `pending_tasks_by_user`) é resolvido contra a role retornada pelo `/api/v1/account/:workspace` do 3F Tasks — não contra a role do Better Auth do 3F OS.
7. **Sem subagent/delegate.** Ao contrário do Meta Ads, o LLM principal chama as tools diretamente — não passa por persona "analyst/manager". O pipeline novo (intent-analyzer → tool-rag → reranker) cuida da seleção.
8. **Sem cron novo.** As 14 tools são puramente request/response. Operações longas (sync/poll) ficam fora do escopo desta primeira leva.
9. **`description` em PT-BR** com vocabulário rico para o tool-RAG (espelhando o padrão `meta_get_insights`). Nomes em snake_case e em inglês (consistente com `meta_*`, `google_drive_*`, `gmail_*`).
10. **Sem alteração de schema do banco do 3F OS.** Apenas adicionar `"3f-tasks"` ao tipo `IntegrationProvider` em `src/lib/db/pg/repositories/integrations-repository.pg.ts` — não há novas tabelas.

→ Corrija agora se algo está errado, senão sigo com essas premissas.

---

## 1. Specification

### 1.1 Objective

Permitir que qualquer agente/chat do 3F OS converse com o 3F Tasks usando linguagem natural — listar projetos, listar/criar/atualizar tarefas com filtros por cliente, etapa e ciclo PDCA — sem o usuário sair do chat.

**Personas atendidas:**
- **Gestor de tráfego (user)** — consulta "tarefas atrasadas do cliente X", "minhas pendências".
- **Líder (admin)** — consulta "pendências do time da Maria" (gate Maintainer).
- **Social media (user)** — cria tarefas "Adicionar copy para a campanha X".
- **Vendas (user)** — comenta em tarefas e duplica templates de qualificação.

**O que sucesso parece:**
- Usuário diz "lista minhas tarefas pendentes" → o LLM chama `tasks3f_list_pending_tasks` sem precisar saber projeto, sem pedir IDs.
- Usuário diz "duplica a tarefa Reunião Onboarding da Acme pra Bomma" → o LLM resolve nomes em IDs (via `tasks3f_list_projects` + `tasks3f_list_tasks`) e chama `tasks3f_duplicate_task`.
- Latência percebida ≤ 3s para leituras simples (1 round-trip + dedup do LLM principal).
- Zero IDs UUID visíveis ao usuário no chat (sempre nomes/identifiers).

### 1.2 Tech Stack

| Camada | Pacote | Versão | Função |
|--------|--------|--------|--------|
| LLM SDK | `ai` | 5.0.116 (já instalado) | `tool()` factory |
| Schema | `zod` | 4.2.1 (já instalado) | Input/output validation |
| Cliente 3F Tasks | `@hcengineering/api-client` | **NOVO** — `pnpm add @hcengineering/api-client` | REST + TxOperations |
| Core types | `@hcengineering/core` | (transitivo) | `AccountRole`, `Ref<>`, etc. |
| Tracker types | `@hcengineering/tracker` | (transitivo) | `tracker.class.Issue`, `tracker.class.Project` |
| Contact types | `@hcengineering/contact` | (transitivo) | `contact.class.Person`, `contact.mixin.Employee` |
| Chunter types | `@hcengineering/chunter` | (transitivo) | `chunter.class.ChatMessage` (comentários) |
| Task types | `@hcengineering/task` | (transitivo) | `task.class.TaskType` |
| Error handling | `ts-safe` | 0.0.5 (já instalado) | `safe().ifFail().unwrap()` |

**Backward compat:** zero impacto em runtime existente — toolkit novo, opt-in via `/connections`.

### 1.3 Commands

```bash
# Instalar dependência nova
pnpm add @hcengineering/api-client

# Rodar migrations (se aplicável — neste plano não há migration)
# Não aplicável

# Lint + types + tests
pnpm check

# Servidor dev
pnpm dev

# Testes unitários do novo módulo
pnpm test src/lib/3f-tasks
pnpm test src/lib/ai/tools

# Seed do tool_vector (após registrar metadata)
pnpm tsx scripts/embed-tasks3f-tools.ts  # arquivo NOVO criado por TASK-013
```

### 1.4 Project Structure

```
src/lib/
├── 3f-tasks/                          ← NOVO módulo
│   ├── client.ts                      ← getRestClient(userId) + getTxClient(userId)
│   ├── auth.ts                        ← getCurrentAccount, getCurrentPersonRef, requireRole, role gate
│   ├── tools.ts                       ← createTasks3FTools(userId) — fábrica das 14 tools
│   ├── workspace-resolver.ts          ← Decodifica JWT e extrai workspace UUID, com cache LRU
│   ├── formatters.ts                  ← Helpers de mapeamento (priority→label, status→label, etc.)
│   └── tools.test.ts                  ← Vitest: mocka api-client e testa cada tool
│
├── ai/tools/
│   ├── index.ts                       ← + AppDefaultToolkit.Tasks3F + DefaultToolName.Tasks3F* (no minimum, mas opcional)
│   ├── tool-kit.ts                    ← + [AppDefaultToolkit.Tasks3F]: createTasks3FTools(userId)
│   └── tool-enhanced-metadata.ts      ← + 14 entradas (toolkit, opType, description, auxiliaryPrompt, deps)
│
├── db/pg/repositories/
│   └── integrations-repository.pg.ts  ← + provider "3f-tasks" no IntegrationProvider type
│
scripts/
└── embed-tasks3f-tools.ts             ← NOVO — seed do tool_vector (espelha embed-meta-get-insights.ts)

.env.example                           ← + HUB_TRANSACTOR_URL=https://3ftasks.3fventure.tech:3332

src/app/(chat)/connections/             ← (alteração mínima: adicionar UI card "3F Tasks" pro user colar o token)
└── 3f-tasks-card.tsx                  ← NOVO (componente — análogo ao card do Meta)
```

### 1.5 Code Style

Espelha o padrão de `createGoogleDriveTools` / `createMetaDirectTools`. Exemplo de uma tool típica:

```typescript
// src/lib/3f-tasks/tools.ts
import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { getRestClient, getTxClient } from "./client";
import { requireRole } from "./auth";
import { formatTaskRow, PRIORITY_LABELS } from "./formatters";

export function createTasks3FTools(userId?: string) {
  const getRead = () => {
    if (!userId) throw new Error("Usuário não autenticado.");
    return getRestClient(userId);
  };

  return {
    tasks3f_list_tasks: tool({
      description:
        "Lista, enumera ou mostra tarefas (issues) de um projeto do 3F Tasks. " +
        "Permite filtrar por status, responsável, prioridade, nome do cliente, etapa do cliente " +
        "(onboarding, expansion, retention, churned) e ciclo PDCA ativo. Retorna até 50 tarefas por padrão " +
        "com identificador (ex: SEEDP-42), título, status, prioridade, responsável, vencimento e campos 3F.",
      inputSchema: z.object({
        project_id: z
          .string()
          .describe("UUID do projeto. Use tasks3f_list_projects primeiro se não tiver o ID."),
        status_id: z
          .string()
          .optional()
          .describe("UUID do status para filtrar. Opcional."),
        assignee_id: z
          .string()
          .optional()
          .describe("UUID (Ref<Person>) do responsável. Opcional."),
        client_name: z
          .string()
          .optional()
          .describe("Nome exato do cliente (campo customizado 3F). Case-sensitive."),
        client_stage: z
          .enum(["onboarding", "expansion", "retention", "churned"])
          .optional()
          .describe("Etapa do cliente. Opcional."),
        pdca_active: z
          .boolean()
          .optional()
          .describe("Apenas tarefas com ciclo PDCA ativo. Opcional."),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({
        project_id,
        status_id,
        assignee_id,
        client_name,
        client_stage,
        pdca_active,
        limit,
      }) => {
        try {
          const tracker = await import("@hcengineering/tracker");
          const client = await getRead();
          const query: Record<string, unknown> = { space: project_id };
          if (status_id) query.status = status_id;
          if (assignee_id) query.assignee = assignee_id;
          if (client_name) query.clientName = client_name;
          if (client_stage) query.clientStage = client_stage;
          if (pdca_active !== undefined) query.pdcaCycleActive = pdca_active;

          const rows = await client.findAll(tracker.default.class.Issue, query, {
            limit,
            sort: { modifiedOn: -1 },
          });

          return { total: rows.length, tasks: rows.map(formatTaskRow) };
        } catch (err: unknown) {
          return {
            error: err instanceof Error ? err.message : String(err),
            solution:
              "Verifique se o usuário tem token do 3F Tasks configurado em /connections " +
              "e se o project_id pertence ao workspace do token.",
          };
        }
      },
    }),

    // ... outras 13 tools no mesmo padrão
  };
}
```

**Convenções obrigatórias:**
- Nome da tool: `tasks3f_<snake_case_em_ingles>` (prefixo `tasks3f_` para namespace no RAG).
- `description`: PT-BR, com sinônimos do domínio (tarefa/issue/task, projeto/project/workspace, responsável/assignee).
- `inputSchema`: Zod com `.describe()` em **todo** campo, `.default()` quando aplicável, `.enum()` para valores fechados.
- `execute`: `try/catch` retornando `{ error, solution? }` em caso de falha (NUNCA propaga exceção — quebra o stream).
- Imports do `@hcengineering/*` SEMPRE dinâmicos (`await import(...)`) para não inflar o build.
- Retorno sempre em PT-BR para o LLM (labels: "Urgente", "Alta", "Onboarding") — IDs em inglês.
- Nunca expõe UUIDs ao usuário final no campo principal — use `identifier` (ex: `SEEDP-42`).

### 1.6 Testing Strategy

| Nível | Framework | Localização | Cobertura mínima |
|-------|-----------|-------------|------------------|
| Unitário | Vitest | `src/lib/3f-tasks/*.test.ts` | 80% das tools (input parsing + happy path + error path) |
| Unitário | Vitest | `src/lib/3f-tasks/formatters.test.ts` | 100% dos mapeamentos (priority, stage, status) |
| Unitário | Vitest | `src/lib/3f-tasks/workspace-resolver.test.ts` | 100% (decode JWT + cache hit/miss) |
| Integração manual | curl/Postman | dev local com 3F Tasks rodando | Sanity check de cada tool antes de mergear |
| E2E | Playwright | `tests/3f-tasks-toolkit.spec.ts` | Smoke: usuário cola token → lista projetos → cria tarefa |

**Mocking:** as tools mockam `@hcengineering/api-client` via `vi.mock()` — não fazem rede em CI.

**Fixtures:** dois tokens de teste (mockado) no fixtures: um com role `User` e outro com `Maintainer`, para testar o gate.

### 1.7 Boundaries

**Always:**
- Rodar `pnpm check` antes do commit.
- Adicionar `.describe()` em todo campo Zod.
- Wrappear `execute` em `try/catch` retornando `{ error }` no falho.
- Usar `await import("@hcengineering/...")` em vez de import top-level.
- Registrar a tool nova em `TOOL_ENHANCED_METADATA` E rodar `embed-tasks3f-tools.ts` para popular o `tool_vector`.

**Ask first:**
- Adicionar campos novos ao schema do `Issue` no 3F Tasks (mexe em código do monorepo externo — fora do escopo).
- Aumentar `MAX_FILE_BYTES` ou outros limites globais.
- Mudar o `IntegrationProvider` para algo diferente de `"3f-tasks"`.
- Adicionar uma 15ª tool ou estender escopo.

**Never:**
- Commitar token do 3F Tasks no repo (mesmo em `.env.example`).
- Importar `RestClientImpl` diretamente do `@hcengineering/api-client` (é interno, não exportado).
- Hardcodar workspace UUID em config — sempre extrair do JWT do token do usuário.
- Pular o gate de role do `pending_tasks_by_user` (defesa em profundidade).
- Quebrar o pattern factory `createXxxTools(userId)` — quebra o tool-kit.ts.

### 1.8 Success Criteria

Concreto, testável, binário:

- [ ] **SC-01:** Usuário cola token na `/connections` e o card "3F Tasks" mostra status "Conectado".
- [ ] **SC-02:** No chat, "lista meus projetos no 3F Tasks" retorna ≥ 1 projeto (validado contra workspace de teste).
- [ ] **SC-03:** "lista minhas tarefas pendentes" funciona sem o usuário precisar dizer projeto/status.
- [ ] **SC-04:** "cria uma tarefa de teste no projeto SEED Performance pro cliente Acme em onboarding" cria a tarefa com todos os campos obrigatórios preenchidos (incluindo `clientName`/`clientStage`).
- [ ] **SC-05:** Tool RAG ranqueia `tasks3f_list_tasks` em top-3 para queries "minhas tarefas", "tarefas do cliente X", "issues do projeto Y".
- [ ] **SC-06:** Usuário com role User no 3F Tasks NÃO consegue chamar `tasks3f_list_pending_tasks_by_user` (gate de role bloqueia com erro claro).
- [ ] **SC-07:** Latência p50 ≤ 1.5s para tools read (list_projects, get_task, pending_tasks).
- [ ] **SC-08:** Zero menções de UUID nas respostas do LLM principal (apenas `identifier` ou nome).
- [ ] **SC-09:** `pnpm check` passa (lint + types + testes unitários).
- [ ] **SC-10:** 14/14 tools cadastradas em `TOOL_ENHANCED_METADATA` e com embeddings no `tool_vector`.

### 1.9 Open Questions

1. **Q1 — Status default em `create_task`:** o LLM deve descobrir o status "A fazer" do projeto sozinho (chamando `tasks3f_list_statuses` antes) ou a tool deve resolver automaticamente o `defaultIssueStatus` do projeto? **Recomendação:** auto-resolver via `defaultIssueStatus` quando `status_id` não for passado — economiza um round-trip.
2. **Q2 — Comentários markdown:** o `add_comment` aceita markdown ou só plain text? O `chunter.class.ChatMessage` aceita ambos via `message` — confirmar se o frontend do 3F Tasks renderiza markdown. **Recomendação:** assumir plain text na v1, documentar como limitação.
3. **Q3 — Limite de paginação:** `list_tasks` tem cap em 200. Faz sentido oferecer cursor pagination ou v1 fica em "se quiser mais, refine os filtros"? **Recomendação:** sem cursor na v1.
4. **Q4 — `duplicate_task`:** duplica subtarefas também? E comentários? **Recomendação:** apenas o `Issue` raiz com os mesmos atributos (sem subtarefas, sem comentários, status volta a "A fazer"). Documentar.
5. **Q5 — `find_overdue_tasks` é por workspace inteiro ou por projeto?** **Recomendação:** opcional `project_id`; sem ele varre todos os projetos do workspace.
6. **Q6 — Onde renderizar o card no `/connections`:** componente único que englobe Meta + Drive + 3F Tasks, ou cards separados? **Recomendação:** card separado, mesma UX visual.

---

## 2. Implementation Plan

### 2.1 Major components & dependencies

```
                      ┌────────────────────────┐
                      │  src/lib/3f-tasks/      │
                      │                         │
   ┌──────────────►   │   tools.ts (14 tools)   │ ◄──── Importado por:
   │                  │                         │       src/lib/ai/tools/tool-kit.ts
   │                  └────────────┬────────────┘
   │                               │ usa
   │                               ▼
   │                  ┌────────────────────────┐
   │                  │     auth.ts             │ ─── requireRole
   │                  │ (role gate, person ref) │
   │                  └────────────┬────────────┘
   │                               │ usa
   │                               ▼
   │                  ┌────────────────────────┐
   │                  │     client.ts           │ ◄─── getRestClient(userId), getTxClient(userId)
   │                  │  (factory + cache LRU)  │
   │                  └─────┬──────────┬────────┘
   │                        │          │ usa
   │                        ▼          ▼
   │       ┌─────────────────────┐   ┌──────────────────────────┐
   │       │ workspace-resolver  │   │ integrationsRepository    │
   │       │ (decode JWT + cache)│   │ (read token by userId)    │
   │       └─────────────────────┘   └──────────────────────────┘
   │
   │                  ┌────────────────────────┐
   └────── lê ────────│     formatters.ts       │
                      │ (priority/stage labels) │
                      └────────────────────────┘

   src/lib/ai/tools/
   ├── tool-enhanced-metadata.ts  ◄── + 14 entradas (toolkit, opType, desc, auxiliaryPrompt, prereqs)
   └── tool-kit.ts                 ◄── + Tasks3F: createTasks3FTools(userId)

   scripts/
   └── embed-tasks3f-tools.ts     ◄── popula tool_vector com 14 rows + dependências

   src/app/(chat)/connections/
   └── (UI mínima: card 3F Tasks)

   .env.example                    ◄── + HUB_TRANSACTOR_URL
```

### 2.2 Implementation order

**Fase 1 — Infraestrutura (sequencial, sem paralelismo possível):**
1. `pnpm add @hcengineering/api-client` + verificar peer deps
2. `IntegrationProvider` ganha `"3f-tasks"`
3. `client.ts` + `workspace-resolver.ts` (sem rede ainda, só decode JWT)
4. `auth.ts` (depende de client.ts)
5. `formatters.ts` (puro, independente)

**Fase 2 — Read tools (paralelizável entre si):**
6. `tasks3f_list_projects`
7. `tasks3f_list_tasks`
8. `tasks3f_get_task`
9. `tasks3f_list_statuses`
10. `tasks3f_list_members`
11. `tasks3f_list_pending_tasks` (precisa de `auth.ts.getCurrentPersonRef`)
12. `tasks3f_list_pending_tasks_by_user` (precisa de `auth.ts.requireRole`)
13. `tasks3f_find_overdue_tasks`

**Fase 3 — Write tools (paralelizável, depende de Fase 2 só para testes):**
14. `tasks3f_create_task`
15. `tasks3f_update_task`
16. `tasks3f_add_comment`
17. `tasks3f_duplicate_task`
18. `tasks3f_create_subtask`
19. `tasks3f_log_time`

**Fase 4 — Registro + integração (sequencial):**
20. Plugar todas em `tool-kit.ts`
21. Adicionar entradas em `TOOL_ENHANCED_METADATA`
22. Criar `scripts/embed-tasks3f-tools.ts` e rodar
23. Card UI no `/connections`

**Fase 5 — Testes + ship:**
24. Vitest cobrindo unitários
25. Smoke test E2E no dev
26. PR + review

### 2.3 Risks & mitigations

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| **R-01:** `@hcengineering/api-client` tem peer deps incompatíveis com Next 16 / React 19 | Média | Alto — bloqueia o build | Antes da Fase 2, rodar `pnpm add` + `pnpm build` em branch isolada. Se quebrar, considerar fork ou wrapper REST puro com `fetch` (perde `TxOperations` mas mantém os endpoints `/api/v1/tx`). |
| **R-02:** Token do 3F Tasks expira ou é rotacionado sem aviso | Alta | Médio — tool retorna 401 | Adicionar handler de 401 nas tools que detecta token inválido e instrui o LLM a responder "seu token expirou, gere um novo em /connections". Sem refresh automático na v1 (não há OAuth flow). |
| **R-03:** Pacote `@hcengineering/api-client` aumenta bundle do Next em > 2MB | Média | Médio — slowdown no SSR | Uso de `await import()` em todos os imports do pacote. Validar com `next build --debug`. |
| **R-04:** Tool RAG não ranqueia bem as tools `tasks3f_*` (ex: confunde com `gmail_*` em queries genéricas tipo "pendências") | Média | Médio — UX ruim | Investir em descriptions ricas em vocabulário ("tarefa, issue, task, pendência, projeto, atrasada"). Backfill o `auxiliaryPrompt` com regras claras de when-not-to-use. |
| **R-05:** Workspace UUID errado no token (token foi gerado num workspace e o usuário troca de workspace) | Baixa | Alto — vê dados de outro tenant | Validar workspace UUID no `tasks3f` em toda chamada, comparar com cache. Se token vier sem workspace, falhar com erro claro. Adicionar teste unitário. |
| **R-06:** Latência alta do 3F Tasks em prod (VPS) | Média | Médio — > 3s p50 | Cachear `list_projects` (que muda pouco) por 60s em memória por usuário. Outras tools sem cache. |
| **R-07:** LLM tenta passar `client_stage` errado (ex: "novo" em vez de "onboarding") | Alta | Baixo — Zod rejeita | `enum()` no Zod já cobre. Mensagem de erro do Zod chega ao LLM com os valores válidos. |
| **R-08:** `find_overdue_tasks` sem `project_id` faz fan-out grande em workspace com muitas tarefas | Média | Alto — > 5s e timeout | Cap hard de 500 tarefas no resultado, sort por `dueDate ASC`, parar quando passar do `now()`. Documentar trade-off. |
| **R-09:** `duplicate_task` cria duplicata sem `clientName`/`clientStage` corretos (campos obrigatórios novos) | Alta | Médio — falha de validação | Ler o issue origem primeiro, propagar TODOS os campos exceto `_id`/`identifier`/`completedDate`/`subIssues`. Teste cobrindo. |

### 2.4 Verification checkpoints

Após cada fase, ANTES de avançar:

- **Após Fase 1:** `pnpm build` passa, `client.ts` exporta funções sem erro de import.
- **Após Fase 2:** Pelo menos `tasks3f_list_projects` e `tasks3f_list_tasks` funcionam contra 3F Tasks local (curl manual ou repl).
- **Após Fase 3:** `tasks3f_create_task` cria tarefa real no 3F Tasks local (manual check via UI do 3F Tasks).
- **Após Fase 4:** Tool RAG retorna `tasks3f_list_tasks` em top-5 para "lista minhas tarefas" via `console.log` do `searchToolsByIntents`.
- **Após Fase 5:** SC-01 a SC-10 todos check.

---

## 3. Tasks Breakdown

Granularidade: cada task completável em uma sessão focada (1-2h), no máximo 5 arquivos tocados, com acceptance + verify explícitos.

### Phase 1 — Infraestrutura

- [ ] **TASK-001 — Instalar `@hcengineering/api-client` + peer deps**
  - **Acceptance:** `package.json` lista `@hcengineering/api-client` e dependências peer instaladas. `pnpm install && pnpm build` passa em CI.
  - **Verify:** `pnpm build` sem erros de tipo. `pnpm dev` sobe.
  - **Files:** `package.json`, `pnpm-lock.yaml`.

- [ ] **TASK-002 — Estender `IntegrationProvider`**
  - **Acceptance:** Tipo `IntegrationProvider` em `integrations-repository.pg.ts` aceita `"3f-tasks"`. Nenhuma chamada existente quebra (verificar `meta` e `google-drive` em testes).
  - **Verify:** `pnpm check-types` passa. Buscar `IntegrationProvider` no codebase e confirmar que callers ainda compilam.
  - **Files:** `src/lib/db/pg/repositories/integrations-repository.pg.ts`.

- [ ] **TASK-003 — `workspace-resolver.ts`**
  - **Acceptance:** Função `extractWorkspaceFromToken(token: string): string` decodifica o payload JWT (base64 da parte central) e retorna o `workspace` UUID. Cache LRU `Map<token, workspace>` com TTL 5 min. Erro claro se token sem `workspace`.
  - **Verify:** Vitest `workspace-resolver.test.ts` cobrindo: token válido, token sem workspace, token malformado, cache hit, cache miss.
  - **Files:** `src/lib/3f-tasks/workspace-resolver.ts`, `src/lib/3f-tasks/workspace-resolver.test.ts`.

- [ ] **TASK-004 — `client.ts` (factory cacheado)**
  - **Acceptance:** Exporta `getRestClient(userId): Promise<RestClient>` e `getTxClient(userId): Promise<TxOperations>`. Lê token via `integrationsRepository.getToken(userId, "3f-tasks")`. Lê URL via `HUB_TRANSACTOR_URL`. Cacheia clientes por `userId` em `Map` (limpa em 30 min). Erro claro se token não existe.
  - **Verify:** Vitest mocka `integrationsRepository.getToken` e checa que `createRestClient`/`createRestTxOperations` são chamados com os args corretos.
  - **Files:** `src/lib/3f-tasks/client.ts`, `src/lib/3f-tasks/client.test.ts`.

- [ ] **TASK-005 — `auth.ts` (role gate + person ref)**
  - **Acceptance:** Exporta `getCurrentAccount(userId)`, `getCurrentPersonRef(userId)`, `requireRole(userId, minRole)`. Usa o mapeamento de roles do `construindo-mcp.md` linha 95-103. Cacheia `Account` por `userId` por 15 min.
  - **Verify:** Vitest cobrindo: User não pode chamar tool Maintainer, Maintainer pode, Admin pode. Erro de role traz mensagem em PT-BR clara.
  - **Files:** `src/lib/3f-tasks/auth.ts`, `src/lib/3f-tasks/auth.test.ts`.

- [ ] **TASK-006 — `formatters.ts`**
  - **Acceptance:** Exporta `PRIORITY_LABELS`, `CLIENT_STAGE_LABELS`, `PDCA_FREQUENCY_LABELS`, `formatTaskRow(t)`, `formatProjectRow(p)`, `formatMemberRow(m)`. Sem efeitos colaterais (puro).
  - **Verify:** Vitest 100% cobertura em `formatters.test.ts`.
  - **Files:** `src/lib/3f-tasks/formatters.ts`, `src/lib/3f-tasks/formatters.test.ts`.

- [ ] **TASK-007 — `.env.example` + doc**
  - **Acceptance:** `.env.example` ganha bloco `# === 3F Tasks Integration ===` com `HUB_TRANSACTOR_URL=https://3ftasks.3fventure.tech:3332` (default prod) e comentário pra dev (`http://localhost:3332`).
  - **Verify:** Visual.
  - **Files:** `.env.example`.

### Phase 2 — Read tools

Para cada uma das 8 tools de leitura abaixo, segue o mesmo formato: criar a entrada em `createTasks3FTools` + adicionar a entrada correspondente em `TOOL_ENHANCED_METADATA` + teste unitário com mock.

- [ ] **TASK-008 — `tasks3f_list_projects`**
  - **Acceptance:** Lista todos os projetos não arquivados do workspace. Retorna `[{id, name, identifier, description}]`. Input vazio (`z.object({})`).
  - **Verify:** Vitest mocka `client.findAll(tracker.class.Project, {archived: false})` e checa shape. Manual: `curl` ou via chat dev.
  - **Files:** `src/lib/3f-tasks/tools.ts`, `src/lib/ai/tools/tool-enhanced-metadata.ts`, `src/lib/3f-tasks/tools.test.ts`.
  - **Op type:** `read`. **Permissão:** User.

- [ ] **TASK-009 — `tasks3f_list_tasks`**
  - **Acceptance:** Aceita filtros `project_id` (obrigatório), `status_id`, `assignee_id`, `priority`, `client_name`, `client_stage`, `pdca_active`, `pdca_frequency`, `limit` (max 200, default 50). Retorna `[{id, identifier, title, status, priority, assignee, client_name, client_stage, pdca_active, due_date, overdue}]`.
  - **Verify:** Vitest cobre filtros combinados. Manual: chat "lista as tarefas do projeto X com prioridade alta".
  - **Files:** mesmos arquivos.
  - **Op type:** `read`. **Permissão:** User. **Deps:** `tasks3f_list_projects` (resolve project_id).

- [ ] **TASK-010 — `tasks3f_get_task`**
  - **Acceptance:** Obrigatório `task_id` (UUID). Retorna o issue completo + comentários (joins chunter.class.ChatMessage via `findAll({attachedTo: task_id})`) + subtarefas (count + lista resumida).
  - **Verify:** Vitest. Manual: chat "detalhes da tarefa SEEDP-42" (LLM resolve identifier→id via `list_tasks` antes).
  - **Files:** mesmos.
  - **Op type:** `read`. **Permissão:** User.

- [ ] **TASK-011 — `tasks3f_list_statuses`**
  - **Acceptance:** Obrigatório `project_id`. Retorna `[{id, name, category}]` para os status permitidos pelo SpaceType do projeto (lógica em `projetos.md` linha 87-94).
  - **Verify:** Vitest. Manual: chat "quais status posso usar no projeto X".
  - **Files:** mesmos.
  - **Op type:** `read`. **Permissão:** User. **Deps:** `tasks3f_list_projects`.

- [ ] **TASK-012 — `tasks3f_list_members`**
  - **Acceptance:** Opcional `project_id` (filtra pra membros daquele projeto, senão lista todos do workspace). Retorna `[{person_ref, name, primary_email, is_active}]`.
  - **Verify:** Vitest. Manual: chat "quem são os membros do projeto X".
  - **Files:** mesmos.
  - **Op type:** `read`. **Permissão:** User.

- [ ] **TASK-013 — `tasks3f_list_pending_tasks`**
  - **Acceptance:** Lista tarefas pendentes (`isDone: { $ne: true }`) do dono do token (resolvido via `getCurrentPersonRef`). Opcional `project_id`. Ordena por `dueDate ASC`. Retorna mesma shape de `list_tasks` + flag `overdue`.
  - **Verify:** Vitest. Manual: chat "minhas pendências".
  - **Files:** mesmos.
  - **Op type:** `read`. **Permissão:** User. **Sem deps**.

- [ ] **TASK-014 — `tasks3f_list_pending_tasks_by_user`**
  - **Acceptance:** Obrigatório `person_ref` (Ref<Person>). Opcional `project_id`. Mesma shape de `list_pending_tasks`. **Chama `requireRole(userId, AccountRole.Maintainer)` antes** — falha com erro claro se role insuficiente.
  - **Verify:** Vitest com 2 fixtures de role (User → erro, Maintainer → sucesso).
  - **Files:** mesmos.
  - **Op type:** `read`. **Permissão:** Maintainer. **Deps:** `tasks3f_list_members` (resolve `person_ref` a partir de nome).

- [ ] **TASK-015 — `tasks3f_find_overdue_tasks`**
  - **Acceptance:** Opcional `project_id`, `client_name`. Hard cap de 500 resultados. Retorna tarefas com `dueDate < now()` E `isDone !== true`. Ordena por `dueDate ASC`. Inclui campo `days_overdue`.
  - **Verify:** Vitest cobrindo cap e ordenação. Manual.
  - **Files:** mesmos.
  - **Op type:** `read`. **Permissão:** User.

### Phase 3 — Write tools

- [ ] **TASK-016 — `tasks3f_create_task`**
  - **Acceptance:** Obrigatórios: `project_id`, `title`, `client_name`, `client_stage`. Opcionais: `status_id` (default = `defaultIssueStatus` do projeto), `priority` (default 3=Média), `assignee_id`, `estimation` (horas), `due_date` (ISO 8601), `pdca_active`, `pdca_frequency`. Cria via `createDoc` com TODOS os campos obrigatórios do Issue (atendendo `tarefas.md` linha 158-199). Retorna `{id, identifier, message}`.
  - **Verify:** Vitest mocka `createDoc`. Manual: criar tarefa no dev e validar na UI.
  - **Files:** mesmos.
  - **Op type:** `write`. **Permissão:** User. **Deps:** `tasks3f_list_projects`, `tasks3f_list_statuses`, `tasks3f_list_members`.

- [ ] **TASK-017 — `tasks3f_update_task`**
  - **Acceptance:** Obrigatórios `task_id`, `project_id`. Opcionais: `status_id`, `priority`, `assignee_id`, `title`, `estimation`, `reported_time`, `due_date`. Retorna `{message}`.
  - **Verify:** Vitest. Manual.
  - **Files:** mesmos.
  - **Op type:** `write`. **Permissão:** User.

- [ ] **TASK-018 — `tasks3f_add_comment`**
  - **Acceptance:** Obrigatórios `task_id`, `project_id`, `message` (plain text na v1). Usa `addCollection(chunter.class.ChatMessage, project_id, task_id, tracker.class.Issue, 'comments', {message, attachments:0})`.
  - **Verify:** Vitest. Manual.
  - **Files:** mesmos.
  - **Op type:** `write`. **Permissão:** User.

- [ ] **TASK-019 — `tasks3f_duplicate_task`**
  - **Acceptance:** Obrigatórios `task_id`, `project_id` (origem). Opcional `target_project_id` (default = mesmo projeto). Lê issue origem, cria nova via `createDoc` propagando: `title` (com sufixo " (cópia)"), `priority`, `assignee`, `estimation`, `clientName`, `clientStage`, campos PDCA. Reset: `status` = defaultIssueStatus do destino, `reportedTime=0`, `remainingTime=estimation`, `completedDate=null`, sem subtarefas, sem comentários. Retorna `{id, identifier, message}`.
  - **Verify:** Vitest cobrindo: mesma sala, sala diferente, sem campos opcionais.
  - **Files:** mesmos.
  - **Op type:** `write`. **Permissão:** User. **Deps:** `tasks3f_list_projects`.

- [ ] **TASK-020 — `tasks3f_create_subtask`**
  - **Acceptance:** Obrigatórios `parent_task_id`, `project_id`, `title`, `client_name`, `client_stage`. Demais opcionais (mesma shape de `create_task`). Usa `addCollection` com `attachedToClass = tracker.class.Issue` e `collection = 'subIssues'` (espelha `tarefas.md` linha 208).
  - **Verify:** Vitest. Manual: criar subtarefa e validar contagem `subIssues` do pai.
  - **Files:** mesmos.
  - **Op type:** `write`. **Permissão:** User.

- [ ] **TASK-021 — `tasks3f_log_time`**
  - **Acceptance:** Obrigatórios `task_id`, `project_id`, `hours` (number > 0). Soma `hours` ao `reportedTime` da issue via `updateDoc`. Retorna `{previous_reported, new_reported, message}`.
  - **Verify:** Vitest. Manual.
  - **Files:** mesmos.
  - **Op type:** `write`. **Permissão:** User.

### Phase 4 — Registro + integração

- [ ] **TASK-022 — Plugar toolkit em `tool-kit.ts`**
  - **Acceptance:** `AppDefaultToolkit.Tasks3F` adicionado em `index.ts`. Entry `[AppDefaultToolkit.Tasks3F]: createTasks3FTools(userId)` em `tool-kit.ts`.
  - **Verify:** Em runtime, `Object.keys(APP_DEFAULT_TOOL_KIT.tasks3f).length === 14`.
  - **Files:** `src/lib/ai/tools/index.ts`, `src/lib/ai/tools/tool-kit.ts`.

- [ ] **TASK-023 — Cadastrar 14 entradas em `TOOL_ENHANCED_METADATA`**
  - **Acceptance:** Cada tool com `toolkit: "tasks3f"`, `operationType` correto, `description` rica, `auxiliaryPrompt` quando precisa de regras, `prerequisiteTools` apontando para as deps documentadas na seção 2.2.
  - **Verify:** Importar `TOOL_ENHANCED_METADATA` num teste e validar que 14 chaves `tasks3f_*` existem com `toolkit === "tasks3f"`.
  - **Files:** `src/lib/ai/tools/tool-enhanced-metadata.ts`.

- [ ] **TASK-024 — `scripts/embed-tasks3f-tools.ts`**
  - **Acceptance:** Espelha `scripts/embed-meta-get-insights.ts`. Itera sobre as 14 entradas de `TOOL_ENHANCED_METADATA` filtradas por `toolkit === "tasks3f"`, gera embedding via `generateEmbedding(description)` e chama `pgToolVectorRepository.upsert()`. Idempotente.
  - **Verify:** Rodar `pnpm tsx scripts/embed-tasks3f-tools.ts` no dev. Confirmar via SQL `SELECT name FROM tool_vector WHERE toolkit='tasks3f'` (14 rows).
  - **Files:** `scripts/embed-tasks3f-tools.ts`.

- [ ] **TASK-025 — Card "3F Tasks" no `/connections`**
  - **Acceptance:** Componente novo `3f-tasks-card.tsx` no `src/app/(chat)/connections/`. Card visualmente análogo ao card do Meta. Botão "Conectar" abre modal com link pra UI do 3F Tasks (`https://3ftasks.3fventure.tech/workbench/3fventure/setting/setting/general`) e input pra colar o token. Botão "Desconectar" remove via `integrationsRepository.deleteToken`. Status badge: Conectado/Desconectado.
  - **Verify:** Manual no `/connections`: colar token de teste, lista de tools fica disponível no chat.
  - **Files:** `src/app/(chat)/connections/3f-tasks-card.tsx`, `src/app/(chat)/connections/page.tsx` (registrar card), eventual route handler para `POST /api/integrations/3f-tasks`.

- [ ] **TASK-026 — Habilitar toolkit por feature flag para user.metaAdsEnabled-like check**
  - **Acceptance:** Toolkit `tasks3f` só aparece como `enabled` em `route.ts` quando `userRepository.isTasks3FEnabled(userId)` retorna true (campo novo no `UserTable`, default false até o usuário conectar). Padrão espelha o `userMetaAdsEnabled`.
  - **Verify:** Usuário sem token vê tools fora; com token, tools entram.
  - **Files:** `src/lib/db/pg/repositories/user-repository.pg.ts`, `src/lib/db/pg/schema.pg.ts` (campo `tasks3fEnabled: boolean`), `src/app/api/chat/route.ts`.
  - **NOTA:** Se decidir-se em revisão que basta a presença do token em `integrationsRepository`, esta task pode ser dispensada (consultar `getToken(userId, "3f-tasks") !== null` no `route.ts`). **Discutir antes de implementar.**

### Phase 5 — Testes finais + ship

- [ ] **TASK-027 — Smoke E2E**
  - **Acceptance:** `tests/3f-tasks-toolkit.spec.ts` cobre o fluxo: login → /connections → colar token → ir pro /chat → "lista meus projetos no 3F Tasks" → resposta contém ≥ 1 projeto.
  - **Verify:** `pnpm test:e2e tests/3f-tasks-toolkit.spec.ts` passa.
  - **Files:** `tests/3f-tasks-toolkit.spec.ts`.

- [ ] **TASK-028 — Atualizar CHANGELOG**
  - **Acceptance:** Entrada no `CHANGELOG.md` descrevendo o toolkit, as 14 tools, e as env vars novas.
  - **Verify:** Visual.
  - **Files:** `CHANGELOG.md`.

- [ ] **TASK-029 — Atualizar docs**
  - **Acceptance:** `3f-docs/llm-tools.md` ganha a categoria "Tasks3F" na tabela de toolkits, com link pra este plano e pra `construindo-mcp.md` (que vira documentação de referência da API REST, não mais "como construir um MCP").
  - **Verify:** Visual.
  - **Files:** `3f-docs/llm-tools.md`.

- [ ] **TASK-030 — Revisão de Open Questions Q1-Q6**
  - **Acceptance:** Todas as Open Questions da seção 1.9 resolvidas com decisão registrada no PR ou neste arquivo.
  - **Verify:** Checklist do PR mostra "Open Questions: resolved".
  - **Files:** este `.md` (atualizado).

---

## 4. Tool catalog — Resumo executivo

Tabela de referência rápida das 14 tools para o reviewer:

| # | Tool name | Op | Permissão | Inputs principais | Endpoint API REST 3F Tasks | Deps (prereqs) |
|---|-----------|----|-----------|-------------------|----------------------------|----------------|
| 1 | `tasks3f_list_projects` | read | User | (vazio) | `/api/v1/find-all` (`tracker.class.Project`) | — |
| 2 | `tasks3f_list_tasks` | read | User | `project_id`, filtros | `/api/v1/find-all` (`tracker.class.Issue`) | `tasks3f_list_projects` |
| 3 | `tasks3f_get_task` | read | User | `task_id` | `/api/v1/find-all` (`Issue` + `ChatMessage`) | `tasks3f_list_tasks` |
| 4 | `tasks3f_create_task` | write | User | `project_id`, `title`, `client_name`, `client_stage` | `/api/v1/tx` (TxCreateDoc) | `list_projects`, `list_statuses`, `list_members` |
| 5 | `tasks3f_update_task` | write | User | `task_id`, `project_id`, campos a alterar | `/api/v1/tx` (TxUpdateDoc) | `list_tasks` |
| 6 | `tasks3f_add_comment` | write | User | `task_id`, `project_id`, `message` | `/api/v1/tx` (TxCollectionCUD ChatMessage) | `list_tasks` |
| 7 | `tasks3f_duplicate_task` | write | User | `task_id`, `project_id`, opc `target_project_id` | `find-all` + `tx` | `list_tasks`, `list_projects` |
| 8 | `tasks3f_list_pending_tasks_by_user` | read | **Maintainer** | `person_ref`, opc `project_id` | `find-all` (`Issue` + role check em `/api/v1/account`) | `list_members` |
| 9 | `tasks3f_list_pending_tasks` | read | User | opc `project_id` | `find-all` + `getCurrentPersonRef` | — |
| 10 | `tasks3f_create_subtask` | write | User | `parent_task_id`, `project_id`, `title`, `client_name`, `client_stage` | `tx` (TxCollectionCUD em `subIssues`) | `list_tasks` |
| 11 | `tasks3f_log_time` | write | User | `task_id`, `project_id`, `hours` | `tx` (TxUpdateDoc `reportedTime`) | `list_tasks` |
| 12 | `tasks3f_list_members` | read | User | opc `project_id` | `find-all` (`contact.mixin.Employee` + `Person`) | — |
| 13 | `tasks3f_list_statuses` | read | User | `project_id` | `find-all` (`task.class.TaskType` + `IssueStatus`) | `list_projects` |
| 14 | `tasks3f_find_overdue_tasks` | read | User | opc `project_id`, `client_name` | `find-all` (Issue + filtro `dueDate < now`) | — |

---

## 5. Dependências externas

- **DEP-001:** `@hcengineering/api-client` — **não instalado**, adicionar.
- **DEP-002:** 3F Tasks rodando em URL conhecida — confirmar `HUB_TRANSACTOR_URL` antes do dev.
- **DEP-003:** Pelo menos um token de teste com role `Maintainer` no workspace `3fventure` — pra testar `pending_tasks_by_user`.
- **DEP-004:** Pelo menos um token de teste com role `User` simples — pra testar gate.
- **DEP-005:** OpenAI `text-embedding-3-small` (já em uso) — pra TASK-024.

---

## 6. Files (resumo)

| Arquivo | NOVO/EDIT | Motivo |
|---------|-----------|--------|
| `package.json`, `pnpm-lock.yaml` | EDIT | TASK-001 |
| `src/lib/db/pg/repositories/integrations-repository.pg.ts` | EDIT | TASK-002 (provider) |
| `src/lib/3f-tasks/client.ts` | NOVO | TASK-004 |
| `src/lib/3f-tasks/workspace-resolver.ts` | NOVO | TASK-003 |
| `src/lib/3f-tasks/auth.ts` | NOVO | TASK-005 |
| `src/lib/3f-tasks/formatters.ts` | NOVO | TASK-006 |
| `src/lib/3f-tasks/tools.ts` | NOVO | TASK-008 a TASK-021 |
| `src/lib/3f-tasks/*.test.ts` | NOVO | Testes unitários |
| `src/lib/ai/tools/index.ts` | EDIT | TASK-022 |
| `src/lib/ai/tools/tool-kit.ts` | EDIT | TASK-022 |
| `src/lib/ai/tools/tool-enhanced-metadata.ts` | EDIT | TASK-023 |
| `scripts/embed-tasks3f-tools.ts` | NOVO | TASK-024 |
| `src/app/(chat)/connections/3f-tasks-card.tsx` | NOVO | TASK-025 |
| `src/app/(chat)/connections/page.tsx` | EDIT | TASK-025 (registrar) |
| `src/app/api/integrations/3f-tasks/route.ts` | NOVO | TASK-025 (POST/DELETE token) |
| `src/lib/db/pg/repositories/user-repository.pg.ts` | EDIT (opc) | TASK-026 |
| `src/lib/db/pg/schema.pg.ts` | EDIT (opc) | TASK-026 (campo `tasks3fEnabled`) |
| `src/app/api/chat/route.ts` | EDIT | TASK-026 (gate na lista de toolkits ativos) |
| `tests/3f-tasks-toolkit.spec.ts` | NOVO | TASK-027 |
| `.env.example` | EDIT | TASK-007 |
| `CHANGELOG.md` | EDIT | TASK-028 |
| `3f-docs/llm-tools.md` | EDIT | TASK-029 |

Total: **9 arquivos novos + 11 arquivos editados** (TASK-026 pode reduzir em -3 arquivos editados).

---

## 7. Out of scope (v1)

Explicitamente fora desta primeira leva, para evitar scope creep:

- **Real-time updates** — webhooks/SSE do 3F Tasks pro 3F OS. (Fica pra v2 se necessário.)
- **Bulk operations** — `tasks3f_bulk_create_tasks`, `tasks3f_bulk_update_status`. (Pode ser pedido depois.)
- **Time tracking avançado** — relatórios por usuário/período. (Apenas `log_time` na v1.)
- **Anexos** — upload de arquivos a tarefas via storage do 3F OS. (Complexo; futura iteração.)
- **Edição rica de description (Yjs/Collaborator)** — `add_comment` resolve o caso comum.
- **Workflow de aprovação** — criar tarefa que dispara workflow XYFlow no 3F OS. (Integração separada.)
- **Sincronização bidirecional** — espelhar tarefas do 3F OS no 3F Tasks ou vice-versa. (Não pedido.)
- **OAuth flow** — só token manual na v1; OAuth requer mudanças no Account Service do 3F Tasks.

---

## 8. Definition of Done

Toolkit `tasks3f` está "done" quando:

1. Todas as 30 tasks marcadas como done.
2. Todos os 10 critérios SC-01 a SC-10 verificados.
3. PR aprovado por ao menos 1 revisor.
4. `pnpm check` verde no CI.
5. Smoke test E2E (TASK-027) passa.
6. CHANGELOG e docs atualizados.
7. Embeddings populados no `tool_vector` em prod (rodar TASK-024 com `.env` de prod ou via migration de seed).
8. Pelo menos 3 pessoas reais usaram o toolkit em chats de dev por 24h sem reportar bug crítico.

---

## 9. Referências

- `3f-docs/3F Tasks - knowledge/README.md` — visão geral do 3F Tasks
- `3f-docs/3F Tasks - knowledge/autenticacao.md` — fluxo do token
- `3f-docs/3F Tasks - knowledge/api-rest.md` — endpoints e payloads
- `3f-docs/3F Tasks - knowledge/tarefas.md` — modelo do Issue
- `3f-docs/3F Tasks - knowledge/projetos.md` — modelo do Project + members
- `3f-docs/3F Tasks - knowledge/construindo-mcp.md` — implementação MCP (referência da lógica, mesmo não sendo o caminho escolhido)
- `3f-docs/3F Tasks - knowledge/tools-to-create.md` — escopo original (9 tools)
- `3f-docs/llm-tools.md` — como tools nativas funcionam no 3F OS
- `src/lib/meta/tools.ts` — referência de toolkit nativo grande
- `src/lib/google-drive/tools.ts` — referência de toolkit OAuth-style
- `scripts/embed-meta-get-insights.ts` — template do seed do `tool_vector`

---

*Plano gerado seguindo a skill `spec-driven-development` em `3f-docs/3F Tasks - knowledge/plan/SKILL.md` em 2026-05-18.*
