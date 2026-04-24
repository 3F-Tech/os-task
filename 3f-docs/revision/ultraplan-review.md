# Relatório de Revisão — Ultraplans 3F Hub

**Data:** 2026-04-23  
**Revisor:** Claude Code (Arquiteto Sênior — revisão automatizada local)  
**Scope:** Features 01 a 05 planejadas para desenvolvimento paralelo

---

## 1. Conflitos de Arquivos

### Matriz de conflitos

| Arquivo | F01 PDCA | F02 Validação | F03 Datas | F04 Cliente/Etapa | F05 Tags |
|---|:---:|:---:|:---:|:---:|:---:|
| `plugins/tracker/src/index.ts` | ✓ | ✓ | ✓ | ✓ | — |
| `models/tracker/src/types.ts` | ✓ | ✓ | ✓ | ✓ | — |
| `models/tracker/src/index.ts` | — | ✓ | — | ✓ | — |
| `models/tracker/src/plugin.ts` | — | ✓ | — | ✓ | — |
| `models/server-tracker/src/index.ts` | ✓ | ✓ | ✓ | — | — |
| `server-plugins/tracker-resources/src/index.ts` | ✓ | ✓ | ✓ | — | — |
| `server-plugins/tracker/src/index.ts` | ✓ | — | ✓ | — | — |
| `plugins/tracker-resources/src/plugin.ts` | — | ✓ | ✓ | ✓ | — |
| `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte` | — | — | ✓ | ✓ | — |
| `models/all/src/index.ts` | — | — | — | — | ✓ |
| `rush.json` | — | — | — | — | ✓ |

### Detalhamento por arquivo crítico

#### `plugins/tracker/src/index.ts` — 4 features (F01, F02, F03, F04)

| Feature | O que adiciona |
|---|---|
| F01 | Enum `PdcaFrequency` + 4 campos opcionais em `Issue` + strings i18n |
| F02 | Types `CompletionRuleKey`, `CompletionRule`, interface `IssueCompletionConfig` |
| F03 | 2 campos (`startDate`, `completedDate`) em `Issue` |
| F04 | 2 campos (`clientName`, `clientStage`) em `Issue` + IDs de componentes |

**Resolução:** Designar um desenvolvedor responsável por este arquivo como "merge owner". Estratégia recomendada:
1. F03 commita primeiro (menor, sem dependências)
2. F04 rebases em cima de F03
3. F01 e F02 rebasam em cima do estado consolidado

As adições são em seções distintas (interface `Issue`, enums, strings) — merge técnico é simples, mas precisa de coordenação para evitar conflito de git.

#### `models/tracker/src/types.ts` — 4 features (F01, F02, F03, F04)

| Feature | O que adiciona |
|---|---|
| F01 | 4 `@Prop` ao final da classe `TIssue` |
| F02 | Nova classe `TIssueCompletionConfig` com `@Mixin` (após `TProject`) |
| F03 | 2 `@Prop` na classe `TIssue` (após `dueDate`) |
| F04 | 2 `@Prop` na classe `TIssue` (após bloco de Milestone) |

**Resolução:** Mesma estratégia de merge owner. F02 é o menos conflitante (adiciona classe nova, não modifica `TIssue`). F01, F03 e F04 tocam `TIssue` em posições próximas — risco de conflito de hunks no git se desenvolvidos simultaneamente.

#### `server-plugins/tracker-resources/src/index.ts` — 3 features (F01, F02, F03)

| Feature | O que modifica |
|---|---|
| F01 | Implementa e exporta `OnPdcaCycleToggle` (função nova) |
| F02 | Implementa e exporta `OnIssueCompletionCheck` (função nova) |
| F03 | **Modifica a função existente `doIssueUpdate`** para adicionar lógica de datas automáticas |

**Risco alto:** F03 propõe modificar `doIssueUpdate`, que é código existente complexo. F01 e F02 adicionam funções novas ao mesmo arquivo. Se F03 fizer o merge antes e alterar `doIssueUpdate`, F01 e F02 precisarão rebasar em cima dessa mudança.

