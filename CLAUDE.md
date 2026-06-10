# CLAUDE.md — Guia de Desenvolvimento 3F Tasks

Leia este arquivo **antes de qualquer tarefa**. Ele é o ponto de entrada obrigatório para qualquer agente de IA.

---

## Documentação de referência

| Arquivo | O que contém |
|---------|-------------|
| `archive-context.md` | **Leia sempre.** Mapa completo do monorepo: estrutura de pastas, padrão Plugin Triple, camadas de infraestrutura, arquivos críticos, fluxo de Tx e comandos de desenvolvimento |
| `3f-docs/AGENT_RULES.md` | Regras absolutas, convenção de branches e commits, checklist de novo plugin, padrões de decorators |
| `3f-docs/BUILD_AND_DEPLOY.md` | Build e deploy na VPS |
| `3f-docs/desenvolvimento.md` | Desenvolvimento local |
| `3f-docs/features/` | Specs e casos de teste por feature (F01, F02, F04, F09…) |

---

## Regras absolutas

- **NUNCA `pnpm install`** → sempre `rush install`
- **NUNCA edite o banco diretamente** → toda mutação é uma `Tx` (transação via `TxOperations`)
- **NUNCA crie `SubIssue` como classe** → sub-issues são `Issue` com `attachedTo` preenchido
- **NUNCA edite `description` de Issue via Tx direta** → use o collaborator service (Yjs)
- **NUNCA `git push --force` na branch `develop`**
- **NUNCA commite `.env`, chaves ou credenciais**
- **Schema mudou → migration obrigatória** (via `tryMigrate`/`tryUpgrade`)
- **NUNCA edite `common/config/rush/pnpm-lock.yaml` manualmente**

---

## Regras de criação de código

### 1. Cabeçalho obrigatório em todo arquivo TypeScript e Svelte

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

### 2. Padrão de IDs de plugin

```
dominio:kind:nome
// Exemplos:
tracker.class.Issue
tracker.mixin.IssueCompletionConfig
tagSharing.class.UserTag
```

Registre todos os IDs em `plugins/meu-plugin/src/index.ts` com:
```typescript
export const meuPluginId = 'meu-plugin' as Plugin

export default plugin(meuPluginId, {
  class: { MinhaClasse: '' as Ref<Class<MinhaClasse>> },
  mixin: { MeuMixin: '' as Ref<Mixin<MeuMixin>> },
  trigger: { OnMeuEvento: '' as Resource<TriggerFunc> },
  function: { MinhaFunc: '' as Resource<(doc: Doc) => Promise<string>> }
})
```

### 3. Tipos e interfaces (plugins/X/src/index.ts)

```typescript
/** @public */
export interface MinhaInterface extends Doc {
  campo: string
  campoOpcional?: number
  referencia: Ref<OutraInterface>
}

/** @public */
export enum MeuEnum {
  ValorA = 'valorA',
  ValorB = 'valorB'
}
```

Regras:
- Sempre `/** @public */` em exports públicos
- Interfaces estendem `Doc`, `AttachedDoc`, `Space`, ou tipos do `@hcengineering/task`
- Enums usam string literals lowercase

### 4. Schema (models/X/src/types.ts)

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

  @Prop(TypeBoolean(), pluginId.string.CampoBoolean)
    ativo?: boolean

  @Prop(TypeRef(core.class.Space), pluginId.string.CampoRef)
  @Index(IndexKind.Indexed)
    referencia!: Ref<Space>

  // Para campos herdados: NUNCA redeclare, use `declare`
  declare space: Ref<MinhaClasse>
  declare attachedTo: Ref<OutroDoc>
}
```

Regras:
- Classe TypeScript tem prefixo `T` (`TIssue`, `TProject`)
- Campos que implementam interface e já existem no pai: `declare campo: Tipo`
- `@Index(IndexKind.FullText)` para campos pesquisáveis
- `@Index(IndexKind.Indexed)` para campos filtráveis/ordenáveis
- `@Hidden()` para campos internos (sem UI)
- `@ReadOnly()` para campos somente-leitura
- `DOMAIN_X` definido como `'x' as Domain` no topo do arquivo

Decorators de tipo disponíveis:
```typescript
TypeString()          // string
TypeNumber()          // number
TypeBoolean()         // boolean
TypeDate()            // Timestamp (number)
TypeRef(classe)       // Ref<Classe>
TypeMarkup()          // string rich text
TypeCollaborativeDoc()// MarkupBlobRef (Yjs — para description)
TypeRecord()          // Record<string, any>
ArrOf(TypeRef(...))   // array
Collection(classe)    // coleção com count
```

### 5. Mixin

```typescript
@Mixin(pluginId.mixin.MeuMixin, baseClass.class.MinhaClasse)
@UX(pluginId.string.MeuMixin)
export class TMeuMixin extends TMinhaClasse implements MeuMixin {
  @Prop(ArrOf(TypeRecord()), pluginId.string.MinhasRegras)
    minhasRegras!: MinhaRegra[]
}
```

### 6. Migration (models/X/src/migration.ts)

```typescript
import { tryMigrate, tryUpgrade, type MigrateOperation } from '@hcengineering/model'

