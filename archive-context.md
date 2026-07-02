# Archive Context — 3F Tasks (huly-3f)

Guia de orientação estrutural do monorepo para uso por agentes de IA.
Leia este arquivo antes de qualquer tarefa de desenvolvimento. Ele complementa o `CLAUDE.md` (regras de negócio) e o `ARCHITECTURE_OVERVIEW.md` (infraestrutura de serviços).

---

## 1. Visão geral do monorepo

O repositório é um monorepo gerenciado por **Rush + pnpm** com ~481 pacotes. Cada domínio de produto (tracker, chat, HR, etc.) é implementado como um **plugin triple**: três pacotes coordenados.

```
huly-3f/
├── foundations/          # Infraestrutura base (core, server, storage, etc.)
├── models/               # Definições de schema por domínio (~96 pacotes)
├── plugins/              # Código frontend por domínio (~194 pacotes)
├── server-plugins/       # Extensões server-side por domínio (~65 pacotes)
├── server/               # Servidores backend standalone (transactor, account, etc.)
├── services/             # Microserviços independentes (worker, process, billing, etc.)
├── pods/                 # Entrypoints de deploy Docker (agrupam server + plugins)
├── dev/                  # Tooling de desenvolvimento (docker-compose, nginx, storybook)
├── 3f-docs/              # Documentação interna do fork 3F
├── automation/           # Scripts de automação por BU (Seed, Bomma, Impulse)
├── templates/            # Templates Rush para criar novos pacotes
├── tests/ / ws-tests/    # Testes e2e (Playwright/sanity)
├── common/               # Configurações compartilhadas Rush (git-hooks, scripts)
├── rush.json             # Registry master de pacotes do monorepo
├── CLAUDE.md             # Regras de negócio e contexto 3F
├── ARCHITECTURE_OVERVIEW.md  # Infraestrutura de serviços e portas
└── 3f-docs/AGENT_RULES.md    # Regras obrigatórias para agentes
```

---

## 2. O padrão Plugin Triple

Todo domínio de produto segue este padrão de três pacotes:

```
plugins/tracker/          → Tipos TypeScript + IDs de plugin (frontend-agnostic)
plugins/tracker-resources/→ Componentes Svelte + lógica de UI
models/tracker/           → Definição de schema (@Model, @Prop, migrations)

# Bônus: extensão server-side
server-plugins/tracker/   → Triggers, validators e lógica de servidor
```

### Regra de importação
- `plugins/X` só importa de `foundations/` e outros `plugins/`
- `models/X` importa de `plugins/X` e `foundations/core/packages/model`
- `server-plugins/X` importa de `plugins/X`, `models/X` e `foundations/server`
- `services/` são independentes e comunicam via HTTP/Kafka

---

## 3. `foundations/` — Infraestrutura base

Pacotes que todo o resto depende. **Não edite sem necessidade — qualquer quebra afeta o sistema inteiro.**

### `foundations/core/packages/`

| Pacote | Função |
|--------|--------|
| `core` | Interfaces base: `Doc`, `AttachedDoc`, `Tx`, `Space`, `Ref`, `Class`, `Mixin` |
| `model` | Builder de modelos + decorators: `@Model`, `@Prop`, `@Mixin`, `@Index`, `@UX` |
| `platform` | Geração de IDs de plugin (`plugin:kind:name`), internacionalização |
| `client` | Cliente WebSocket para o transactor |
| `storage` | Interface de storage de blobs |
| `query` | Motor de query reativa no cliente |
| `api-client` | REST client para operações no workspace |
| `token` | Geração e validação de JWT |
| `text` / `text-core` / `text-markdown` / `text-ydoc` | Processamento de texto rico (Yjs/ProseMirror) |
| `rank` | Ordenação lexicográfica de documentos |
| `rpc` | Camada de RPC entre serviços |
| `measurements` | Métricas e observabilidade interna |

**Arquivo mais crítico:** `foundations/core/packages/core/src/classes.ts` — interfaces base de `Doc`, `Space`, `Tx`, etc.

**Sistema de transações:** `foundations/core/packages/core/src/tx.ts` — toda mutação é uma `Tx`. Nunca edite o banco diretamente.

### `foundations/server/packages/`