**Resolução recomendada:** F03 deve criar uma subfunção `handleAutomaticDates(issue, updateTx, control)` chamada dentro de `doIssueUpdate`, em vez de alterar o corpo principal — isso reduz a área de conflito. Fazer F03 primeiro neste arquivo.

#### `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte` — F03, F04

| Feature | O que modifica |
|---|---|
| F03 | Adiciona `startDate` e `completedDate` ao `ignoreKeys` + renderiza editores |
| F04 | Adiciona `clientName` e `clientStage` ao `ignoreKeys` + renderiza editores |

**Resolução:** As adições são no mesmo array (`ignoreKeys`) e no mesmo template. Fazer F03 primeiro; F04 rebasa em cima do ControlPanel atualizado.

#### `models/tracker/src/index.ts` — F02, F04

| Feature | O que modifica |
|---|---|
| F02 | Registra `TIssueCompletionConfig` no `createModel` + adiciona `WorkspaceSettingCategory` |
| F04 | Semeia `core.class.Enum` para ClientStage + registra presenters via `builder.mixin` + registra `SettingsCategory` |

**Resolução:** Adições em pontos diferentes do createModel — merge é viável. Atenção para não duplicar registros de settings category.

---

## 2. Conflitos de Modelo de Dados

### Campos adicionados à interface `Issue`

| Campo | Feature | Tipo | Obrigatório |
|---|---|---|---|
| `pdcaCycleActive` | F01 | `boolean?` | Não (opcional) |
| `pdcaCycleFrequency` | F01 | `PdcaFrequency?` | Não |
| `pdcaCycleResetStatus` | F01 | `Ref<IssueStatus>?` | Não |
| `pdcaNextCycleDate` | F01 | `Timestamp?` | Não |
| `startDate` | F03 | `Timestamp \| null` | Não (nullable) |
| `completedDate` | F03 | `Timestamp \| null` | Não (nullable) |
| `clientName` | F04 | `string` | **Sim (!)** |
| `clientStage` | F04 | `string` | **Sim (!)** |

**Sem colisão de nomes** — todos os campos têm nomes distintos.

### Problema crítico: campos obrigatórios em F04

F04 declara `clientName!: string` e `clientStage!: string` com o operador `!` (non-null assertion), tornando-os **obrigatórios sem default value** no TypeScript. Isso significa:

1. Todas as issues existentes no banco ficarão sem esses campos → erro de runtime ao ler a issue
2. A migration em F04 está listada como "opcional" na Fase 6 — **não é opcional, é obrigatória**
3. F01 e F03 usam campos opcionais (`?` ou `| null`) — padrão mais seguro

**Recomendação:** Alterar para `clientName?: string` e `clientStage?: string` (opcionais), ou confirmar que a migration defensiva (inicializar `''`) será executada **antes** de qualquer código que leia esses campos.

### Dependência F02 → F03

F02 define `CompletionRuleKey` com a opção `'completedDate'` que explicitamente depende do campo `completedDate` da F03. O plan F02 reconhece isso na seção de Riscos e em Dependências.

Se F02 for ativada antes de F03:
- A regra `completedDate` estará disponível na UI de configuração
- Mas o campo `completedDate` não existirá na issue → a regra retornará falso para todas as issues
- Isso **não quebra** o sistema (regra desabilitada por padrão), mas confunde o administrador que ativar a regra

**Resolução:** Documentar no código da `EditCompletionRules.svelte` que a checkbox `completedDate` só deve aparecer quando `feature/automatic-dates` estiver ativa. Ou ocultar a opção condicionalmente.

### Interação F01 + F02 + F03 (runtime)

Quando PDCA dispara (F01) e muda o status da issue para `pdcaCycleResetStatus`:
1. F03 detecta que o status mudou. Se saiu de Won → limpa `completedDate`
2. F02 valida se pode ir para Won (se o trigger disparar em status de reset que é Won) — mas como o PDCA está voltando para um status não-Done, F02 não bloqueia

