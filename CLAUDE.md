# CLAUDE.md — 3F Tasks

Ponto de entrada obrigatório. **Leia antes de qualquer tarefa.** Este arquivo é
enxuto de propósito; o detalhe longo mora nos
documentos e skills indexados no fim.

---

## O que é

3F Tasks é um **fork da plataforma Huly** para uso interno da 3F Venture, rodando
em **produção com dados reais**. Monorepo **Rush + pnpm** (~481 pacotes).

| Item | Valor |
|---|---|
| Front | Svelte 4.2.20 + TypeScript |
| Back | Node.js 20+ + TypeScript |
| Dados | CockroachDB · Elasticsearch · MinIO · Redpanda (Kafka) |
| Infra local de testes | Docker Compose · URL local `http://localhost:8087` |
| Branch principal | `develop` |
| Deploy em produção | `3f-build.sh` + `dev/docker-compose.vps.yaml` (imagens `hardcoreeng/<pod>:3f-local`) |

Cada domínio segue o **Plugin Triple**: `plugins/X` (tipos + IDs) · `plugins/X-resources`
(componentes Svelte) · `models/X` (schema). Opcional: `server-plugins/X` (triggers).

---

## Estrutura de pastas

| Pasta | O que é |
|---|---|
| `foundations/` | Infra base (core, model, server, storage, adapters de DB/fila) — **não edite sem necessidade** |
| `models/` | Schemas por domínio (`@Model`/`@Prop`/migrations). Registro master: `models/all/src/index.ts` |
| `plugins/` | Frontend por domínio (tipos + Svelte + assets) |
| `server-plugins/` | Triggers e validators que rodam no transactor |
| `server/` | Servidores standalone (transactor `server-pipeline`, `account`, `workspace`, `collaborator`, `front`) |
| `services/` | Microserviços isolados (`worker`=PDCA, calendar, mail, github, datalake…) via HTTP/Kafka |
| `pods/` | Entrypoints de deploy Docker (montam server + plugins) |
| `dev/` | Tooling local (docker-compose, nginx, `prod/src/platform.ts`) |
| `3f-docs/` | Docs internas do fork (regras, build/deploy, features) |
| `automation/` | Scripts de onboarding por BU (Seed, Bomma, Impulse) |
| `rush.json` · `common/config/rush/pnpm-lock.yaml` | Registry de pacotes · lockfile (**nunca editar à mão**) |

Mapa detalhado do monorepo + padrões de criação de código: **`archive-context.md`**.

---

## Regras de ouro (NUNCA viole)

- **NUNCA `pnpm install`** → sempre `rush install`.
- **NUNCA edite o banco diretamente** → toda mutação é uma `Tx` (via `TxOperations`).
- **NUNCA crie `SubIssue` como classe** → sub-issue é uma `Issue` com `attachedTo` preenchido.
- **NUNCA edite `description` de Issue via Tx direta** → use o collaborator service (Yjs).
- **NUNCA `git push --force` na `develop`.**
- **NUNCA commite `.env`, chaves ou credenciais.** Segredos reais vão em `dev/.env.secrets` (injetado via `env_file`, **não versionado**); só `*.example` entram no git.
- **Schema mudou → migration obrigatória** (`tryMigrate`/`tryUpgrade`).
- **NUNCA edite `common/config/rush/pnpm-lock.yaml` manualmente.**
- **Criar `calendar.Event` / `time.WorkSlot`** → sempre via `findPrimaryCalendar()`; nunca hardcode `` `${uuid}_calendar` `` (quebra a integração com Google Calendar).
- **Todo arquivo `.ts`/`.svelte` novo** leva o cabeçalho de licença EPL-2.0 (bloco em `archive-context.md` §20).

---

## Mapa: arquivo alterado → pod (build)

