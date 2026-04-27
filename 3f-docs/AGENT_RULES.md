# Regras para Agentes — 3F Hub

Guia obrigatório para qualquer agente que vá fazer alterações no repositório `huly-3f`. Leia antes de tocar em qualquer arquivo.

---

## 1. Stack e contexto

| Item | Valor |
|---|---|
| Projeto | Fork customizado do Huly para uso interno da 3F Venture |
| Upstream | https://github.com/hcengineering/platform |
| Repositório | https://github.com/3F-Tech/huly-3f |
| Branch principal | `develop` |
| URL local | http://localhost:7000 |
| Frontend | Svelte 4.2.20 + TypeScript 5.9.3 |
| Backend | Node.js 20+ + TypeScript |
| Banco | CockroachDB + Elasticsearch + MinIO |
| Monorepo | Rush + pnpm (~481 pacotes) |
| Infra local | Docker Compose |

---

## 2. Regras absolutas (nunca viole)

- **NUNCA use `pnpm install` diretamente** — use `rush install`
- **NUNCA edite o banco de dados diretamente** — toda mutação é uma `Tx` (transação)
- **NUNCA crie uma classe `SubIssue`** — sub-issues são Issues com `attachedTo` preenchido
- **NUNCA edite `description` de Issue via transação direta** — use o collaborator service (gerenciado por Yjs)
- **NUNCA use `git push --force` na branch `develop`**
- **NUNCA commite arquivos de segredos** (`.env`, credenciais)
- **Mudanças de schema requerem migration transactions** — não é um ORM com `ALTER TABLE`

---

## 3. Convenção de branches

### Formato
```
<tipo>/<descricao-em-kebab-case>
```

### Tipos aceitos

| Tipo | Quando usar |
|---|---|
| `feature/` | Nova funcionalidade |
| `fix/` | Correção de bug |
| `refactor/` | Refatoração sem mudança de comportamento |
| `chore/` | Tarefas de manutenção (deps, configs) |
| `docs/` | Documentação apenas |

### Exemplos corretos
```
feature/automatic-dates
feature/pdca-cycle
feature/bu-access-control
fix/completion-validation-subtask
fix/tag-sharing-trigger
refactor/account-auth-flow
chore/rush-lockfile-update
docs/feature-tests
```

### Branches das features 3F (já existentes)
```
feature/issue-completion-validation   ← F01 (mergeado em develop)
feature/tag-based-sharing             ← F02 (mergeado em develop)
feature/automatic-dates               ← F03 (a desenvolver)
feature/pdca-cycle                    ← F04 (a desenvolver)
feature/auto-client-onboarding        ← F05 (a desenvolver)
feature/bu-access-control             ← F06 (a desenvolver)
feature/custom-fields-list-view       ← F07 (a desenvolver)
feature/home-dashboard                ← F08 (a desenvolver)
```

---

## 4. Convenção de commits