Não há conflito funcional. O fluxo é coerente.

---

## 3. Conflitos de Permissões

### Análise do middleware de permissões

**F05 (Tag Sharing):** Escolheu a abordagem **denormalized** (Opção A) — triggers atualizam `Space.members` diretamente quando tags são atribuídas/removidas. **Nenhuma mudança no middleware** `foundations/communication/packages/server/src/middleware/permissions.ts`.

**F02 (Validação):** O trigger de backend é um **safety net de compensação** — não bloqueia transações no middleware de permissões. Usa `TxUpdateDoc` compensatório para reverter status. Não toca o middleware.

**Conclusão: Não há conflito entre F02 e F05 no sistema de permissões.** Ambos podem ser desenvolvidos em paralelo sem risco de sobreposição.

### Unique concern: F05 modifica `SpaceMembersEditor.svelte`

F05 modifica `plugins/contact-resources/src/components/SpaceMembersEditor.svelte` para adicionar a seção "Acesso por Tag". Nenhuma outra feature toca este arquivo. Sem conflito.

### Ordem de desenvolvimento para permissões

Nenhuma ordenação obrigatória. F05 pode ser iniciado a qualquer momento sem esperar as outras features.

---

## 4. Dependências Entre Features

```
F03 (Datas) ──────────────────── completedDate ──────► F02 (Validação) [regra funcional]
                                                        └── sem F03, regra existe mas nunca satisfaz

F01 (PDCA) ────── status reset ──────────────────────► F03 (Datas) [limpa completedDate ao sair de Done]
                                                        └── interação correta, sem conflito

F04 (Cliente) ──── campos clientName/clientStage ────► F02 (Validação) [potencial regra futura]
                                                        └── não implementado ainda; sem dependência agora

F05 (Tags) ─── independente de todas as outras features
F01 (PDCA) ─── independente do F05
```

### Tabela de dependências

| Feature | Depende de | Tipo de dependência | Severidade se ignorada |
|---|---|---|---|
| F02 (Validação) | F03 (Datas) | Regra `completedDate` não funciona sem `completedDate` field | Baixa (regra off por padrão) |
| F03 (Datas) | — | Nenhuma | — |
| F01 (PDCA) | — | Nenhuma | — |
| F04 (Cliente/Etapa) | — | Nenhuma | — |
| F05 (Tags) | — | Nenhuma | — |

---

## 5. Consistência com o Padrão do Huly

### F01 — PDCA Cycle

| Check | Status | Observação |
|---|---|---|
| `@Prop`, `@Index` corretos | ✓ | Uso correto em todos os campos |
| Mutações via Tx | ✓ | `TxUpdateDoc` para status e nextCycleDate |
| Novo plugin segue 6 passos | N/A | Não é plugin novo, extensão do tracker |
| Arquivos críticos tocados sem necessidade | — | `foundations/.../queue/types.ts` é necessário para `QueueTopic.PdcaCycle` |
| **Problema:** Typo no ID i18n | ⚠️ | `PdcaCycleбиweekly` contém caracteres cirílicos — deve ser `PdcaCycleBiweekly` |
| Cancelamento de timer ao deletar issue | ⚠️ | Identificado como risco mas **não está nos passos de implementação** |

### F02 — Completion Validation

| Check | Status | Observação |
|---|---|---|
| `@Mixin` sobre `Project` correto | ✓ | Abordagem idiomática no Huly |
| Mutações via Tx | ✓ | Compensating Tx correta — entende a limitação do pipeline de triggers |
| Novo mixin segue padrão | ✓ | `TIssueCompletionConfig` com `@Mixin`, `@UX`, `@Prop` |
| Ponto de injeção no frontend não identificado | ⚠️ | Risco #1 explicitado — precisa ser resolvido antes de iniciar Fase 4 |
| Safety net de backend: estado pré/pós-update | ⚠️ | Risco #2: trigger pode ler estado após update — precisa verificação |

### F03 — Automatic Dates