| Arquivos alterados | Pod(s) | Comando |
|---|---|---|
| `plugins/*-resources/` | `front` | `./3f-build.sh --pod front` |
| `plugins/*/src/index.ts` (sem resources) | `front` + `server` | `./3f-build.sh --pod "front server"` |
| `models/*/`, `server-plugins/*/` | `server` | `./3f-build.sh --skip-webpack --pod server` |
| `server/account*/` | `account` | `./3f-build.sh --skip-webpack --pod account` |
| `services/worker/` (PDCA) | `worker` | `./3f-build.sh --skip-webpack --pod worker` |
| `services/calendar/`, `mail/`, `github/`… | pod homônimo | `./3f-build.sh --skip-webpack --pod <nome>` |
| Não sabe ao certo | todos | `./3f-build.sh` |

Deploy na VPS: adicione `--vps`. Flags e tempos estimados: **`3f-docs/AGENT_RULES.md` §5**.

---

## Validação antes de commitar

```bash
rush validate                     # TS de todos os pacotes; deve dar SUCCESS
                                  # (falha só em @hcengineering/prod no macOS é aceitável)
```

Após o build, cheque erros de boot:

```bash
docker logs dev-transactor_cockroach-1 2>&1 | grep -E "ERROR|NoLocation|not found" | head
docker logs dev-front-1              2>&1 | grep -E "ERROR|error" | head
```

`NoLocationForPlugin: X` = plugin não registrado em `serverPlugins.ts` ou `platform.ts`.
Depois, teste no browser os casos em `3f-docs/features/FXX-*/tests.md`.

---

## Features 3F (estado atual)

Os docs em `3f-docs/features/` às vezes ficam para trás — esta tabela é a fonte rápida.

| # | Feature | Estado | Onde |
|---|---|---|---|
| F01 | Completion Validation | ✅ implementada | `tracker` (StatusEditor, IssueCompletionConfig) |
| F02 | Tag-Based Sharing | ✅ implementada | skill **`f02-tag-sharing`** |
| F04 | Ciclo PDCA | ✅ implementada (pod `worker`) | skill **`f04-pdca-cycle`** |
| F09 | Client Fields (Nome/Etapa) | ✅ implementada | campos `clientName`/`clientStage` na Issue |
| F10 | Operational Dashboard | 🚧 em desenvolvimento ativo | `plugins/operational-dashboard*` (F10b layout ✅) |
| F11 | Login Universal (3F Core) | ✅ implementada, **só local** (flag `THREEF_CORE_ENABLED`, ainda não em prod) | `server/account*` |
| F03·F05·F06·F07·F08 | datas automáticas · template fields · Google Tasks · list-view fields · home dashboard | 🔲 planejadas | `3f-docs/features/` |

---

## Documentação & skills (índice)

| Recurso | Conteúdo |
|---|---|
| **`archive-context.md`** | Mapa completo do monorepo + **padrões de criação de código** (decorators, schema, mixin, migration, trigger, Svelte, service, templates de tsconfig/package, cabeçalho de licença) |
| **`3f-docs/AGENT_RULES.md`** | Convenções de branch/commit · build/deploy (`3f-build.sh`) · logs de debug · sync com upstream |
| **`3f-docs/BUILD_AND_DEPLOY.md`** | Build e deploy na VPS |
| **`3f-docs/INFRA.md`** | Mapa dos containers da VPS: serviço ↔ imagem ↔ buildado por nós ↔ stateful · guard-rails da esteira (o que a CI/CD pode redeployar e o que NUNCA tocar) |
| **`3f-docs/desenvolvimento.md`** | Desenvolvimento local |
| **`3f-docs/features/`** | Specs e casos de teste por feature (F01, F02, F04, F09…) |
| **`.claude/skills/`** | Skills por feature (`f02-tag-sharing`, `f04-pdca-cycle`) — o Claude Code seleciona pela `description`. Molde novo: `.claude/skills/_template/` |

### Convenção de branches e commits (resumo — detalhe em AGENT_RULES §3–4)

```
<tipo>/<descricao-kebab-case>          feat|fix|refactor|chore|docs
feat(escopo): mensagem curta em inglês
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
