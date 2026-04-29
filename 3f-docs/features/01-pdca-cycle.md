# Feature: Ciclo PDCA Nativo
**Branch:** `feature/pdca-cycle`  
**Prioridade:** Alta  
**Requer Docker rebuild:** Sim (model + trigger + serviço scheduler)

---

## Visão Geral

Quando o campo **Ciclo PDCA Ativo** está habilitado em uma tarefa, o sistema dispara automaticamente um reset de status no início de cada ciclo (conforme a frequência configurada).

### Comportamento esperado

1. Usuário ativa "Ciclo PDCA Ativo" na tarefa e configura:
   - **Frequência:** Semanal / Quinzenal / Mensal
   - **Status ao Reiniciar:** qual status a tarefa recebe no início do ciclo
2. Quando o ciclo dispara:
   - A tarefa **original é mantida** (não cria nova tarefa)
   - O status da tarefa muda para o "Status ao Reiniciar" configurado
   - O responsável recebe notificação
3. O próximo ciclo é agendado automaticamente

### Quando o ciclo dispara

| Frequência | Quando dispara |
|---|---|
| Semanal | Toda segunda-feira às 00:00 |
| Quinzenal | A cada 14 dias a partir da ativação, às 00:00 |
| Mensal | Todo dia 1 do mês às 00:00 |

---

## Modelo de Dados

### Novos campos na interface `Issue`

**Arquivo:** `plugins/tracker/src/index.ts` (linha ~224, ao final da interface `Issue`)

```typescript
// Ciclo PDCA
pdcaCycleActive?: boolean
pdcaCycleFrequency?: PdcaFrequency
pdcaCycleResetStatus?: Ref<IssueStatus>
pdcaNextCycleDate?: Timestamp        // calculado automaticamente pelo trigger
```

### Novo enum `PdcaFrequency`

**Arquivo:** `plugins/tracker/src/index.ts` (junto aos outros enums existentes)

```typescript
export enum PdcaFrequency {
  Weekly = 'weekly',
  Biweekly = 'biweekly',
  Monthly = 'monthly'
}
```

### Novo model decorator em `TIssue`

**Arquivo:** `models/tracker/src/types.ts` (ao final da classe `TIssue`)

```typescript
@Prop(TypeBoolean(), tracker.string.PdcaCycleActive)
  pdcaCycleActive?: boolean

@Prop(TypeString(), tracker.string.PdcaCycleFrequency)
  pdcaCycleFrequency?: PdcaFrequency

@Prop(TypeRef(tracker.class.IssueStatus), tracker.string.PdcaCycleResetStatus)
@Index(IndexKind.Indexed)
  pdcaCycleResetStatus?: Ref<IssueStatus>

@Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.PdcaNextCycleDate)
@Hidden()
  pdcaNextCycleDate?: Timestamp
```

### Novas strings i18n

**Arquivo:** `plugins/tracker/src/index.ts` (no objeto `string` do plugin)

```typescript
string: {
  // ... strings existentes ...
  PdcaCycleActive: '' as IntlString,
  PdcaCycleFrequency: '' as IntlString,
  PdcaCycleResetStatus: '' as IntlString,
  PdcaNextCycleDate: '' as IntlString,
  PdcaCycleWeekly: '' as IntlString,
  PdcaCycleбиweekly: '' as IntlString,
  PdcaCycleMonthly: '' as IntlString,
}
```

---

## Fluxo Técnico