| Pacote | Função |
|--------|--------|
| `server` | Interfaces e tipos do servidor (pipeline, middleware) |
| `core` | Infraestrutura do transactor (contexto, storage, triggers) |
| `middleware` | Middlewares de permissão e pipeline |
| `mongo` / `postgres` / `cockroach` | Adaptadores de banco de dados |
| `elastic` | Adaptador Elasticsearch |
| `kafka` | Adaptador Redpanda/Kafka |
| `minio` / `s3` | Adaptadores de object storage |
| `datalake` / `hulylake` | Adaptadores de blob storage proprietários |
| `collaboration` | Integração Yjs para edição colaborativa |

### `foundations/communication/packages/`

| Pacote | Função |
|--------|--------|
| `server` | Servidor de comunicação em tempo real |
| `shared` / `types` | Tipos compartilhados de comunicação |
| `rest-client` / `cockroach` | Clientes de acesso à comunicação |

### `foundations/net/packages/`
Backrpc, client, core, server — camada de rede de baixo nível.

### `foundations/utils/packages/`
Utilitários de plataforma e testes de UI.

---

## 4. `models/` — Schemas por domínio

Cada pacote `models/X` define o schema de banco de dados de um domínio usando os decorators do `foundations/core/packages/model`.

### Estrutura interna padrão

```
models/tracker/src/
├── types.ts      → Classes com @Model/@Prop/@Mixin (schema real)
├── plugin.ts     → IDs de objetos de configuração
├── migration.ts  → Migrations de schema (createMigration())
├── actions.ts    → Ações de UI registradas no model
├── presenters.ts → Mapeamento tipo → componente Svelte
├── viewlets.ts   → Configurações de views (list, kanban, groupBy)
├── permissions.ts→ Permissões declaradas no model
└── index.ts      → Exporta `createModel(builder)` — entry point
```

### Registro obrigatório
Todo model deve ser registrado em `models/all/src/index.ts`. Este é o **registry master** — erro aqui quebra o build inteiro.

### Modelos mais relevantes para o 3F Tasks

| Pacote | O que define |
|--------|-------------|
| `models/tracker` | Issue, Project, Component, Milestone, IssueTemplate, TimeSpendReport, CompletionRule |
| `models/task` | Task, TaskProject, TaskType, ProjectType, Status (base que tracker estende) |
| `models/contact` | Person, Member, Channel (base para Employee) |
| `models/core` | Configurações base de espaços e permissões |
| `models/chunter` | Channel, DirectMessage (Chat 3F) |
| `models/hr` | Department, Member, PTO (RH) |
| `models/notification` | NotificationSetting, Inbox |
| `models/calendar` | Event, CalendarSpace |
| `models/document` | TeamSpace, Document (Documentos/Teamspace) |
| `models/setting` | SettingsPage, Integration |
| `models/all` | **Registry master** — importa e registra todos os models |

---

## 5. `plugins/` — Frontend por domínio

Cada domínio tem até três pacotes frontend:

```
plugins/tracker/           → Tipos TS públicos + IDs de UI (sem Svelte)
plugins/tracker-assets/    → Ícones e assets estáticos (SVG, etc.)
plugins/tracker-resources/ → Componentes Svelte + lógica de UI
```

### `plugins/tracker/` — Tipos e IDs

**`src/index.ts`** — Define as interfaces TypeScript do domínio:

- `Issue` — Tarefa principal (estende `Task`)
- `Project` — Projeto do tracker (estende `TaskProject`)
- `Component` — Agrupador por cliente dentro do projeto
- `Milestone` — Sprint
- `IssueStatus` — Status de issue (estende `Status`)
- `IssueTemplate` — Template de issue
- `TimeSpendReport` — Lançamento de tempo gasto
- `CompletionRule` / `IssueCompletionConfig` — Validação de conclusão
- `PdcaFrequency` — enum: `weekly | biweekly | monthly | quarterly`
- `ClientStage` — enum: `onboarding | expansion | retention | churned`

### `plugins/tracker-resources/` — UI do Tracker