| Check | Status | Observação |
|---|---|---|
| `@Prop(TypeDate(...))` correto | ✓ | `DateRangeMode.DATETIME` adequado |
| Mutações via Tx | ✓ | `TxUpdateDoc` para ambos os campos |
| Alternativa não decidida no plan | ⚠️ | Plan lista 2 abordagens para o trigger (inline em `OnIssueUpdate` vs novo `OnAutomaticDates`) sem decidir qual usar. **Deve ser decidido antes de iniciar** para evitar conflito com F01/F02 no mesmo arquivo |

**Recomendação:** Usar trigger separado `OnAutomaticDates` (mais isolado). Modificar `doIssueUpdate` aumenta o risco de regressão.

### F04 — Cliente/Etapa

| Check | Status | Observação |
|---|---|---|
| `@Prop(TypeString())` e `@Prop(TypeEnum(...))` corretos | ✓ | Uso adequado |
| `@Index(IndexKind.FullText)` para clientName | ✓ | Correto para campo de busca |
| Campos obrigatórios sem migration obrigatória | ✗ | `clientName!` e `clientStage!` sem migration = runtime error |
| i18n em arquivo diferente de F02 | ⚠️ | F04 usa `plugins/tracker-assets/lang/en.json`, F02 usa `plugins/tracker-resources/src/strings/en.ts` — verificar qual é o arquivo correto para o pacote `tracker` |
| Risco de armazenamento do Enum | ⚠️ | `TypeEnum` armazena o label, não um ID imutável — se renomear etapa, dados históricos ficam inconsistentes. Plan identifica mas não resolve. |

### F05 — Tag Sharing

| Check | Status | Observação |
|---|---|---|
| Novo plugin segue 6 passos | ✓ | Todos os 6 passos presentes: IDs → model → createModel → all/index → rush.json → workbench |
| `@Model`, `@Mixin`, `@Prop` corretos | ✓ | `TTaggedProfile` como mixin sobre `contact.mixin.Employee` segue padrão HR |
| Mutações via Tx | ✓ | Triggers usam `TxCreateDoc`/`TxRemoveDoc` e updates via API |
| Arquivo crítico `permissions.ts` | ✓ | **Não modificado** — abordagem denormalized evita toque no middleware |
| `models/all/src/index.ts` | ✓ | Registrado como step 1.4 |

---

## 6. Ordem de Execução Recomendada

### Features 100% independentes (podem rodar em paralelo sem risco)

- **F05 (Tag Sharing)** com **qualquer outra feature** — nenhum arquivo compartilhado com F01–F04
- **F04 (Cliente/Etapa)** com **F05** — completamente independentes

### Features que compartilham arquivos (requerem coordenação)

**Grupo Tracker (F01, F02, F03, F04):** Compartilham `plugins/tracker/src/index.ts` e `models/tracker/src/types.ts`.

**Estratégia recomendada — merge sequencial por camadas:**

```
Fase A (paralelo):
  ├── Dev A: F03 (Datas Automáticas) — 6h — menor, fundação de F02
  ├── Dev B: F04 (Cliente/Etapa) — 12h
  └── Dev C: F05 (Tags) — 29h — totalmente independente

Fase B (após merge de F03):
  ├── Dev D: F02 (Validação) — rebases em F03 — 12h
  └── Dev A: F01 (PDCA) — pode iniciar paralelo com F02 após F03 merge — 10–15h

Merge de ControlPanel.svelte:
  → F03 commita ControlPanel primeiro
  → F04 rebases em F03 para ControlPanel

Merge de tracker/src/index.ts e types.ts:
  → Designar um merge owner por arquivo
  → Ordem: F03 → F04 → F01 → F02
```

### Se apenas um desenvolvedor:

```
1. F03 (6h) — fundação
2. F04 (12h) — independente, sem espera
3. F01 (10–15h) — independente
4. F02 (12h) — usa completedDate de F03; maior valor após F03
5. F05 (29h) — qualquer ordem, mas é o mais longo
```

---