```
Usuário ativa pdcaCycleActive = true na tarefa
         ↓
OnIssueUpdate trigger dispara (server-plugins/tracker-resources)
         ↓
Trigger calcula pdcaNextCycleDate com base na frequência
Trigger envia mensagem para QueueTopic.TimeMachine:
  { type: 'schedule', id: 'pdca_{issueId}', targetDate: pdcaNextCycleDate,
    topic: QueueTopic.PdcaCycle, data: { issueId, workspaceId } }
         ↓
TimeMachine service (services/worker) armazena no PostgreSQL
         ↓
No targetDate, TimeMachine publica mensagem em QueueTopic.PdcaCycle
         ↓
PDCA Cycle consumer (services/worker/src/pdca.ts — NOVO) recebe mensagem:
  1. Cria TxUpdateDoc: issue.status = pdcaCycleResetStatus
  2. Cria TxUpdateDoc: issue.pdcaNextCycleDate = próximo ciclo calculado
  3. Aplica as Txs via workspace API
  4. Envia notificação ao assignee
  5. Agenda próximo ciclo via TimeMachine
```

### Cálculo da próxima data de ciclo

```typescript
function calculateNextCycleDate(frequency: PdcaFrequency, from: Timestamp): Timestamp {
  const date = new Date(from)
  switch (frequency) {
    case PdcaFrequency.Weekly:
      // próxima segunda-feira
      const daysUntilMonday = (8 - date.getDay()) % 7 || 7
      date.setDate(date.getDate() + daysUntilMonday)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    case PdcaFrequency.Biweekly:
      date.setDate(date.getDate() + 14)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    case PdcaFrequency.Monthly:
      // dia 1 do próximo mês
      date.setMonth(date.getMonth() + 1, 1)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
  }
}
```

---

## Arquivos a Modificar

| Arquivo | O que mudar |
|---|---|
| `plugins/tracker/src/index.ts` | Adicionar enum `PdcaFrequency`, campos em `Issue`, strings i18n |
| `models/tracker/src/types.ts` | Adicionar props na classe `TIssue` com decorators |
| `models/tracker/src/migration.ts` | Adicionar step de migração para indexar `pdcaNextCycleDate` |
| `models/server-tracker/src/index.ts` | Registrar novo trigger `OnPdcaCycleToggle` via `builder.createDoc` |
| `server-plugins/tracker/src/index.ts` | Declarar resource key `OnPdcaCycleToggle` |
| `server-plugins/tracker-resources/src/index.ts` | Implementar `OnPdcaCycleToggle` + exportar no default |
| `foundations/server/packages/core/src/queue/types.ts` | Adicionar `PdcaCycle = 'pdcaCycle'` ao enum `QueueTopic` |
| `services/worker/src/worker.ts` | Registrar novo consumer `pdcaCycleConsumer` |
| `plugins/tracker-resources/src/components/issues/edit/` | Adicionar controles UI de PDCA no painel da issue |

---

## Novos Arquivos a Criar

| Arquivo | Propósito |
|---|---|
| `services/worker/src/pdca.ts` | Consumer Kafka para `QueueTopic.PdcaCycle` — lógica de reset e reagendamento |
| `plugins/tracker-resources/src/components/issues/edit/PdcaCycleSection.svelte` | Seção "Ciclo PDCA" no painel lateral da issue |

---

## Componentes Svelte

### `PdcaCycleSection.svelte`

Seção colapsável no painel lateral da issue. Aparece apenas quando o Space Type do projeto tiver o campo `pdcaCycleActive` configurado.

**Controles:**
1. Toggle "Ciclo PDCA Ativo" (BooleanPresenter existente)
2. Dropdown "Frequência" — Semanal / Quinzenal / Mensal (só visível quando ativo)
3. Select "Status ao Reiniciar" — lista os statuses do projeto atual (só visível quando ativo)
4. Label readonly "Próximo ciclo em: [data]" (só visível quando ativo + data calculada)

**Onde integrar:** `plugins/tracker-resources/src/components/issues/edit/IssueEditor.svelte`
Adicionar `<PdcaCycleSection {issue} {space} />` junto às outras seções do painel.

---

## Passo a Passo de Implementação