```
src/components/
├── issues/                  → Componentes de issue (list item, editor, kanban)
│   ├── EditIssue.svelte     → Painel lateral de edição de issue
│   ├── IssueItem.svelte     → Linha de issue na list view
│   ├── IssuesView.svelte    → Container da view de issues
│   ├── KanbanView.svelte    → View Kanban
│   ├── PdcaCycleSection.svelte → Seção de configuração do ciclo PDCA
│   ├── ClientNamePresenter.svelte → Campo "Nome do Cliente"
│   ├── ClientStagePresenter/Selector → Campo "Etapa"
│   ├── DueDateEditor/Presenter → Editor de due date
│   ├── StartDateEditor.svelte → Editor de start date
│   ├── CompletedDateEditor.svelte → Data de finalização
│   ├── AssigneeEditor.svelte → Editor de responsável
│   ├── PriorityEditor.svelte → Editor de prioridade
│   ├── StatusEditor/Presenter → Editor e presenter de status
│   └── timereport/          → Componentes de lançamento de tempo
│       ├── TimeSpendReport.svelte
│       ├── EstimationEditor.svelte
│       └── ReportedTimeEditor.svelte
├── issues/edit/             → Sub-painéis do EditIssue
│   ├── ControlPanel.svelte  → Painel de campos laterais
│   ├── SubIssueList.svelte  → Lista de sub-issues
│   └── SubIssues.svelte     → Container de sub-issues
├── milestones/              → Componentes de Sprint/Milestone
│   ├── Milestones.svelte    → Lista de sprints
│   ├── EditMilestone.svelte → Editor de sprint
│   └── MilestoneSelector.svelte
├── projects/                → Componentes de Projeto
│   └── CreateProject.svelte
├── settings/                → Configurações do Tracker
│   ├── NewClientOnboardingModal.svelte → Modal de onboarding de cliente
│   ├── AutomationScriptsPage.svelte    → Página de automações
│   └── onboarding-config.ts           → Configuração de templates de onboarding
└── myissues/                → View "Minhas Issues"
    └── MyIssues.svelte
```

### Outros plugins relevantes

| Plugin | Pacote resources | O que faz na UI |
|--------|-----------------|-----------------|
| `workbench` | `workbench-resources` | Shell principal: sidebar, navegação, roteamento de espaços |
| `chunter` | `chunter-resources` | Chat 3F — canais, DMs, threads |
| `view` | `view-resources` | Sistema de views genérico (list, kanban, groupBy, filtros) |
| `contact` | `contact-resources` | Gerenciamento de contatos e membros |
| `setting` | `setting-resources` | Páginas de configurações, integrations, Space Types |
| `task` | `task-resources` | Base genérica de tasks (estendida pelo tracker) |
| `hr` | `hr-resources` | RH — departamentos, membros, PTO |
| `calendar` | `calendar-resources` | Calendário, eventos, visualizações |
| `notification` | `notification-resources` | Caixa de entrada, notificações |
| `onboard` | `onboard-resources` | Fluxo de onboarding de novo usuário/workspace |
| `time` | `time-resources` | Planner — ToDos, planejamento pessoal |
| `recruit` | `recruit-resources` | Recrutamento |
| `document` | `document-resources` | Documentos/Teamspace (Yjs) |

---

## 6. `server-plugins/` — Lógica server-side por domínio

Extensões que rodam dentro do transactor (servidor principal). Executam triggers, validators e hooks quando documentos são criados/modificados.

### Estrutura interna padrão

```
server-plugins/tracker/src/
└── index.ts   → Registra triggers: OnCreate, OnUpdate, OnDelete de Issues
```

### Responsabilidades típicas

- **Triggers OnCreate:** preencher campos derivados (ex: `sequence`, timestamps automáticos)
- **Triggers OnUpdate:** propagar mudanças para documentos filhos (ex: mover sub-issues)
- **Validators:** bloquear transações inválidas (ex: impedir conclusão sem spent time)
- **Notification handlers:** disparar notificações quando status muda

### Server-plugins mais relevantes para o 3F Tasks

| Pacote | Responsabilidade |
|--------|-----------------|
| `server-plugins/tracker` | Triggers de Issue: sequences, parents, childInfo, notificações |
| `server-plugins/task` | Triggers base de Task (herdado pelo tracker) |
| `server-plugins/notification` | Envio de notificações por mudança de doc |
| `server-plugins/activity` | Feed de atividade por documento |
| `server-plugins/collaboration` | Integração Yjs para campos `description` |
| `server-plugins/contact` | Triggers de membros e canais |

---

## 7. `server/` — Servidores backend

Servidores Node.js standalone que formam o backend da plataforma.

| Pasta | Responsabilidade |
|-------|-----------------|
| `server/server-pipeline/` | **Transactor** — motor central de transações. Recebe Tx via WebSocket, valida, persiste no CockroachDB, publica no Redpanda. Arquivo crítico: `src/serverPlugins.ts` (registra todos os server-plugins) |
| `server/account-service/` | Serviço de autenticação — login, JWT, workspaces |
| `server/workspace-service/` | Lifecycle de workspaces — criação, upgrade, manutenção |
| `server/collaborator/` | Servidor Yjs — edição colaborativa em tempo real de documentos ricos |
| `server/front/` | Servidor estático + proxy do frontend Svelte |
| `server/indexer/` | Indexador de full-text search |
| `server/backup/` | Serviço de backup automático |
| `server/tool/` | CLI de administração (criação de workspace, migrações manuais) |