## 7. Riscos Globais

### Risco 1 — Explosion de merge em `plugins/tracker/src/index.ts` (Alta severidade)

Quatro features modificam o mesmo arquivo simultaneamente. Em um monorepo com rush, merges neste arquivo são lentos de revisar e fáceis de conflitar. **Este é o maior risco operacional do projeto.**

**Mitigação:** Designar um responsável por manter uma "branch de integração tracker" que vai consolidando os PRs na ordem definida. Cada feature faz PR para a branch de integração, não diretamente para develop.

### Risco 2 — `doIssueUpdate` em `server-plugins/tracker-resources/src/index.ts` (Alta severidade)

F03 propõe modificar a função mais complexa do tracker server. Se F01 e F02 também precisarem de mudanças no mesmo arquivo (triggers adicionados), há risco de conflito de hunks.

**Mitigação:** F03 deve isolar mudanças em subfunção `handleAutomaticDates()`. F01 e F02 devem apenas adicionar funções novas no final do arquivo.

### Risco 3 — Migration obrigatória de F04 ignorada (Média severidade)

`clientName!: string` sem migration quebra issues existentes silenciosamente em runtime (campo undefined). O plan classifica a migration como "Fase 6 opcional".

**Mitigação:** Tornar a migration obrigatória. Executar antes do primeiro deploy. Ou mudar para campos opcionais (`clientName?: string`).

### Risco 4 — Inconsistência de i18n entre features (Baixa severidade)

F02 usa `plugins/tracker-resources/src/strings/en.ts` enquanto F04 usa `plugins/tracker-assets/lang/en.json`. Se um deles estiver errado, as strings não serão carregadas.

**Mitigação:** Verificar qual é o arquivo correto para o plugin `tracker` antes de iniciar qualquer feature. Uma chamada ao sistema de strings do Huly esclarecer o caminho real.

### Risco 5 — Docker rebuild não coordenado (Baixa severidade)

F01 requer rebuild do transactor (model + trigger) e do worker (consumer Kafka). Se múltiplas features forem deploiadas juntas, o Docker rebuild precisa contemplar todos os serviços afetados de uma vez.

**Mitigação:** Definir um checklist de rebuild antes de merge para develop:
- Transactor: F01, F02, F03, F04 (qualquer mudança de model)
- Worker: F01 (novo consumer Kafka)
- Frontend: todas

### Risco 6 — `TypeEnum` de F04 armazena label mutável (Média severidade)

O Huly's `TypeEnum` armazena o valor string do label do enum (ex: `"Onboarding"`), não um ID. Se um admin renomear "Onboarding" para "Onboard", todas as issues antigas ficam com `clientStage: "Onboarding"` que não corresponde a nenhum valor do enum.

**Mitigação:** Verificar o comportamento do `TypeEnum` no código do Huly antes de implementar. Se confirmar o problema, usar `key` imutável em vez de `label`.

---

## 8. Ajustes Recomendados por Ultraplan

### F01 — PDCA Cycle

1. **Corrigir typo crítico no ID i18n:** `PdcaCycleбиweekly` (tem caracteres cirílicos) → deve ser `PdcaCycleBiweekly`
2. **Adicionar passo de implementação:** "Criar trigger `OnIssueRemove` que cancela o timer PDCA no TimeMachine ao deletar uma issue" — está nos riscos mas ausente dos passos
3. **Decidir abordagem do trigger:** O plan menciona que a lógica pode ser adicionada ao `OnIssueUpdate` existente. Definir antes de começar que será um trigger separado `OnPdcaCycleToggle` para evitar conflito com F02/F03 que também tocam triggers do tracker

### F02 — Completion Validation

1. **Identificar o handler de status change ANTES de iniciar a Fase 4.** Este é o maior risco técnico do plan e não tem como ser resolvido durante a implementação sem uma exploração prévia do código
2. **Adicionar dependência explícita:** "Feature depende de F03 (feature/automatic-dates) para a regra `completedDate` ser funcional. Ocultar esta opção na UI enquanto F03 não estiver ativa."
3. **Esclarecer path de i18n:** Confirmar se o arquivo correto é `strings/en.ts` ou `lang/en.json`