### Fase 1 — Model (sem comportamento, só estrutura)
1. Adicionar enum `PdcaFrequency` em `plugins/tracker/src/index.ts`
2. Adicionar os 4 campos em `Issue` interface
3. Adicionar as 4 strings i18n
4. Adicionar props com decorators em `TIssue` em `models/tracker/src/types.ts`
5. Adicionar step de migração em `models/tracker/src/migration.ts`
6. `rush build` + rebuild Docker do transactor para migrar o model

### Fase 2 — Backend: trigger de agendamento
7. Adicionar `PdcaCycle = 'pdcaCycle'` em `QueueTopic` no foundations
8. Declarar resource key `OnPdcaCycleToggle` em `server-plugins/tracker/src/index.ts`
9. Implementar `OnPdcaCycleToggle` em `server-plugins/tracker-resources/src/index.ts`:
   - Detectar mudança em `pdcaCycleActive` ou `pdcaCycleFrequency`
   - Se ativado: calcular próxima data + enviar para TimeMachine + salvar `pdcaNextCycleDate`
   - Se desativado: cancelar timer via TimeMachine (`type: 'cancel'`)
10. Registrar o trigger em `models/server-tracker/src/index.ts`
11. `rush build` + rebuild Docker

### Fase 3 — Backend: consumer de execução
12. Criar `services/worker/src/pdca.ts` com o consumer:
   - Recebe `{ issueId, workspaceId }` do Kafka
   - Faz `findAll` para buscar a issue
   - Cria `TxUpdateDoc` para mudar o status
   - Cria `TxUpdateDoc` para atualizar `pdcaNextCycleDate`
   - Envia notificação ao assignee
   - Reagenda próximo ciclo via TimeMachine
13. Registrar consumer em `services/worker/src/worker.ts`
14. `rush build` + rebuild Docker do worker

### Fase 4 — Frontend
15. Criar `PdcaCycleSection.svelte`
16. Integrar no `IssueEditor.svelte`
17. Testar via hot reload

---

## Riscos Técnicos

| Risco | Severidade | Mitigação |
|---|---|---|
| TimeMachine não está disponível se worker service não estiver rodando no docker-compose local | Alta | Verificar se `worker` está no docker-compose.yaml; se não, adicionar |
| Orphaned timers: issue é deletada mas o timer permanece no TimeMachine | Média | Adicionar trigger `OnIssueRemove` que cancela o timer via `type: 'cancel'` |
| pdcaNextCycleDate calculada no fuso errado (servidor UTC vs usuário GMT-3) | Média | Salvar como UTC, exibir no fuso do usuário no frontend |
| Múltiplos workspaces: consumer recebe evento do workspace errado | Baixa | `workspaceId` está no payload; consumer filtra por workspace |
| Ciclo dispara quando issue já está no status de reset (sem mudança real) | Baixa | Consumer verifica se status atual != resetStatus antes de criar Tx |
| Upgrade do Huly upstream conflita com campos adicionados na Issue | Baixa | Campos com prefixo `pdca` são improváveis de colidir com upstream |

---

## Dependência: Worker Service no Docker

Antes de iniciar a implementação, verificar se o `worker` service está ativo no docker-compose:

```bash
docker ps | grep worker
```

Se não estiver rodando, verificar `dev/docker-compose.yaml` e `pods/worker/` ou `services/worker/`.  
O `TimeMachine` **só funciona se o worker estiver rodando**.

---

## Implementação — Decisões Tomadas

**Data:** 2026-04-24  
**Branch:** `feature/pdca-cycle` (a partir de `integration/tracker-fields` que já inclui F03)

### Arquivos modificados (lista final real)