---

## 8. `services/` — Microserviços independentes

Serviços Node.js isolados que rodam fora do transactor. Comunicam via HTTP ou consumindo eventos do Redpanda/Kafka.

| Serviço | Porta | Função |
|---------|-------|--------|
| `worker` | — | **Serviço PDCA** — agenda e cria issues recorrentes via ciclo PDCA. Arquivos: `pdca.ts`, `worker.ts`, `db.ts` |
| `process` | — | Motor de automação de workflows e processos |
| `notification` | — | Envio de notificações push/email |
| `calendar` | — | Integração de calendário externo |
| `billing` | — | Integração de pagamentos |
| `datalake` | 4030 | Gerenciamento de blobs/arquivos com metadados |
| `print` | 4005 | Geração de PDF |
| `sign` | 4006 | Assinatura digital de documentos |
| `export` | 4009 | Exportação de dados do workspace |
| `ai-bot` | 4010 | Integração com IA |
| `github` | — | Integração GitHub |
| `gmail` | — | Integração Gmail |
| `telegram` / `telegram-bot` | — | Integração Telegram |
| `translate` | — | Tradução automática |
| `rekoni` | 4004 | Extração de texto de PDFs, DOCXs (parsing de currículos) |
| `analytics-collector` | 4017 | Coleta de eventos de analytics |
| `rating` | — | Métricas de qualidade de conteúdo |
| `hulykvs` | 8094 | Key-value store rápido |
| `mail` | — | Serviço de e-mail |
| `love` | — | Videoconferência LiveKit |
| `backup` | — | Backup automático periódico |

### Serviço worker (PDCA) — detalhes

```
services/worker/src/
├── index.ts    → Entry point — chama runWorker()
├── worker.ts   → Loop principal — poll de issues com PDCA ativo
├── pdca.ts     → Lógica de cálculo de próximo ciclo e criação de issue
├── db.ts       → Acesso direto ao CockroachDB para queries PDCA
├── activities.ts → Registro de atividades do ciclo
└── config.ts   → Variáveis de ambiente (DB_URL, ACCOUNTS_URL, etc.)
```

---

## 9. `pods/` — Entrypoints de deploy

Cada pod é um container Docker que agrupa um servidor + seus plugins registrados. É aqui que os servidores são "montados" para produção.

| Pod | O que monta |
|-----|-------------|
| `pods/server` | Transactor principal (server-pipeline + todos os server-plugins) |
| `pods/front` | Frontend Svelte (front server + todos os plugins de UI) |
| `pods/account` | Serviço de account/auth |
| `pods/workspace` | Gerenciamento de workspaces |
| `pods/collaborator` | Servidor Yjs de colaboração |
| `pods/fulltext` | Indexador de busca full-text |
| `pods/backup` | Serviço de backup |
| `pods/preview` | Geração de thumbnails |
| `pods/media` | Processamento de mídia |
| `pods/embeddings` | Serviço de embeddings para IA |
| `pods/stats` | Coleta de métricas |
| `pods/external` | Integrações externas |
| `pods/link-preview` | Preview de links |
| `pods/authProviders` | Provedores de autenticação OAuth |

---

## 10. `dev/` — Tooling de desenvolvimento

```
dev/
├── prod/            → Entry point de desenvolvimento local
│   └── src/
│       ├── platform.ts      → Registra TODOS os plugins via addLocation() — crítico
│       ├── platform-dev.ts  → Versão dev com HMR
│       └── main.ts          → Entry point do bundle frontend
├── docker-compose/  → (via dev/local-mongo, dev/nginx, etc.)
├── nginx/           → Configuração Nginx para proxy local
├── livekit/         → Configuração LiveKit para videoconferência
├── scripts/         → Scripts de build e deploy auxiliares
├── tool/            → CLI de admin local
├── storybook/       → Storybook para componentes UI
├── import-tool/     → Ferramenta de importação de dados
├── doc-import-tool/ → Importação de documentos
└── nlp/             → Processamento de linguagem natural
```

