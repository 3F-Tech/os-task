# F12 — Nome do Cliente via 3F Core

## Status
🚧 Em implementação (branch `feat/clientname-via-core`)

Evolução da **F09 (Client Fields)**: o `clientName` da Issue deixa de ser texto livre e
passa a referenciar o cadastro de clientes da **3F Core**. A F09 continua valendo para o
campo `clientStage` (etapa), que **permanece local** — não vem da Core.

---

## Objetivo

Fazer o "Nome do Cliente" das tarefas sair de um **texto livre** (fonte de divergência:
"Bomma" ≠ "bomma" ≠ "Bomma ") para uma **seleção do cadastro canônico** da 3F Core, sem
big-bang: quem casa vira vinculado; quem não casa continua texto livre até correção manual.

---

## Modelo de dados — os 3 estados do cliente numa tarefa

Derivados de dois campos na `Issue`:

| Estado | `clientCoreId` | `clientName` | Significado |
|---|---|---|---|
| ✅ **Vinculado** | preenchido (`number`) | nome canônico da Core | Casou na reconciliação ou alguém escolheu no seletor |
| 🟡 **Pendente** | ausente | texto livre ("Bomma") | Não casou — espera correção manual |
| ⚪ **Sem cliente** | ausente | vazio | Importer/GitHub, ou nunca preenchido |

- **`clientName: string`** (já existia na F09) — **denormalizado**: é o que aparece na tela.
  Lê direto do doc → funciona com a Core offline.
- **`clientCoreId?: number`** (novo) — id do cliente na Core (`client.id`, padrão do `coreBuId`
  do F10). É o **vínculo forte**; presença = "vinculado".

Regra de gravação do seletor: `clientName = common_name ?? name` + `clientCoreId = id`.

Sub-issues **herdam** os dois campos da issue-raiz (trigger `OnIssueClientPropagate` +
migration), como já acontecia com `clientName`/`clientStage`.

---

## Contrato da 3F Core (recurso `/clients`)

Documentado em [`../F11-Login-Universal/API.md`](../F11-Login-Universal/API.md) §6.14 e
`DATABASE.md` (tabela `client`). Consumo **backend-to-backend** com header `X-API-Key`.

| Rota | Uso |
|---|---|
| `GET /clients?page=&perPage=&is_active=` | Lista paginada (`{data,meta:{total}}`), ordena por `name`. **Alimenta o seletor.** |
| `GET /clients/search?q=` | Busca por `name` **ou** `document` — **NÃO** cobre `common_name`. Por isso a busca do seletor é **client-side**. |
| `POST /clients/batch {ids:[…]}` | Hidrata vários por id (omite inexistentes sem erro). Útil na reconciliação. |
| `GET /clients/:id` | Item único (único lugar com `logo_picture`). |
| — | **Não existe `DELETE`** (desativar = `PATCH {is_active:false}`). |

**Shape do item** (campos que usamos, sem PII): `id` (número), `name` (razão social),
`common_name` (apelido, **nullable**, ≤150), `status`, `is_active`.

- **`status`** (5 valores): `active` · `aguardando_renovacao` · `em_cancelamento` · `churn` ·
  `cancelado`. ⚠️ `cancelado ≠ churn`. **Decisão:** o seletor **mostra todos os status**.
- **`is_active`** ≠ status: é soft-delete do registro. O proxy filtra `is_active=true`
  (exclui soft-deleted; churn continua aparecendo).
- **`common_name`** foi populado pela 3F a partir dos apelidos que já usávamos no 3F Tasks
  (o usuário levantou os nomes via SQL no CockroachDB e montou a tabela apelido→common_name).

### API Key
A key do `account` precisa alcançar `/clients` — hoje ela é do tipo **`adm`** (`admin:*`),
que cobre `clients:read`. (O tipo `login` NÃO tem `clients:read`.)

---

## Arquitetura — espelha a org-structure do F10

```
Browser ──Bearer <token Huly>──►  account (/api/v1/clients)  ──X-API-Key──►  3F Core /clients
  (nunca vê a API Key)             server/account-service                    (identidade canônica)
```

- Cliente HTTP da Core só no `account` (`server/account/src/threefcore.ts`).
- Proxy REST autenticado por token Huly.
- Front consome com `fetch(AccountsUrl + /api/v1/clients, Bearer <Token>)` + store Svelte.

---

## Fases de implementação

| Fase | O que | Arquivos | Pod |
|---|---|---|---|
| **0 — Fundação** | Campo `clientCoreId?: number` (indexado, `@Hidden`); migration (herança da raiz); trigger `OnIssueClientPropagate` propaga o id; label + traduções | `plugins/tracker/src/index.ts`, `models/tracker/src/types.ts`, `models/tracker/src/migration.ts`, `server-plugins/tracker-resources/src/index.ts`, `plugins/tracker-assets/lang/*.json` | front+server |
| **1 — Ler /clients** | `fetchCoreClients()` + interface `CoreClient` (sem PII); proxy `GET /api/v1/clients`; store no front | `server/account/src/threefcore.ts`, `server/account-service/src/index.ts`, `plugins/tracker-resources/src/clients.ts` | account+front |
| **2 — Seletor + presenter** | `ClientNameSelector.svelte` (busca client-side, mostra todos os status, fallback texto-livre se Core fora); substitui EditBox no criar/editar; presenter distingue vinculado × pendente × sem cliente | `plugins/tracker-resources/src/components/...`, `CreateIssue.svelte`, `edit/ControlPanel.svelte` | front |
| **3 — Reconciliação** | Script one-off: casa `clientName` atual → cliente por `common_name`; seta `clientCoreId` + normaliza o nome; não-casados ficam pendentes. Dry-run + input opcional de CSV (tabela apelido→common_name) | `automation/reconcile-clients.ts` | — |
| **4 — Tela de acompanhamento** | Página de Settings (`WorkspaceSettingCategory`, `role: Owner`): KPIs (total, % vinculadas, pendentes, sem cliente, progresso), tabela por cliente, painel de pendências | `plugins/tracker-resources/src/components/settings/...`, `models/tracker`, `plugins/setting-*` | front |
| **5 — Correção em lote** | Da tela de pendências: atribuir todas as tarefas com `clientName='X'` a um cliente numa tacada | idem Fase 4 | front |

