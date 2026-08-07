# F12 — Changelog / Contexto vivo

> **Para que serve este arquivo:** manter o contexto da feature vivo para _handoff_
> entre agentes/sessões. Se você é um agente novo pegando a F12, **leia isto primeiro**
> para saber em que pé estamos sem re-derivar tudo (e sem bagunçar o que já funciona).
>
> Divisão de papéis dos docs desta pasta:
> - **`context.md`** → o **design**: objetivo, modelo de dados (3 estados), contrato da
>   Core, arquitetura, fases e decisões travadas. É a fonte da verdade do _porquê_.
> - **`changelog.md`** (este) → o **log de progresso**: o que foi feito, quando, estado
>   de build/validação, o que falta e as armadilhas descobertas no caminho.

---

## Estado atual (resumo para quem pega agora)

- **Branch:** `feat/clientname-via-core` (nada commitado ainda; ver "Regras" abaixo).
- **Implementação:** Fases 0–5 completas + **paginação/busca** na tela de acompanhamento.
- **Validação:**
  - `rush validate` → **exit 0** (todos os pacotes).
  - `svelte-check` (só `tracker-resources`) → **ZERO erros nos arquivos da F12**.
    ⚠️ O repo shippa com **32 erros svelte-check pré-existentes** em outros arquivos
    (`templates/*.svelte`, `settings/EditAutomationScript.svelte`) — **não são nossos** e
    não bloqueiam build. `svelte-check` **não** faz parte do gate do `rush validate` nem
    do webpack; use-o manualmente como checagem extra dos `.svelte`.
  - webpack front → compilou com sucesso (`WEBPACK_EXIT=0`).
- **Falta (nesta ordem):**
  1. Build: `./3f-build.sh --pod "front server account"` (`--vps` para produção).
  2. Smoke test no browser (criar/editar issue, tela de Configurações → Clientes).
  3. Rodar reconciliação em prod: `automation/reconcile-clients.ts` (dry-run → `--apply`).
- **Deploy é do dono do repo.** NÃO bumpar `common/scripts/version.txt`, NÃO commitar
  segredos, NÃO `git add .`/`-A`. A key real da Core mora em `dev/.env.secrets` (fora do git).

---

## Arquivos tocados (mapa rápido)

**Fase 0 — schema/migration/trigger** (pods `front` + `server`)
- `plugins/tracker/src/index.ts` — `clientCoreId?: number` em `Issue`/`IssueDraft`; IntlStrings `ClientCoreId`, `ClientsMigration`.
- `models/tracker/src/types.ts` — `@Prop(TypeNumber())` `@Index(Indexed)` `@Hidden()` `clientCoreId`.
- `models/tracker/src/migration.ts` — state `subIssueInheritClientCoreId` (herança raiz→sub via `attachedTo`).
- `server-plugins/tracker-resources/src/index.ts` — trigger `OnIssueClientPropagate` propaga `clientCoreId` (create/reparent/update).
- `plugins/tracker-assets/lang/{en,pt,pt-br}.json` — traduções.

**Fase 1 — ler /clients** (pods `account` + `front`)
- `server/account/src/threefcore.ts` — `interface CoreClient` (sem PII) + `fetchCoreClients()` (cache 60s, `X-API-Key`).
- `server/account-service/src/index.ts` — rota proxy `GET /api/v1/clients` (valida token Huly; 502 se Core cair).
- `plugins/tracker-resources/src/clients.ts` — store Svelte + `ensureClients`/`refreshClients`/`searchClients`/`clientLabel`/`normalizeClient` + `openClientPopup` (helper do popup, compartilhado por seletor e presenter).