**`dev/prod/src/platform.ts`** — arquivo crítico: qualquer plugin sem `addLocation()` aqui não carrega na UI.

---

## 11. `3f-docs/` — Documentação interna 3F

```
3f-docs/
├── AGENT_RULES.md      → Regras obrigatórias para agentes de IA (leia sempre)
├── BUILD_AND_DEPLOY.md → Como fazer build e deploy na VPS
├── desenvolvimento.md  → Guia de desenvolvimento local
├── features/           → Especificações de features em desenvolvimento
│   ├── F01-issue-completion-validation/
│   ├── F02-tag-based-sharing/
│   ├── F04-pdca-cycle/
│   ├── F09-client-fields/
│   └── colunas-por-space-type/
├── plans/              → Planos de implementação
│   ├── 01-pdca-cycle.md
│   ├── 02-completion-validation.md
│   ├── 03-automatic-dates.md
│   └── 05-tag-sharing.md
├── fixes/              → Registros de correções
├── revision/           → Revisões e ajustes de UI
└── vps_problem/        → Logs de problemas na VPS
```

---

## 12. `automation/` — Scripts de automação por BU

Scripts TypeScript que usam o `@hcengineering/api-client` para criar issues programaticamente via REST API. Usados para onboarding de clientes.

```
automation/
├── Seed/
│   ├── onboard-seed.ts  → Cria issues de onboarding para clientes Seed
│   ├── seed 1.md        → Documentação de configuração Seed
│   └── seed 2.md
├── Bomma/               → Scripts análogos para BU Bomma
└── Impulse/             → Scripts análogos para BU Impulse
```

**Como funciona:** cada script tem uma lista de `{ projetoId, templateId, label }` e usa `createRestTxOperations()` para criar issues a partir de templates no workspace.

---

## 13. Domínios críticos para o 3F Tasks

### Tracker (Módulo principal — Tarefas/Projetos)

| Camada | Arquivo principal | O que fazer aqui |
|--------|------------------|------------------|
| Tipos | `plugins/tracker/src/index.ts` | Adicionar/modificar interfaces de Issue, Project, etc. |
| Schema | `models/tracker/src/types.ts` | Adicionar @Prop em Issue (novos campos) |
| Migrations | `models/tracker/src/migration.ts` | Criar migration ao adicionar campo ao schema |
| UI Issue | `plugins/tracker-resources/src/components/issues/edit/EditIssue.svelte` | Editar painel lateral da issue |
| UI List | `plugins/tracker-resources/src/components/issues/IssueItem.svelte` | Editar linha na list view |
| UI Config | `plugins/tracker-resources/src/components/settings/onboarding-config.ts` | Config de templates de onboarding |
| Server | `server-plugins/tracker/src/index.ts` | Adicionar triggers (OnCreate, OnUpdate) |
| PDCA | `services/worker/src/pdca.ts` | Lógica de agendamento e criação de ciclos |

### Task (Base genérica de tarefas)

`plugins/task/src/index.ts` — Interfaces base `Task`, `TaskProject`, `ProjectType`, `TaskType`, `Status`. O tracker estende tudo daqui. Não edite sem entender o impacto em todos os plugins que estendem `task`.

### Workbench (Shell da aplicação)

`plugins/workbench/src/plugin.ts` — Define a navegação principal, sidebar e roteamento de espaços. Arquivo crítico para adicionar novos módulos na navegação.

---

## 14. Como adicionar um novo campo em Issue

1. **Tipos** → `plugins/tracker/src/index.ts`: adicionar na interface `Issue`
2. **Schema** → `models/tracker/src/types.ts`: adicionar `@Prop(TypeXxx(), ...)` em `TIssue`
3. **Migration** → `models/tracker/src/migration.ts`: criar entry de migration
4. **UI** → `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte`: adicionar no painel lateral
5. **Server trigger** (se automático) → `server-plugins/tracker/src/index.ts`

---

## 15. Como adicionar um novo plugin completo

Sequência obrigatória (ver detalhes em `3f-docs/AGENT_RULES.md` §7):

1. `plugins/meu-plugin/src/index.ts` — IDs e tipos
2. `models/model-meu-plugin/src/types.ts` — schema com @Model/@Prop
3. `models/model-meu-plugin/src/index.ts` — exporta `createModel(builder)`
4. `models/all/src/index.ts` — registra o model
5. `rush.json` — registra os pacotes novos
6. `server/server-pipeline/src/serverPlugins.ts` — registra server-plugin (se houver)
7. `dev/prod/src/platform.ts` — registra `addLocation` para UI carregar