### F03 — Automatic Dates

1. **Decidir abordagem de trigger:** O plan lista "Alternativa: incorporar no `OnIssueUpdate`" mas recomenda trigger separado `OnAutomaticDates`. **Esta decisão deve ser feita antes de iniciar** — impacta coordenação com F01 e F02. Recomendação: trigger separado
2. **Adicionar abordagem alternativa para `startDate`:** O plan identifica que preencher `startDate` no frontend (em `CreateIssuePopup.svelte`) é mais robusto que o trigger. Definir se vai usar apenas trigger, apenas frontend, ou ambos

### F04 — Cliente/Etapa

1. **Tornar migration obrigatória:** Mover a "Fase 6 — Migration" para **Fase 0** (antes de qualquer deploy) e remover o qualificador "se necessário". Issues sem `clientName` e `clientStage` causarão erros de runtime se os campos forem non-optional
2. **Considerar campos opcionais:** Mudar de `clientName!: string` para `clientName?: string` elimina a dependência de migration. Downside: código de UI precisará de null checks
3. **Confirmar path de i18n:** Verificar se o tracker usa `plugins/tracker-assets/lang/en.json` ou `plugins/tracker-resources/src/strings/en.ts` para strings de UI
4. **Resolver risco do TypeEnum antes de implementar:** Testar o comportamento do `TypeEnum` com renomeação de label em ambiente local antes de commitar a abordagem

### F05 — Tag Sharing

1. Nenhum ajuste crítico necessário
2. **Opcional:** Documentar no trigger `onTagAssignedOrRemoved` como acessar `contact.mixin.Employee` de forma segura (cross-plugin concern)
3. **Opcional:** Adicionar step de verificação: confirmar que o campo `userTags` em `TaggedProfile` mixin não conflita com nenhum campo do `contact.mixin.Employee` existente

---

## Tabela Resumo

| Feature | Pode iniciar imediatamente? | Depende de | Conflitos identificados |
|---|---|---|---|
| 01 — PDCA | Sim | — | `plugins/tracker/src/index.ts`, `models/tracker/src/types.ts`, `models/server-tracker/src/index.ts`, `server-plugins/tracker-resources/src/index.ts` com F02 e F03 |
| 02 — Validação | Sim (mas F03 primeiro para completedDate) | F03 (funcionalidade completa) | `plugins/tracker/src/index.ts`, `models/tracker/src/types.ts`, `server-plugins/tracker-resources/src/index.ts` com F01 e F03 |
| 03 — Datas | **Sim — iniciar primeiro** | — | `plugins/tracker/src/index.ts`, `models/tracker/src/types.ts`, `ControlPanel.svelte` com F04; `server-plugins` com F01 e F02 |
| 04 — Cliente/Etapa | Sim (paralelo com F03) | — | `plugins/tracker/src/index.ts`, `models/tracker/src/types.ts`, `ControlPanel.svelte` com F03; `models/tracker/src/index.ts` com F02 |
| 05 — Tags | **Sim — totalmente independente** | — | Nenhum — plugin completamente novo, sem sobreposição com F01–F04 |

---

## Apêndice: Estratégia de Branch Recomendada

```
develop
  └── integration/tracker-fields    ← branch de integração para F01–F04
        ├── feature/automatic-dates          (F03 — commita primeiro)
        ├── feature/client-name-stage        (F04 — rebases em F03 para ControlPanel)
        ├── feature/pdca-cycle               (F01 — rebases em F03 para server plugins)
        └── feature/issue-completion-validation  (F02 — rebases em F03 para completedDate)

develop
  └── feature/tag-based-sharing     ← branch independente, PR direto para develop
```

Fazer merge de `integration/tracker-fields` → `develop` em um único PR quando todas as 4 features estiverem validadas. Isso evita N merges conflitantes e simplifica o Docker rebuild.