export const meuPluginOperation: MigrateOperation = {
  async migrate (client, logger): Promise<void> {
    await tryMigrate(client, 'meu-plugin', [
      {
        state: 'add-novo-campo',
        mode: 'upgrade',
        func: async (client) => {
          await client.update(DOMAIN_MEU_PLUGIN, {}, { novoCampo: defaultValue })
        }
      }
    ])
  },
  async upgrade (state, client): Promise<void> {
    await tryUpgrade(state, client, 'meu-plugin', [
      {
        state: 'init-dados',
        func: async (client) => {
          const tx = new TxOperations(client, core.account.System)
          await createOrUpdate(tx, ...)
        }
      }
    ])
  }
}
```

Registre em `models/all/src/index.ts`:
```typescript
import { meuPluginId, createModel as meuPluginModel } from '@hcengineering/model-meu-plugin'
// ... adicionar ao array de operations
```

### 7. Trigger (server-plugins/X/src/index.ts)

```typescript
import type { TriggerFunc } from '@hcengineering/server-core'
import type { TriggerControl } from '@hcengineering/server-core'
import { TxUpdateDoc, TxCreateDoc } from '@hcengineering/core'

export const OnMeuEvento: TriggerFunc = async (tx, control): Promise<Tx[]> => {
  const actualTx = tx as TxUpdateDoc<MinhaClasse>
  if (actualTx._class !== core.class.TxUpdateDoc) return []
  if (actualTx.objectClass !== pluginId.class.MinhaClasse) return []

  const resultado: Tx[] = []
  // lógica aqui
  return resultado
}

export default async () => ({
  trigger: {
    OnMeuEvento
  }
})
```

Declare o ID do trigger no arquivo `plugins/server-X/src/index.ts`:
```typescript
export default plugin(serverMeuPluginId, {
  trigger: {
    OnMeuEvento: '' as Resource<TriggerFunc>
  }
})
```

Registre em `server/server-pipeline/src/serverPlugins.ts`:
```typescript
addLocation(serverMeuPluginId, () => import('@hcengineering/server-meu-plugin-resources'))
```

### 8. Componente Svelte

```svelte
<!--
// Copyright © 2025 Hardcore Engineering Inc.
// Licensed under the Eclipse Public License, Version 2.0...
-->
<script lang="ts">
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { Issue } from '@hcengineering/tracker'
  import { Label, Button } from '@hcengineering/ui'
  import tracker from '../../../plugin'

  export let issue: Issue
  export let readonly = false

  const client = getClient()
  const query = createQuery()

  let dados: MinhaInterface[] = []

  $: query.query(tracker.class.MinhaInterface, { issue: issue._id }, (res) => {
    dados = res
  })

  async function handleAction (): Promise<void> {
    if (readonly) return
    await client.updateDoc(tracker.class.Issue, issue.space, issue._id, { campo: novoValor })
  }
</script>

<div class="flex-row-center gap-2">
  <Label label={tracker.string.MeuCampo} />
  <!-- template -->