---

## 16. Fluxo de dados de uma Tx (transação)

```
Cliente Svelte
  → WebSocket para pods/server (transactor)
    → server/server-pipeline/src/pipeline.ts
      → Valida permissões (server-plugins/X: validators)
      → Persiste no CockroachDB
      → Executa triggers (server-plugins/X: OnCreate/OnUpdate)
      → Publica evento no Redpanda
        → services/worker (PDCA scheduler)
        → pods/fulltext (indexação)
        → pods/media (processamento de mídia)
      → Retorna confirmação ao cliente
```

---

## 17. Variáveis de ambiente relevantes para desenvolvimento

Definidas em `dev/docker-compose.yaml` e consumidas pelos serviços:

| Variável | Valor padrão | Uso |
|----------|-------------|-----|
| `DB_URL` | `postgres://cockroach:26257/huly` | CockroachDB |
| `ACCOUNTS_URL` | `http://huly.local:3000` | Serviço de auth |
| `SERVER_SECRET` | `secret` | JWT compartilhado entre serviços |
| `QUEUE_CONFIG` | `cockroach\|http://redpanda:9092` | Kafka/Redpanda |
| `STORAGE_CONFIG` | `minio\|minio?accessKey=...` | MinIO |
| `FULLTEXT_DB_URL` | `http://huly.local:9200` | Elasticsearch |

---

## 18. Comandos de desenvolvimento

```bash
# Instalar dependências (NUNCA pnpm install)
rush install

# Build de todos os pacotes
rush build

# Subir stack local
docker compose -f dev/docker-compose.yaml up -d

# Validar TypeScript de todos os pacotes
rush validate

# Ver logs do transactor (triggers, erros de plugin)
docker logs -f dev-transactor_cockroach-1

# Ver logs do frontend
docker logs -f dev-front-1

# Ver logs do account (auth)
docker logs -f dev-account-1
```

---

## 19. Arquivos mais críticos do repositório

| Arquivo | Por que é crítico |
|---------|------------------|
| `foundations/core/packages/core/src/classes.ts` | Interfaces base de todo o sistema |
| `foundations/core/packages/core/src/tx.ts` | Sistema de transações — toda mutação passa aqui |
| `foundations/core/packages/model/src/dsl.ts` | Builder + decorators (@Model, @Prop, etc.) |
| `models/all/src/index.ts` | Registry master — erro aqui quebra o build inteiro |
| `server/server-pipeline/src/serverPlugins.ts` | Plugin não registrado = `NoLocationForPlugin` em produção |
| `dev/prod/src/platform.ts` | Plugin sem `addLocation` = UI não carrega |
| `plugins/workbench/src/plugin.ts` | Navegação e roteamento principal |
| `plugins/tracker/src/index.ts` | Definição canônica das interfaces do Tracker |
| `services/worker/src/pdca.ts` | Lógica do ciclo PDCA |
| `plugins/tracker-resources/src/components/settings/onboarding-config.ts` | Config de onboarding de clientes |
| `rush.json` | Registry de pacotes — novo pacote não registrado aqui não existe |
| `common/config/rush/pnpm-lock.yaml` | Nunca edite manualmente |

---

## 20. Padrões de criação de código

Referência detalhada de como escrever código novo no 3F Tasks. As regras de ouro
(o que **nunca** fazer) estão no `CLAUDE.md`; os checklists de "adicionar campo" e
"adicionar plugin" estão nas §14–15 acima. Esta seção traz os **templates**.

### 20.1 Cabeçalho de licença (obrigatório em todo `.ts` / `.svelte` novo)

```typescript
//
// Copyright © 2025 Hardcore Engineering Inc.
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
//
```

Para `.svelte`, use `<!--` / `-->`.

### 20.2 IDs de plugin

Formato `dominio:kind:nome` — ex.: `tracker.class.Issue`, `tracker.mixin.IssueCompletionConfig`,
`tagSharing.class.UserTag`. Registre todos em `plugins/meu-plugin/src/index.ts`:

```typescript
export const meuPluginId = 'meu-plugin' as Plugin

export default plugin(meuPluginId, {
  class: { MinhaClasse: '' as Ref<Class<MinhaClasse>> },
  mixin: { MeuMixin: '' as Ref<Mixin<MeuMixin>> },
  trigger: { OnMeuEvento: '' as Resource<TriggerFunc> },
  function: { MinhaFunc: '' as Resource<(doc: Doc) => Promise<string>> }
})
```