| Arquivo | Mudança |
|---|---|
| `plugins/tracker/src/index.ts` | Enum `PdcaFrequency` + 4 campos em `Issue` |
| `plugins/tracker-resources/src/plugin.ts` | 7 novas IntlStrings PDCA |
| `plugins/tracker-assets/lang/en.json` | Strings em inglês |
| `plugins/tracker-assets/lang/pt-br.json` | Strings em pt-BR (traduzidas) |
| `plugins/tracker-assets/lang/pt.json` | Strings em pt (traduzidas) |
| `plugins/tracker-assets/lang/cs|de|es|fr|it|ja|ru|tr|zh.json` | Strings em inglês (fallback) |
| `models/tracker/src/types.ts` | `TypeBoolean` import + 4 `@Prop` em `TIssue` |
| `foundations/server/packages/core/src/queue/types.ts` | `QueueTopic.PdcaCycle = 'pdcaCycle'` |
| `server-plugins/tracker/src/index.ts` | Resource keys `OnPdcaCycleToggle` e `OnPdcaCycleCancel` |
| `server-plugins/tracker-resources/src/index.ts` | Implementação dos dois triggers + helper functions |
| `models/server-tracker/src/index.ts` | Registro dos dois triggers |
| `services/worker/src/config.ts` | `AccountsUrl` e `Secret` |
| `services/worker/package.json` | 4 novas deps: `api-client`, `account-client`, `server-token`, `tracker` |
| `services/worker/src/worker.ts` | `startPdcaConsumer()` no startup |
| `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte` | Import + render de `PdcaCycleSection` + 4 keys no `ignoreKeys` |

### Novos arquivos criados

| Arquivo | Propósito |
|---|---|
| `services/worker/src/pdca.ts` | Consumer Kafka para `QueueTopic.PdcaCycle` |
| `plugins/tracker-resources/src/components/issues/PdcaCycleSection.svelte` | Seção PDCA no painel da issue |

### Decisões de implementação

1. **Trigger separado `OnPdcaCycleToggle`** (não modificou `doIssueUpdate`) — conforme decisão arquitetural do review
2. **`TimeMachineMessage` duplicada como interface local** em `server-plugins/tracker-resources` — evita dependência circular com `server-process`
3. **Frequencies como string literals** em `pdca.ts` (não import de enum) — o consumer do worker não precisa de toda a dependência do tracker só para comparar 3 strings
4. **Worker estendido** (não novo serviço) para hospedar o consumer PDCA — simplifica operação
5. **`pdcaNextCycleDate` com `@Hidden()`** — não aparece na lista de atributos genéricos
6. **PDCA fields no `ignoreKeys`** do ControlPanel — evita renderização duplicada pelos campos genéricos
7. **`OnPdcaCycleToggle` usa `findAll` após a Tx** para sempre ter o estado final da issue — mais seguro que inferir a partir das operations

### Como testar

1. Subir o dev server: `cd dev/prod && rushx dev-server`
2. Abrir uma issue → painel lateral → deve aparecer "Ciclo PDCA ativo" com toggle
3. Ativar o toggle → deve aparecer dropdowns de frequência e status de reinício
4. Selecionar frequência "Semanal" e um status de retorno → campo "Próximo ciclo" deve aparecer após disparo do trigger
5. Para testar o timer (requer Docker rebuild + worker rodando com DB): verificar no PostgreSQL se o evento foi criado em `time_machine.delayed_events`

**Requires Docker rebuild:** transactor (model + trigger) + worker (consumer PDCA)

```bash
# Rebuild transactor
rush build
cd pods/server && rushx docker:build
docker compose up -d --force-recreate transactor

# Rebuild worker
cd services/worker && rushx docker:build
docker compose up -d --force-recreate worker
```

---

## Estimativa de Esforço

| Fase | Complexidade | Estimativa |
|---|---|---|
| Fase 1 — Model | Baixa | 1–2h |
| Fase 2 — Trigger de agendamento | Média-Alta | 3–4h |
| Fase 3 — Consumer de execução | Alta | 4–6h |
| Fase 4 — Frontend | Baixa-Média | 2–3h |
| **Total** | | **10–15h** |

O maior risco de tempo está na Fase 3, que envolve entender e integrar com a infraestrutura Kafka/TimeMachine do worker service.