</div>
```

Regras Svelte:
- `export let prop: Tipo` para props
- `export let readonly = false` em todo editor
- Sempre `readonly` antes de qualquer mutação
- Use `createQuery()` + store reativo para dados do banco
- `getClient()` para mutations, nunca acesse o banco diretamente
- Imports de UI: `@hcengineering/ui` (Label, Button, popup, etc.)
- Imports de componentes de apresentação: `@hcengineering/presentation`
- Imports de recursos de view: `@hcengineering/view-resources`

### 9. Service / Worker (services/X/src/)

```typescript
import { MeasureMetricsContext } from '@hcengineering/core'
import { createRestTxOperations } from '@hcengineering/api-client'
import { generateToken } from '@hcengineering/server-token'
import config from './config'

const ctx = new MeasureMetricsContext('meu-servico', {})

export async function executarTarefa (workspaceId: WorkspaceUuid): Promise<void> {
  const token = generateToken(config.serverSecret, systemAccountUuid, workspaceId)
  const client = await createRestTxOperations(config.serverUrl, token)
  try {
    // lógica
  } finally {
    await client.close()
  }
}
```

### 10. tsconfig.json (padrão para todo pacote novo)

```json
{
  "extends": "./node_modules/@hcengineering/platform-rig/profiles/default/tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./lib",
    "declarationDir": "./types",
    "tsBuildInfoFile": ".build/build.tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "lib", "dist", "types", "bundle"]
}
```

### 11. package.json (padrão para todo pacote novo)

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
    "typescript": "^5.9.3",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "@types/jest": "^29.5.5"
  },
  "dependencies": {
    "@hcengineering/core": "workspace:^0.7.26",
    "@hcengineering/platform": "workspace:^0.7.20"
  }
}
```

Para pacotes Svelte, adicione `"svelte": "src/index.ts"` e dependência `"svelte": "^4.2.20"`.

### 12. Checklist para novo plugin completo

1. `plugins/meu-plugin/src/index.ts` — IDs e interfaces
2. `plugins/meu-plugin-resources/src/` — componentes Svelte
3. `models/model-meu-plugin/src/types.ts` — schema com decorators
4. `models/model-meu-plugin/src/migration.ts` — migrations
5. `models/model-meu-plugin/src/index.ts` — exporta `createModel(builder)`
6. `models/all/src/index.ts` — registra o model e operation
7. `rush.json` — registra todos os novos pacotes
8. `server/server-pipeline/src/serverPlugins.ts` — registra server-plugin (se houver)
9. `dev/prod/src/platform.ts` — registra `addLocation` para UI carregar
10. `tsconfig.json` e `package.json` em cada pacote novo

### 13. Como adicionar um campo em Issue existente

1. `plugins/tracker/src/index.ts` → adicionar campo na interface `Issue`
2. `models/tracker/src/types.ts` → adicionar `@Prop(...)` em `TIssue`
3. `models/tracker/src/migration.ts` → criar entry em `tryMigrate` com `state` único
4. `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte` → adicionar campo na UI
5. `server-plugins/tracker/src/index.ts` → adicionar trigger `OnIssueUpdate` se precisar de lógica automática

### 14. Criar Calendar Event / WorkSlot — use findPrimaryCalendar()

Ao criar `calendar.class.Event` ou `time.class.WorkSlot` em qualquer componente do front (Planner, popups de ToDo, drag-drop), **sempre** resolva o calendário via `findPrimaryCalendar()` de `plugins/time-resources/src/utils.ts`:

```typescript
import { findPrimaryCalendar } from '../utils'   // ou caminho equivalente

const _calendar = await findPrimaryCalendar()
await client.addCollection(time.class.WorkSlot, calendar.space.Calendar, todoId, time.class.ToDo, 'workslots', {
  calendar: _calendar,
  // ...resto
})
```

Regras:
- **Nunca** hardcode `` `${acc.uuid}_calendar` `` como destino — isso é o calendário interno "3ftasks", ignora a preferência do usuário (Settings → Calendar → Primary Calendar) e quebra a integração com Google Calendar.
- **Nunca** filtre `ExternalCalendar` só por `user: primarySocialId` — usuários autenticam o Google com um `socialId` diferente do primário. Use `user: { $in: acc.socialIds }` se precisar de query custom.
- O fallback para o calendário interno só faz sentido como inicialização síncrona enquanto a promise resolve; substitua pelo resultado de `findPrimaryCalendar()` assim que disponível.