### 20.3 Tipos e interfaces (`plugins/X/src/index.ts`)

```typescript
/** @public */
export interface MinhaInterface extends Doc {
  campo: string
  campoOpcional?: number
  referencia: Ref<OutraInterface>
}

/** @public */
export enum MeuEnum { ValorA = 'valorA', ValorB = 'valorB' }
```

- Sempre `/** @public */` em exports públicos.
- Interfaces estendem `Doc`, `AttachedDoc`, `Space` ou tipos de `@hcengineering/task`.
- Enums usam string literals lowercase.

### 20.4 Schema (`models/X/src/types.ts`)

```typescript
@Model(pluginId.class.MinhaClasse, core.class.Doc, DOMAIN_MEU_PLUGIN)
@UX(pluginId.string.MinhaClasse, pluginId.icon.MinhaClasse, 'ALIAS', 'name')
export class TMinhaClasse extends TDoc implements MinhaClasse {
  @Prop(TypeString(), pluginId.string.CampoTitulo)
  @Index(IndexKind.FullText)
    titulo!: string

  @Prop(TypeNumber(), pluginId.string.CampoNumero)
  @Hidden()
    numero!: number

  @Prop(TypeRef(core.class.Space), pluginId.string.CampoRef)
  @Index(IndexKind.Indexed)
    referencia!: Ref<Space>

  // Campos herdados: NUNCA redeclare — use `declare`
  declare space: Ref<MinhaClasse>
  declare attachedTo: Ref<OutroDoc>
}
```

- Classe TS tem prefixo `T` (`TIssue`, `TProject`).
- Campo que implementa a interface e já existe no pai: `declare campo: Tipo`.
- `@Index(IndexKind.FullText)` = pesquisável · `@Index(IndexKind.Indexed)` = filtrável/ordenável.
- `@Hidden()` = interno (sem UI) · `@ReadOnly()` = somente-leitura.
- `DOMAIN_X` definido como `'x' as Domain` no topo do arquivo.

Decorators de tipo:
```typescript
TypeString() TypeNumber() TypeBoolean() TypeDate()          // primitivos + Timestamp
TypeRef(classe) TypeMarkup() TypeCollaborativeDoc()         // ref / markup / Yjs (description)
TypeRecord() ArrOf(TypeRef(...)) Collection(classe)         // record / array / coleção com count
```

### 20.5 Mixin

```typescript
@Mixin(pluginId.mixin.MeuMixin, baseClass.class.MinhaClasse)
@UX(pluginId.string.MeuMixin)
export class TMeuMixin extends TMinhaClasse implements MeuMixin {
  @Prop(ArrOf(TypeRecord()), pluginId.string.MinhasRegras)
    minhasRegras!: MinhaRegra[]
}
```

### 20.6 Migration (`models/X/src/migration.ts`)

```typescript
import { tryMigrate, tryUpgrade, type MigrateOperation } from '@hcengineering/model'

export const meuPluginOperation: MigrateOperation = {
  async migrate (client, logger): Promise<void> {
    await tryMigrate(client, 'meu-plugin', [
      { state: 'add-novo-campo', mode: 'upgrade',
        func: async (client) => {
          await client.update(DOMAIN_MEU_PLUGIN, {}, { novoCampo: defaultValue })
        } }
    ])
  },
  async upgrade (state, client): Promise<void> {
    await tryUpgrade(state, client, 'meu-plugin', [
      { state: 'init-dados',
        func: async (client) => {
          const tx = new TxOperations(client, core.account.System)
          await createOrUpdate(tx, /* ... */)
        } }
    ])
  }
}
```

Registre em `models/all/src/index.ts` (import + adicionar ao array de operations).

### 20.7 Trigger (3 camadas — faltando qualquer uma, falha silenciosa)

1. **Declaração** do ID em `plugins/server-X/src/index.ts`:
   ```typescript
   export default plugin(serverMeuPluginId, {
     trigger: { OnMeuEvento: '' as Resource<TriggerFunc> }
   })
   ```
2. **Implementação** em `server-plugins/X-resources/src/index.ts`:
   ```typescript
   export const OnMeuEvento: TriggerFunc = async (tx, control): Promise<Tx[]> => {
     const actualTx = tx as TxUpdateDoc<MinhaClasse>
     if (actualTx._class !== core.class.TxUpdateDoc) return []
     if (actualTx.objectClass !== pluginId.class.MinhaClasse) return []
     const resultado: Tx[] = []
     // lógica
     return resultado
   }
   export default async () => ({ trigger: { OnMeuEvento } })
   ```