**Fase 2 — seletor/presenter** (pod `front`)
- `plugins/tracker-resources/src/components/issues/ClientNameSelector.svelte` (novo) — dropdown `SelectPopup` searchable; fallback texto-livre (`EditBox`) se Core fora; prop `showPending` (default true) desliga o indicador "não vinculado" p/ templates.
- `plugins/tracker-resources/src/components/templates/{CreateIssueTemplate,IssueTemplateChildEditor,TemplateControlPanel}.svelte` — cliente do template usa o `ClientNameSelector` (`showPending={false}`, só o nome; sem `clientCoreId`).
- `plugins/tracker-resources/src/components/issues/ClientNamePresenter.svelte` — **editor inline** na lista/kanban (clique → seletor → `updateDoc`); marca "pendente" (itálico/âmbar + tooltip); prop `showStage` cola o badge da etapa ao nome.
- `plugins/tracker-resources/src/components/issues/ClientStagePresenter.svelte` — badge da Etapa **editável inline** (clique → popup das 4 etapas → `updateDoc`).
- `plugins/tracker-resources/src/components/issues/ClientStageSelector.svelte` — editor da Etapa no painel da tarefa/criação (SelectPopup); item usa `text` (não `label`) p/ não estourar `Invalid Id`.
- `plugins/tracker-resources/src/components/issues/ClientOption.svelte` (novo) — item do SelectPopup de clientes: rótulo + **tag "churn"**.
- `plugins/tracker-resources/src/components/settings/RunAutomationScript.svelte` — runner de automação usa o `ClientNameSelector` (era `EditBox` livre) e grava `clientCoreId` nas tarefas criadas (raiz + filhas).
- `models/tracker/src/viewlets.ts` — `issueConfig()`: coluna do cliente com `showStage: true`; coluna separada de Etapa **removida** da lista de issues.
- `plugins/tracker-resources/src/components/CreateIssue.svelte` — usa o seletor (bind `clientName`/`clientCoreId`), propaga p/ sub-issues.
- `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte` — seletor na tela de edição.
- `plugins/tracker-resources/src/components/SubIssues.svelte` — recebe/propaga `clientCoreId`.

**Propagação em fluxos automáticos** (pod `worker`)
- `services/worker/src/pdca.ts` — duplicação do ciclo PDCA leva `clientCoreId` junto (raiz + sub-issues), além de `clientName`/`clientStage`.

**Fase 3 — reconciliação**
- `automation/reconcile-clients.ts` (novo) — one-off, match por `common_name` normalizado; dry-run por padrão, `--apply`, `--csv`.

**Fases 4–5 — tela de acompanhamento + vínculo em lote** (pod `front`)
- `plugins/tracker-resources/src/components/settings/ClientsMigration.svelte` (novo) — KPIs, progresso, tabela por cliente, painel de pendências, **vínculo em lote**, **busca + paginação**.
- `plugins/tracker-resources/src/plugin.ts` + `.../index.ts` — id/registro do componente `ClientsMigrationSettings`.
- `models/tracker/src/index.ts` — `WorkspaceSettingCategory` "Clientes" (grupo `settings-editor`, `role: Maintainer`); **`ClassFilters` da Issue**: `clientName` usa o `ClientNameFilter` (filtro próprio com busca); `clientStage` usa `ValueFilter` (4 valores, sem busca).
- `plugins/tracker-resources/src/components/issues/ClientNameFilter.svelte` (novo) — filtro do cliente com **busca**: carrega os clientes presentes nas issues 1x e filtra client-side; mantém o contrato do Filter (`[[chave,[nomesOriginais]]]`). Registrado em `plugin.ts` + `index.ts`.
- `plugins/tracker-resources/src/components/issues/KanbanView.svelte` — CSS do card: linha de chips (cliente/etapa/prazo) passa a **quebrar** (`flex-wrap: wrap`) e `.client-chip` `max-width: 100%` p/ não cortar os campos em cards estreitos.