---

## Validação antes de commitar

### Passo 1 — TypeScript (obrigatório)

```bash
rush validate
```

Deve terminar `SUCCESS` em todos os pacotes alterados. Falha no pacote `@hcengineering/prod` em macOS é aceitável.

Se falhar, corrija todos os erros de tipo antes de prosseguir. Não silencie erros com `@ts-ignore` sem motivo documentado.

### Passo 2 — Build do pod correto

Use a tabela abaixo para identificar qual pod rebuildar:

| Arquivos alterados | Pod(s) | Comando |
|---|---|---|
| `plugins/*-resources/` | `front` | `./3f-build.sh --pod front` |
| `plugins/*/src/index.ts` (sem resources) | `front` + `server` | `./3f-build.sh --pod "front server"` |
| `models/*/`, `server-plugins/*/` | `server` | `./3f-build.sh --skip-webpack --pod server` |
| `server/account*/` | `account` | `./3f-build.sh --skip-webpack --pod account` |
| `services/calendar/` | `calendar` | `./3f-build.sh --skip-webpack --pod calendar` |
| `services/worker/` | `worker` | `./3f-build.sh --skip-webpack --pod worker` |
| `services/github/` | `github` | `./3f-build.sh --skip-webpack --pod github` |
| `services/mail/` | `mail` | `./3f-build.sh --skip-webpack --pod mail` |
| Não sabe ao certo | todos | `./3f-build.sh` |

Para deploy na VPS, adicionar `--vps` ao comando. Serviços usam imagens `hardcoreeng/<pod>:3f-local` (não as publicadas no Docker Hub).

### Passo 3 — Verificar erros de boot

Após o build, verifique os logs:

```bash
# Erros críticos de plugin (NoLocationForPlugin, trigger não encontrado)
docker logs dev-transactor_cockroach-1 2>&1 | grep -E "ERROR|NoLocation|not found" | head -20

# Erros do frontend
docker logs dev-front-1 2>&1 | grep -E "ERROR|error" | head -20
```

Erros `NoLocationForPlugin: X` significam que o plugin não foi registrado em `serverPlugins.ts` ou `platform.ts`.

### Passo 4 — Teste funcional no browser

Acesse `http://localhost:8087` e execute os casos de teste da feature alterada conforme os arquivos em `3f-docs/features/FXX-*/tests.md`.

#### Template de caso de teste

```markdown
## TC-XX-YY — [Ação testada]

**Pré-condição:** [estado inicial necessário]

**Passos:**
1. [ação]
2. [ação]
3. [ação]

**Resultado esperado:** [o que deve acontecer]

**Validação extra:** [verificação em logs ou banco se aplicável]
```

### Passo 5 — Verificar regressão em features existentes

Antes de considerar pronto, confirme que as features já implementadas continuam funcionando:

- [ ] **F01 (Completion Validation):** Ao tentar fechar uma issue sem spent time (se configurado), o sistema bloqueia
- [ ] **F02 (Tag Sharing):** Atribuir tag a colaborador ainda adiciona o colaborador automaticamente ao projeto
- [ ] **F04 (PDCA):** Campo "Ciclo PDCA Ativo" ainda aparece e salva em issues
- [ ] **F09 (Client Fields):** Campos "Nome do Cliente" e "Etapa do Cliente" ainda aparecem no painel lateral de issue

---

## Logs úteis para debug

```bash
# Triggers e erros do transactor
docker logs -f dev-transactor_cockroach-1

# Frontend
docker logs -f dev-front-1

# Auth / account
docker logs -f dev-account-1

# Status de todos os containers
docker compose -f dev/docker-compose.yaml ps
```

---

## Convenção de branches e commits

### Branch
```
feature/descricao-em-kebab-case
fix/descricao-em-kebab-case
refactor/descricao-em-kebab-case
chore/descricao-em-kebab-case
docs/descricao-em-kebab-case
```

### Commit (Conventional Commits)
```
feat(tracker): add campo X em Issue
fix(completion): corrige validação de sub-issue sem spent time
chore(deps): atualiza lockfile após adicionar pacote tag-sharing

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```