### Formato (Conventional Commits)
```
<tipo>(<escopo>): <mensagem curta em inglês>

[corpo opcional — explique o POR QUÊ, não o O QUÊ]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Tipos

| Tipo | Quando usar |
|---|---|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `refactor` | Refatoração |
| `chore` | Deps, configs, lockfile |
| `docs` | Documentação |
| `test` | Testes |
| `style` | Formatação (sem lógica) |

### Escopos comuns

| Escopo | O que cobre |
|---|---|
| `tracker` | Plugin tracker e recursos |
| `account` | Serviço de conta e auth |
| `tag-sharing` | Feature F02 |
| `completion` | Feature F01 |
| `model-all` | Registry master de plugins |
| `server-pipeline` | Pipeline do servidor |
| `workbench` | Navegação e UI principal |
| `deps` | Dependências e lockfile |

### Exemplos corretos
```
feat(tracker): add configurable issue completion validation per project
feat(tag-sharing): add OnSpaceTagAccessChanged trigger
fix(completion): block subtask without spent time before parent check
fix(account): handle PUT /cookie token decode failure gracefully
chore(deps): update rush lockfile after adding tag-sharing packages
docs(3f-docs): add F02 context and test cases
```

---

## 5. Como subir mudanças no Docker para teste

Execute na ordem abaixo. Todos os comandos rodam no **Git Bash** (não no cmd/PowerShell).

### 5.1 — Compilar TypeScript
```bash
cd /c/Users/PICHAU/Desktop/platform
rush build
```
> Duração: ~1–5 min dependendo do que mudou.

### 5.2 — Bundlar e rebuildar imagens

**Transactor** — server plugins, triggers, modelo (mude aqui se alterou: `server-plugins/`, `models/`, `server/server-pipeline/`):
```bash
cd pods/server
rushx bundle
rushx docker:build
```

**Front** — UI, componentes Svelte, workbench (mude aqui se alterou: `plugins/*-resources/`, `plugins/workbench-resources/`):
```bash
cd pods/front
rushx bundle
rushx package   # copia assets do webpack — requer Git Bash (usa rm/cp Unix)
rushx docker:build
```

**Account** — serviço de autenticação (mude aqui se alterou: `server/account/`, `server/account-service/`):
```bash
cd pods/account
rushx docker:build   # não tem bundle separado
```

### 5.3 — Reiniciar containers

```bash
cd /c/Users/PICHAU/Desktop/platform
docker compose -f dev/docker-compose.yaml up -d --no-deps transactor_cockroach front account
```
> Use `--no-deps` para não derrubar o banco (CockroachDB, Redis, etc.).

### 5.4 — Verificar que os containers subiram

```bash
docker compose -f dev/docker-compose.yaml ps | grep -E "front|account|transactor"
```

### 5.5 — Acessar
```
http://localhost:7000
```

### Referência rápida: o que mudou → qual pod rebuildar

| Arquivos alterados | Pod(s) |
|---|---|
| `plugins/*-resources/`, `plugins/workbench-resources/` | `pods/front` |
| `plugins/*/src/index.ts` (sem resources) | `pods/front` + `pods/server` |
| `models/*/`, `server-plugins/*/` | `pods/server` (transactor) |
| `server/account/`, `server/account-service/` | `pods/account` |
| `server/server-pipeline/` | `pods/server` (transactor) |
| Tudo (não sabe ao certo) | Os 3 pods |

---

## 6. Validação antes de commitar

```bash
# Roda o TypeScript compiler em todos os pacotes
rush validate
```

O `rush validate` deve terminar com `SUCCESS` em todos os pacotes relevantes. O pacote `@hcengineering/prod` pode falhar em ambientes não-Linux por limitações de script — isso é aceitável desde que os pacotes das features estejam passando.

---

## 7. Padrões de código

### Decorators obrigatórios nos models
```typescript
@Model(pluginId.class.MinhaClasse, core.class.Doc, DOMAIN_MINHA_FEATURE)
@Prop(TypeString(), pluginId.string.MeuCampo)
@Index(IndexKind.FullText)
@Mixin(pluginId.mixin.MeuMixin, baseClass)
```

### IDs de plugin
```
pluginId:kind:name
// Exemplo:
tagSharing.class.UserTag
tagSharing.mixin.TaggedProfile
tracker.mixin.IssueCompletionConfig
```

### Nunca crie um campo `space` redeclarado num model class
Use `declare` para anotar sem criar nova propriedade:
```typescript
// ERRADO
space!: Ref<Space>

// CORRETO
declare space: Ref<Space>
```

### Adicionando um novo plugin (checklist)
1. Definir IDs em `plugins/meu-plugin/src/index.ts`
2. Definir modelo em `models/model-meu-plugin/src/types.ts`
3. Criar `createModel` em `models/model-meu-plugin/src/index.ts`
4. Registrar em `models/all/src/index.ts`
5. Registrar pacotes no `rush.json`
6. Se tiver server plugin: adicionar `addLocation` em `server/server-pipeline/src/serverPlugins.ts`
7. Se tiver UI: registrar `addLocation` em `dev/prod/src/platform.ts`
8. Criar `tsconfig.json` em cada pacote novo (ver exemplos em `server-plugins/tag-sharing/tsconfig.json`)

---

## 8. Logs úteis para debug

```bash
# Ver logs do servidor (triggers, erros de plugin)
docker logs -f dev-transactor_cockroach-1

# Ver logs do frontend
docker logs -f dev-front-1

# Ver logs do account service (auth, login)
docker logs -f dev-account-1

# Ver todos os containers e status
docker compose -f dev/docker-compose.yaml ps
```

---

## 9. Arquivos críticos — cuidado ao editar

| Arquivo | Risco |
|---|---|
| `foundations/core/packages/core/src/classes.ts` | Interfaces base de tudo |
| `foundations/core/packages/core/src/tx.ts` | Sistema de transações |
| `models/all/src/index.ts` | Registry master — erro aqui quebra o build inteiro |
| `server/server-pipeline/src/serverPlugins.ts` | Plugin não registrado = `NoLocationForPlugin` |
| `dev/prod/src/platform.ts` | Plugin sem `addLocation` = UI não carrega |
| `common/config/rush/pnpm-lock.yaml` | Nunca edite manualmente |
| `plugins/workbench/src/plugin.ts` | Navegação principal |

---

## 10. Sincronização com upstream

```bash
# Buscar atualizações do Huly original
git fetch upstream

# Ver o que tem de novo (só commits reais, sem merges/bumps)
git log --oneline upstream/main ^HEAD --no-merges

# Recomendação: sync a cada 2 semanas
# Estratégia: cherry-pick de fixes pontuais > merge completo
```

> **Regra:** features em arquivos isolados minimizam conflitos com o upstream.