3. **Registro no model** em `models/server-X/src/index.ts` via `builder.createDoc(serverCore.class.Trigger, ...)`.

E registre o pacote em `server/server-pipeline/src/serverPlugins.ts`:
```typescript
addLocation(serverMeuPluginId, () => import('@hcengineering/server-meu-plugin-resources'))
```
Exemplo real completo: feature F02 (skill `f02-tag-sharing`).

### 20.8 Componente Svelte

```svelte
<script lang="ts">
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { Issue } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import tracker from '../../../plugin'

  export let issue: Issue
  export let readonly = false

  const client = getClient()
  const query = createQuery()
  let dados: MinhaInterface[] = []

  $: query.query(tracker.class.MinhaInterface, { issue: issue._id }, (res) => { dados = res })

  async function handleAction (): Promise<void> {
    if (readonly) return
    await client.updateDoc(tracker.class.Issue, issue.space, issue._id, { campo: novoValor })
  }
</script>
```

- `export let prop: Tipo` para props · `export let readonly = false` em todo editor · cheque `readonly` antes de qualquer mutação.
- `createQuery()` + store reativo para ler · `getClient()` para mutar (nunca acesse o banco direto).
- UI: `@hcengineering/ui` · apresentação: `@hcengineering/presentation` · view: `@hcengineering/view-resources`.

### 20.9 Service / Worker (`services/X/src/`)

```typescript
import { MeasureMetricsContext } from '@hcengineering/core'
import { createRestTxOperations } from '@hcengineering/api-client'
import { generateToken } from '@hcengineering/server-token'
import config from './config'

const ctx = new MeasureMetricsContext('meu-servico', {})

export async function executarTarefa (workspaceId: WorkspaceUuid): Promise<void> {
  const token = generateToken(config.serverSecret, systemAccountUuid, workspaceId)
  const client = await createRestTxOperations(config.serverUrl, token)
  try { /* lógica */ } finally { await client.close() }
}
```

### 20.10 `tsconfig.json` (padrão de pacote novo)

```json
{
  "extends": "./node_modules/@hcengineering/platform-rig/profiles/default/tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src", "outDir": "./lib",
    "declarationDir": "./types", "tsBuildInfoFile": ".build/build.tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "lib", "dist", "types", "bundle"]
}
```

### 20.11 `package.json` (padrão de pacote novo)

```json
{
  "name": "@hcengineering/meu-plugin",
  "version": "0.7.0",
  "main": "lib/index.js",
  "types": "types/index.d.ts",
  "files": ["lib/**/*", "types/**/*", "tsconfig.json"],
  "scripts": {
    "build": "compile",
    "_phase:build": "compile transpile src",
    "_phase:test": "jest --passWithNoTests --silent",
    "_phase:format": "format src",
    "_phase:validate": "compile validate"
  },
  "devDependencies": {
    "@hcengineering/platform-rig": "workspace:^0.7.21",
    "typescript": "^5.9.3", "jest": "^29.7.0",
    "ts-jest": "^29.1.1", "@types/jest": "^29.5.5"
  },
  "dependencies": {
    "@hcengineering/core": "workspace:^0.7.26",
    "@hcengineering/platform": "workspace:^0.7.20"
  }
}
```

Pacote Svelte: adicione `"svelte": "src/index.ts"` e a dependência `"svelte": "^4.2.20"`.

### 20.12 Calendar Event / WorkSlot → `findPrimaryCalendar()`

Ao criar `calendar.class.Event` ou `time.class.WorkSlot` em qualquer componente do
front, **sempre** resolva o calendário via `findPrimaryCalendar()` de
`plugins/time-resources/src/utils.ts`:

```typescript
import { findPrimaryCalendar } from '../utils'
const _calendar = await findPrimaryCalendar()
await client.addCollection(time.class.WorkSlot, calendar.space.Calendar, todoId,
  time.class.ToDo, 'workslots', { calendar: _calendar /* ...resto */ })
```

- Nunca hardcode `` `${acc.uuid}_calendar` `` — é o calendário interno, ignora a
  preferência do usuário e quebra a integração com Google Calendar.
- Nunca filtre `ExternalCalendar` só por `user: primarySocialId` — use `user: { $in: acc.socialIds }`.