Deploy toca **3 pods**: `front` + `server` + `account`
(`./3f-build.sh --pod "front server account"`, `--vps` para produção).

---

## Reconciliação (regra exata)

- Casa `normalize(clientName)` (sem acento, minúsculo, trim) contra `normalize(common_name)`.
  Só **`common_name`** a princípio (decisão do usuário).
- **Match único →** seta `clientCoreId` + troca `clientName` pelo nome cadastrado.
- **Sem match / ambíguo →** deixa o texto livre (pendente).
- Roda **dry-run** primeiro (só relatório: matched / pendente / sem-cliente), depois pra valer.
- Só precisa rodar sobre as **issues-raiz**; o trigger cascateia o `clientCoreId` pras sub-issues.
- Input opcional: CSV `apelido,common_name` (a tabela que o usuário montou) para os casos que
  o match direto não pegar.

---

## Decisões travadas

| Decisão | Escolha |
|---|---|
| Modelo do dado | **nome + id** (`clientName` denormalizado + `clientCoreId`) |
| Exibição offline | Sempre lê `clientName` salvo; só criar/trocar precisa da Core online |
| `clientStage` | **Continua local** — não vem da Core |
| Match na reconciliação | Só `common_name` (a princípio) |
| Status no seletor | **Mostra todos** (inclusive churn/cancelado) |
| Casa da tela de acompanhamento | **Configurações** (Settings), tela separada, `role: Owner` |
| Fallback Core fora | Seletor cai para **texto livre** (não trava criação) |

---

## Pontos de atenção

- **`common_name` ~58%+ preenchido e subindo** — os `null` caem no fallback `name` (razão social).
- **Dashboard (F10) agrupa cliente por string** (`metricsGreen.ts`): passará a agrupar por
  `clientCoreId ?? normalize(clientName)` para robustez na transição.
- **Perf:** a tela de acompanhamento varre muitas issues — usar projeção leve
  (`clientName`, `clientCoreId`, `clientStage`, `space`) e guarda de limite.
- Sem PII no proxy (nada de documento/endereço/contato) — mesma regra da org-structure.

---

## Estado da implementação (branch `feat/clientname-via-core`)

Fases 0–5 implementadas. Falta: `rush validate` limpo, build/deploy e smoke test.

### Arquivos alterados/criados

**Fase 0 (schema/migration/trigger):**
- `plugins/tracker/src/index.ts` — `clientCoreId?: number` em `Issue`/`IssueDraft`; IntlStrings `ClientCoreId`, `ClientsMigration`.
- `models/tracker/src/types.ts` — `@Prop(TypeNumber())` `@Index` `@Hidden` `clientCoreId`.
- `models/tracker/src/migration.ts` — state `subIssueInheritClientCoreId`.
- `server-plugins/tracker-resources/src/index.ts` — trigger `OnIssueClientPropagate` propaga `clientCoreId`.
- `plugins/tracker-assets/lang/{en,pt,pt-br}.json` — traduções.

**Fase 1 (ler Core):**
- `server/account/src/threefcore.ts` — `CoreClient` + `fetchCoreClients()`.
- `server/account-service/src/index.ts` — rota `GET /api/v1/clients`.
- `plugins/tracker-resources/src/clients.ts` — store + `ensureClients`/`searchClients`/`clientLabel`.

**Fase 2 (seletor/presenter):**
- `plugins/tracker-resources/src/components/issues/ClientNameSelector.svelte` (novo).
- `.../ClientNamePresenter.svelte` — marca "pendente" (não vinculado).
- `.../CreateIssue.svelte`, `.../issues/edit/ControlPanel.svelte`, `.../SubIssues.svelte` — usam o seletor + propagam `clientCoreId`.

**Fase 3 (reconciliação):** `automation/reconcile-clients.ts` (dry-run por padrão, `--apply`, `--csv`).

**Fases 4–5 (tela + lote):**
- `plugins/tracker-resources/src/components/settings/ClientsMigration.svelte` (novo) — KPIs, tabela por cliente, painel de pendências, vínculo em lote.
- `plugins/tracker-resources/src/plugin.ts` + `.../index.ts` — id/registro do componente.
- `models/tracker/src/index.ts` — `WorkspaceSettingCategory` "Clientes" (`role: Maintainer`, grupo `settings-editor`).

### Pendências conhecidas (follow-up)
- **Dashboard (F10):** ainda agrupa cliente por string (`metricsGreen.ts`). Migrar para
  `clientCoreId ?? normalize(clientName)` fica para um segundo passo (não bloqueia).
- **Rodar a reconciliação** (`reconcile-clients.ts --apply`) em produção após o deploy.
- **Seletor sem match:** se o cliente não existe na Core, hoje não há "criar na Core" pelo Huly
  (cadastro é na Core). Fallback de texto livre só quando a Core está fora.
- Deploy: `./3f-build.sh --pod "front server account" --vps`.