**Ajustes de UX da lista** (pod `front`)
- `plugins/tracker-resources/src/components/issues/DueDatePresenter.svelte` — prop `showUnset` (default `kind === 'list'`): renderiza placeholder "Data limite" clicável mesmo sem data → **define/altera a due date direto na lista**. Kanban/PDCA inalterados.
- `plugins/tracker-resources/src/components/issues/ClientNamePresenter.svelte` — prop `maxWidth` (default `'12rem'`) trunca nome longo com "…" (`min-width: 0` no `.name`); badge da etapa segue visível, tooltip mostra o nome inteiro.
- `models/tracker/src/viewlets.ts` — coluna do cliente: `width` → `maxWidth` (o `width` era ignorado pelo presenter).

---

## Armadilhas já descobertas (não repita)

- **Cast TS em expressão de template quebra o webpack.** `on:change={(e) => { x = {...} as any }}`
  passa no `rush validate` (TS-aware) mas o compilador Svelte cru do webpack rejeita (`ParseError`).
  → Nunca use `as` dentro de `{ }` de template; resolva com `bind:` ou tipando no `<script>`.
- **`svelte-check` ≠ gate de build.** Ele pega erros de tipo/parse nos `.svelte` que o
  `rush validate` e o webpack (transpile-only) **não** pegam. Rode-o manualmente:
  `plugins/tracker-resources/node_modules/.bin/svelte-check --output human`
  (o wrapper `rushx svelte-check` dá ENOENT no Windows).
- **`clientName`/`clientStage`/`clientCoreId` moram no JSONB `data`** da tabela `task`
  (não são colunas). SQL: `data->>'clientName'`, workspace = coluna `"workspaceId"`.
- **Tooltip de string crua** → `use:tooltip={{ label: getEmbeddedLabel('texto') }}`
  (não existe `title` em `LabelAndProps`).
- **`EditBox`** aceita `kind: EditStyle` (`'editbox'|'default'|'ghost'|…`, **não** `'regular'`)
  e **não** tem prop `size`.
- **`SelectPopup`: item `text` (string crua) vs `label` (`IntlString`).** Se você passar
  o rótulo em `label`, o platform tenta **traduzir** e estoura `Invalid Id: <rótulo>` (toast
  vermelho no topo). Para texto literal (nomes de etapa, nomes de cliente) use **sempre
  `text`**. Foi exatamente o bug do editor de Etapa no painel da tarefa (2026-08-06).

---

## Log

### 2026-08-06 — "Tarefas por cliente" 15/página (era 50)
- **Pedido:** paginar melhor a tabela "Tarefas por cliente" da tela de controle
  (`ClientsMigration.svelte`). A paginação já existia (`clientSlice`/`clientPages`/pager),
  mas com `CLIENT_PAGE_SIZE = 50` o paginador só aparecia acima de 51 clientes e cada
  página era um scroll longo.
- **Fix:** `CLIENT_PAGE_SIZE` 50 → **15** (igual à tabela de pendências). Com ~312 clientes
  → ~21 páginas; o paginador passa a aparecer a partir de 16 clientes vinculados.
- **100% front**, uma linha; sem mudança de model/tipo.

### 2026-08-06 — Due date editável na lista + limite de largura do nome do cliente
- **Pedido 1 (due date):** poder **alterar a due date direto na lista** de tarefas. O
  presenter já era editável quando havia data (clicar abre o `DatePopup`), mas
  `DueDatePresenter.svelte` fazia `shouldRenderPresenter = dueDateMs != null` → tarefa
  **sem data não renderizava nada**, logo não havia onde clicar para definir.
  - **Fix (100% front):** novo prop `showUnset?: boolean` (default = `kind === 'list'`).
    `shouldRenderPresenter = dueDateMs != null || (isEditable && showUnset)`. Na lista
    (`kind: 'list'`) passa a mostrar um **placeholder clicável "Data limite"** (pílula com
    ícone de calendário, via `DatePresenter` da UI) que abre o popup e grava por
    `updateCollection`. Cards do **kanban** (`kind: 'link-bordered'`) e o PDCA (usa o
    `DueDatePresenter` da UI, não este) **continuam ocultos quando vazios**.
  - **Sem mudança de model.** A coluna já existia em `viewlets.ts` (`props: { kind: 'list' }`).
- **Pedido 2 (largura do nome):** razão social longa (ex.: "CULTIVO FERTILIZANTES DO
  BRASIL, INDÚSTRIA, COMÉRCIO E REPRESENTAÇÃO…") **estourava a linha inteira** na lista.
  Causa: `ClientNamePresenter` **não declarava** o prop `width`, então o `width: '12rem'`
  da config era **silenciosamente ignorado** e a célula crescia até o tamanho do conteúdo
  (o `.name` com ellipsis nunca truncava porque sempre sobrava espaço).
  - **Fix:** prop real **`maxWidth` (default `'12rem'`)** aplicado como `max-width` no botão
    do nome e no span read-only; `min-width: 0` no `.name` para o **ellipsis** funcionar
    dentro do flex. O **badge da etapa continua visível** (o nome trunca, a etapa não).
    Tooltip segue mostrando o nome completo. `viewlets.ts`: `width` → **`maxWidth`** na
    config da coluna do cliente (correção semântica; entra no rebuild de model já exigido).
- **Validação:** svelte-check **28 erros / 85 warnings** (baseline, zero nos dois
  componentes); `tsc --noEmit` de `models/tracker` → **exit 0**.
- **Deploy:** `front` (ambos os componentes). O `viewlets.ts` (model) é onde vive a config
  da coluna — o due date funciona sem tocar no model; o `maxWidth` da config só passa a
  valer no upgrade de model, mas o **default `'12rem'` já protege** no front sozinho.

### 2026-08-06 — Filtro do cliente sem busca → componente próprio `ClientNameFilter`
- **Bug (reportado):** ao filtrar pelo nome do cliente, **não dava para pesquisar** o
  cliente na lista. Causa: eu tinha apontado `clientName` para o `ValueFilter`, mas ele
  **só renderiza a caixa de busca para `TypeNumber`/`EnumOf`** (`ValueFilter.svelte:52`:
  `isSearchable = [TypeNumber, EnumOf].includes(...)`). Como `clientName` é `TypeString`,
  virava uma checklist longa **sem busca** — inviável com ~300 clientes. (A entrada
  anterior do log dizia "ValueFilter pesquisável" — estava errado p/ string.)
- **Fix:** criado **`ClientNameFilter.svelte`** (filtro próprio do tracker) que:
  - carrega os `clientName` presentes nas issues **1x** (findAll com `projection` +
    `showArchived` do view option), dedup por chave caixa-alta;
  - mostra **sempre** a caixa de busca e filtra a lista **client-side** (via
    `normalizeClient` de `clients.ts`, sem acento/caixa) → **sem `$like` por tecla**
    (não repete query na tabela `task`);
  - preserva o contrato do Filter: `filter.value = [[chave, [nomesOriginais]]]` — o
    `valueInResult` casa por `p[1]` (os nomes originais gravados na issue).
  - Registrado em `plugins/tracker-resources/src/plugin.ts` (id) + `index.ts` (impl);
    apontado no `ClassFilters` (`models/tracker/src/index.ts`). `clientStage` fica no
    `ValueFilter` (4 valores → não precisa de busca).
- **Validação:** svelte-check **28 erros / 85 warnings** (baseline, zero no arquivo novo);
  `tsc --noEmit` de `models/tracker` → **exit 0** (`tracker.component.ClientNameFilter`
  resolve porque o plugin do model faz mergeIds sobre o do tracker-resources).
- **Deploy:** `front` (componente) + `server`/model (ClassFilters) — mesma esteira/upgrade
  de model que as outras mudanças da F12 já exigem.

### 2026-08-06 — PDCA duplicava tarefa perdendo o vínculo com a Core (pod `worker`)
- **Bug encontrado (pedido de verificação):** a duplicação do ciclo PDCA
  (`services/worker/src/pdca.ts`) copiava `clientName` e `clientStage` da original, mas
  **NÃO copiava `clientCoreId`** — nem na issue-raiz recriada (l. 397) nem nas sub-issues
  recriadas quando `resetSubIssues` (l. 462). Efeito: **toda tarefa recriada pelo ciclo
  nascia "pendente"** (com o nome, sem o vínculo), mesmo que a original estivesse
  vinculada — e a cada ciclo o vínculo se perdia de novo.
- **Fix:** adicionado `clientCoreId: (issue as any).clientCoreId` no objeto da raiz e
  `clientCoreId: (child as any).clientCoreId` no das sub-issues. Casts `as any` como no
  padrão já existente ali (objeto da raiz é `Record<string,any>`, o da filha é `as any`).
- **⚠️ Deploy — pod novo p/ a F12:** isto é **`services/worker`** → pod **`worker`**
  (backend, não front). Build: `./3f-build.sh --skip-webpack --pod worker`. Primeira
  mudança da F12 fora de front/server/account.
- **Validação:** `tsc --noEmit` do pacote `worker` → **exit 0**.

### 2026-08-06 — Kanban sem cortar campos + filtro pesquisável + auditoria dos locais
- **Kanban cortava os chips** (cliente/etapa vinham "Ador…", "4R COR…", etapa "Onb"):
  a linha de chips do card (`.card-labels`) era `flex-wrap: nowrap`, então todos os
  chips disputavam uma única linha e eram truncados. Passou a **`flex-wrap: wrap`**
  (com `row-gap`), e `.client-chip` foi de `max-width: 8rem` p/ **`100%`**. Agora, se
  não couber, o chip do cliente desce de linha em vez de cortar. A linha de **tags**
  (`.labels`) segue `nowrap` (tem compressão própria — intacta). CSS puro, pod `front`.
- **Filtrar/agrupar pelo cliente** (pedido): agrupar por `clientName`/`clientStage` já
  existia (`groupBy` em `issuesOptions`). O que faltava era o **filtro pesquisável**:
  `clientName`/`clientStage` são `TypeString` → caíam no `StringFilter` (caixa de
  "contém"), não num seletor. Trocados no `ClassFilters` da Issue para
  **`ValueFilter`** (lista de valores existentes, com busca) — o usuário escolhe/pesquisa
  os clientes direto no filtro. `clientStage` renderiza como badge (via
  `ClientStageValuePresenter` já registrado). É **model** (`models/tracker/src/index.ts`)
  → vale no workspace pelo mesmo upgrade das outras mudanças de model da F12.
- **Auditoria "outros locais onde o nome do cliente aparece"** (pedido): varridos os 19
  arquivos que referenciam `clientName`/`clientStage`/`clientCoreId`. Situação:
  - ✅ **Já no seletor da Core:** `CreateIssue`, `ControlPanel` (painel), `ClientNamePresenter`
    (lista/kanban, inline), `RunAutomationScript` (runner de automação).
  - ✅ **Só leitura, corretos:** `issueTableFormatter.ts` (exportação — trata `clientName`
    e `clientStage`), `AutomationScriptsPage`/`ScriptExecutionTasksPopup` (histórico de
    execuções — mostra o `clientName` gravado no `ScriptExecution`), `IssuesView`
    (gate `useClientName` por projeto).
  - ✅ **Toggle `useClientName` do projeto verificado (2026-08-06, sem alteração):** o
    toggle (`CreateProject.svelte`, default `true` via migration `projectUseClientName`)
    segue funcionando com a F12 — `CreateIssue` gera `showClientFields` que envolve o
    `ClientNameSelector`/`ClientStageSelector` novos (l. 1136), e `IssuesView` tira as
    colunas por chave `clientName`/`clientStage` (a célula combinada continua sob
    `clientName`). Ressalva pré-F12 (não regressão): o toggle nunca escondeu o **filtro**
    — se quiserem, dá p/ estender `getVisibleFilters` (hoje só tira 'space') p/ remover
    clientName/clientStage quando o projeto tem `useClientName:false`. Opcional/cosmético.
  - ✅ **Templates convertidos (front puro, sem schema):** o usuário optou por "seletor
    da Core só no nome". `CreateIssueTemplate`, `IssueTemplateChildEditor` e
    `TemplateControlPanel` trocaram o `<EditBox>`/`AttributeBarEditor` livre de
    `clientName` pelo **`ClientNameSelector`** — gravando só o `clientName` canônico
    (o template **não** tem `clientCoreId`, então nada de schema/migration). Novo prop
    **`showPending`** no `ClientNameSelector` (default `true`): os templates passam
    `showPending={false}` para não exibir o indicador "não vinculado" (num template isso
    não faz sentido — ele nunca guarda o id). Nos 2 formulários o valor entra por
    `bind:clientName`; no painel do template existente entra por `on:change` →
    `client.update(issue, { clientName })` (espelha o `ClientStageSelector` ao lado).
    Se a Core cair, cai para `EditBox` livre (fallback do próprio seletor). Ganho:
    acaba com typo e o nome do template já sai canônico (casa na reconciliação/dashboard);
    a issue criada do template ainda nasce "pendente" (sem id), mas com nome limpo.
    Bônus: sumiu 1 erro de baseline do svelte-check (o `EditBox size="large"` inválido).

### 2026-08-06 — Tag "churn" no seletor + scripts de automação vinculam cliente
- **Tag de churn no seletor de clientes** (pedido): clientes com `status === 'churn'`
  na Core agora mostram uma **tag vermelha "churn"** à direita do nome no popup.
  - Novo componente **`ClientOption.svelte`** (rótulo + tag) usado como `component`
    de cada item do `SelectPopup`. O item mantém `text` preenchido para a **busca do
    popup continuar funcionando** (o filtro do SelectPopup casa por `text`).
  - Em `clients.ts`: helper **`isChurn(c)`** (`status.toLowerCase() === 'churn'`) e
    construtor compartilhado **`clientPopupItems(clients, currentId?)`**. Usado pelo
    `openClientPopup` (seletor de criar/editar/inline) **e** pelo vínculo em lote da
    tela de Clientes (`ClientsMigration.linkAll`) → tag consistente nos dois lugares.
- **Scripts de automação passam a vincular o cliente à Core** (pedido — o campo era
  texto livre). Em `RunAutomationScript.svelte` (runner da nossa feature de automação):
  - O `<EditBox>` livre do "Nome do Cliente" virou **`<ClientNameSelector bind:clientName
    bind:clientCoreId />`** (mesmo seletor da criação de issue; cai p/ texto livre se a
    Core cair). `EditBox` removido do import (sem outro uso).
  - As tarefas criadas pelo script (raiz **e** filhas) agora gravam **`clientCoreId`**
    além de `clientName`/`clientStage` → nascem **vinculadas** (antes nasciam "pendentes").
    Se o operador digitar texto livre (Core fora), nasce pendente, como antes.
  - `ScriptExecution` (histórico) segue só com `clientName` (rótulo) — não precisa do id.
- **Validação:** svelte-check → ZERO erros/avisos nos arquivos F12 (total 29 / 85 warn).
- **Deploy:** tudo **front puro** (pod `front`).

### 2026-08-06 — Fix "Invalid Id: <etapa>" no painel + pendências 15/página
- **Bug (reportado com print):** trocar a **Etapa dentro da tarefa** (painel lateral)
  mostrava um toast vermelho `Invalid Id: Churned` no topo.
  - **Causa:** `ClientStageSelector.svelte` (editor usado no `ControlPanel` **e** no
    `CreateIssue`) montava os itens do `SelectPopup` com `label: o.label`. `label` é
    `IntlString` → o platform tenta traduzir `'Churned'` como id de tradução e falha.
  - **Fix:** trocar para `text: o.label` (string crua) — mesmo padrão já usado no
    `ClientStagePresenter` da lista. Removido o `color` do item (o `SelectPopup` não o
    usa; o badge colorido continua no botão fechado). **Um só arquivo** corrige o painel
    e o diálogo de criação (ambos usam esse seletor).
  - Ver nova entrada em "Armadilhas": `SelectPopup` `text` vs `label`.
- **Ajuste pedido:** paginação da tabela de **pendências (não vinculados)** passou a
  **15 por página** (antes 50). Em `ClientsMigration.svelte` o `PAGE_SIZE` único virou
  **`PENDING_PAGE_SIZE = 15`** e **`CLIENT_PAGE_SIZE = 50`** (a tabela "por cliente"
  segue em 50). Todos os pontos ajustados (páginas, slice, clamp, texto "X–Y de N").
- **Validação:** svelte-check → ZERO erros/avisos em qualquer arquivo F12 (total 29).
- **Deploy:** ambos são **front puro** (pod `front`) — nada de model.

### 2026-08-06 — Etapa editável inline + cliente & etapa na mesma célula
- **Pedido:** deixar a **etapa** também editável pela lista e, se possível, mostrá-la
  **ao lado do nome do cliente**.
- **`ClientStagePresenter.svelte`** virou **editor inline**: `<button on:click|stopPropagation>`
  que abre um `SelectPopup` com as 4 etapas (enum local, **não** depende da Core) e grava via
  `client.updateDoc(value._class, value.space, value._id, { clientStage })`. Propaga p/
  sub-issues pelo mesmo trigger `OnIssueClientPropagate`. Prop `editable` (default true).
- **Cliente + etapa na mesma célula (lista):** `ClientNamePresenter` ganhou a prop
  `showStage` (default false); quando ligada e a issue tem cliente, renderiza o
  `ClientStagePresenter` **colado ao nome**. Em `models/tracker/src/viewlets.ts`
  (`issueConfig()`) a coluna de nome passou a usar `props: { showStage: true }` e a **coluna
  separada de Etapa foi removida** (some o divisor entre elas).
- **Armadilha (HTML):** o presenter do nome é `<button>`; não dá pra aninhar o `<button>`
  da etapa dentro. Solução: um `<div class="client-cell">` como wrapper com os **dois botões
  irmãos** (nome + etapa), lado a lado com `gap`.
- **Kanban intacto:** tem config própria (array de strings, não usa `issueConfig()`), então
  segue com os dois chips separados — só que agora ambos editáveis. Nada duplicado.
- **Templates intactos:** a lista de templates (`issueConfig` NÃO usada lá) mantém a coluna
  de Etapa própria — agora também editável.
- ⚠️ **Deploy — atenção:** `viewlets.ts` é **model**. A *edição inline* dos dois presenters
  é front puro (vale com o rebuild do `front`). Mas o *layout novo* (etapa dentro da célula
  do cliente + remoção da coluna) é config de viewlet no model → só aparece no workspace de
  produção pelo **caminho de upgrade do model** (bump em `common/scripts/version.txt` +
  restart do `workspace_cockroach`), como toda mudança de model. **Sem o upgrade** a
  degradação é graciosa: continuam as duas colunas antigas, já **editáveis**.
- **Validação:** svelte-check → ZERO erros nos arquivos F12 (total do pacote 29);
  `model-tracker` compilou limpo.

### 2026-08-05 — Edição inline do cliente pela lista/kanban
- **Pedido:** poder selecionar o cliente **direto pela lista de tarefas** (antes só no
  criar/abrir issue).
- **`ClientNamePresenter.svelte`** deixou de ser só leitura e virou **editor inline**:
  é um `<button>` (acessível, sem warning a11y) com `on:click|stopPropagation` (não abre
  a tarefa ao clicar) que abre o seletor da Core e grava via `client.updateDoc(value._class,
  value.space, value._id, { clientCoreId, clientName })`. Mostra placeholder "—" clicável
  quando a issue não tem cliente (dá pra atribuir a partir da lista). Prop `editable`
  (default `true`) permite um modo leitura pura se algum contexto precisar.
- **Propagação p/ sub-issues:** nada novo — o `updateDoc` dispara o trigger
  `OnIssueClientPropagate` no servidor, que cascateia igual ao fluxo de criar/editar.
- **Refactor anti-duplicação:** a lógica do popup foi extraída para
  **`openClientPopup(event, currentId, onSelect)` em `clients.ts`**, reaproveitada pelo
  `ClientNameSelector` (formulário) e pelo `ClientNamePresenter` (lista/kanban).
- **Bônus:** o card do Kanban (`KanbanView.svelte`) usa o mesmo presenter → ficou
  editável lá também; o `stopPropagation` garante que clicar no chip do cliente não abre
  o card.
- **Onde aparece:** a coluna já era registrada em `models/tracker/src/viewlets.ts`
  (`presenter: tracker.component.ClientNamePresenter`, `key: ''` = recebe a Issue inteira).
  **Nenhuma mudança de model/schema** foi necessária — é 100% front.
- **Validação:** svelte-check → ZERO erros nos arquivos F12; total do pacote caiu 32 → 29
  (corrigimos 3 pré-existentes, nenhum novo).
- ⚠️ Menor: se clicar antes de a lista da Core carregar, o popup abre vazio (o presenter
  faz `ensureClients()` no `onMount`, então na prática já está pronto). Etapa do cliente
  (`clientStage`) continua **só leitura** na lista — replicar o mesmo padrão nela é um
  follow-up fácil se quiserem.

### 2026-08-05 — Paginação + limpeza de tipos
- **Tela "Clientes" (ClientsMigration.svelte): busca + paginação client-side** nas duas
  tabelas (por-cliente e pendências), `PAGE_SIZE = 50`. Motivo: produção tem **muitos**
  clientes; sem paginação a tela montava listas gigantes e travava o render.
  - Campo de busca por tabela (normaliza sem acento/caixa), reset de página ao digitar.
  - Rodapé "Anterior / X–Y de N / Próxima"; página é _clampada_ ao filtrar.
  - KPIs e barra de progresso continuam somando o **total** (não a página).
- **Correção de erros de tipo herdados da Fase 2** (svelte-check), 2 deles funcionais:
  - `ClientNameSelector`/`ClientNamePresenter`: tooltip usava `title` (não renderizava) →
    `label: getEmbeddedLabel(...)`.
  - `ClientNameSelector`: `EditBox` do fallback tinha `kind={'regular'}` (inválido) e
    `size` (inexistente) → `kind={'editbox'}`, `size` removido.
- **Validação:** svelte-check → **ZERO erros** nos arquivos F12.
- ⚠️ Pendência conhecida de escala (não resolvida hoje): a tela ainda **carrega as
  issues-raiz no cliente** (`findAll` com `limit: 20000`) para agregar. Se produção passar
  de 20k raízes, aparece o banner de "limite" e os números subcontam. Fix definitivo =
  agregação server-side (endpoint com `groupBy`), fora do escopo de hoje.

### até 2026-08-04 — Implementação inicial (Fases 0–5)
- Modelo **nome + id**: mantém `clientName` (string denormalizada, funciona offline) e
  adiciona `clientCoreId?: number` (vínculo forte com a Core).
- 3 estados por issue: **vinculado** (tem `clientCoreId`) / **pendente** (só `clientName`
  livre) / **sem cliente** (vazio). Ver tabela em `context.md`.
- Integração espelha a org-structure do F10: fetch só server-side no `account`
  (`X-API-Key`) → proxy `GET /api/v1/clients` (token Huly) → store no front.
- Seletor mostra **todos os status** (inclui churn/cancelado — decisão travada); busca é
  **client-side** (o `/clients/search` da Core não cobre `common_name`).
- Reconciliação casa `normalize(clientName)` × `normalize(common_name)`; match único
  seta `clientCoreId` + canoniza o nome; sem match fica pendente. Dry-run primeiro.
- Contrato da Core validado (293–298 clientes, `id` numérico, `common_name` nullable
  ~58%+ preenchido). Detalhes em `context.md` §"Contrato da 3F Core".
