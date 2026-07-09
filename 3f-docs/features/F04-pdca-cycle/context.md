# F04 — Ciclo PDCA

## Status
✅ Implementada (pod `worker`)

**Branch:** `feature/pdca-cycle`  
**Prioridade:** Alta

---

## Objetivo

Permitir que uma issue seja marcada como recorrente no ciclo PDCA. Quando ativado, o sistema **reinicia automaticamente a tarefa** (modo padrão) ou **cria uma nova tarefa** (modo opcional) ao vencimento de cada ciclo, com frequência configurável.

---

## Campos novos na Issue

Estes são **campos reais do modelo** (`@Prop`) na interface `Issue` (`plugins/tracker/src/index.ts` ~274-281) — **não** são custom fields configurados via Settings.

| Campo | Tipo | Descrição |
|---|---|---|
| `pdcaCycleActive` | `boolean` | Liga/desliga a recorrência PDCA na issue |
| `pdcaCycleFrequency` | `PdcaFrequency` | Frequência do ciclo (ver enum abaixo) |
| `pdcaCycleResetStatus` | `Ref<IssueStatus>` | Status para o qual a tarefa é resetada no início de cada ciclo |
| `pdcaNextCycleDate` | `Timestamp` | Watermark do próximo disparo (usado para idempotência) |
| `pdcaCycleDueDays` | `number[]` | Dias usados para calcular o `dueDate` do ciclo |
| `pdcaCycleCustomWeekdays` | `number[]` | Dias da semana (0-6) quando a frequência é `Custom` |
| `pdcaCycleDuplicate` | `boolean` | Se `true`, duplica em vez de resetar in-place (ver modos abaixo) |
| `pdcaCycleResetSubIssues` | `boolean` | Se `true`, também reseta/recria as sub-issues diretas |

### Enum `PdcaFrequency` (6 valores)

`plugins/tracker/src/index.ts` ~56-63:

| Valor | Comportamento de virada |
|---|---|
| `Daily` | Todo dia à meia-noite |
| `Weekly` | **Segunda-feira** à meia-noite |
| `Biweekly` | A cada 14 dias |
| `Monthly` | 1º dia do mês |
| `Quarterly` | A cada 3 meses, no 1º dia |
| `Custom` | Dias da semana definidos em `pdcaCycleCustomWeekdays` |

---

## Comportamento esperado

O agendamento e a execução rodam no **pod `worker`** (`services/worker/src/pdca.ts`). Ao vencer o ciclo, o worker aplica **um de dois modos** conforme o campo `pdcaCycleDuplicate`:

### Modo 1 — Reset in-place (PADRÃO, `pdcaCycleDuplicate = false`)

A **mesma tarefa** é reiniciada — nenhuma issue nova é criada:

- `status` volta para `pdcaCycleResetStatus`
- `reportedTime` (tempo gasto) zera
- `startDate` é atualizada para o momento do reset
- `completedDate` é limpa (`null`)
- `dueDate` é recalculada a partir da frequência/`pdcaCycleDueDays`
- Título, responsável, componente, prioridade e demais campos são **preservados** (é a mesma tarefa)
- Se `pdcaCycleResetSubIssues = true`, as sub-issues diretas são resetadas in-place da mesma forma (status, tempo, datas); o `dueDate` próprio da sub-issue não é recalculado
- Um comentário de snapshot é adicionado registrando o estado do ciclo anterior

### Modo 2 — Duplicar (OPCIONAL, `pdcaCycleDuplicate = true`)

Uma **nova tarefa** é criada e a original é **mantida intacta** como registro histórico:

- A original é marcada como **concluída** (status categoria Won) e tem `pdcaCycleActive = false`, encerrando seu ciclo
- Uma nova issue é criada no mesmo projeto/parent, **reutilizando o MESMO título** da original (não há sufixo "Semana N")
- A nova issue recebe número/identifier próprios (bump de `sequence` do projeto), spent time zerado, `startDate` = agora, `dueDate` do ciclo, e herda responsável, prioridade, componente, milestone, estimativa, `clientName`/`clientStage` e a configuração PDCA
- Se `pdcaCycleResetSubIssues = true`, as sub-issues diretas da original são **recriadas** sob a nova issue (resetadas ao status de reset); as sub-issues originais permanecem anexadas à issue já concluída

> **Importante:** o modo padrão é reset-in-place. A duplicação só acontece quando `pdcaCycleDuplicate` está ligado. Não existe geração automática de sufixo de título ("Semana 18", "Quinzena 2", etc.) em nenhum dos modos.

---

## Arquitetura

```
plugins/tracker/src/index.ts
  └─ enum PdcaFrequency (6 valores)
  └─ campos pdcaCycle* na interface Issue (campos reais @Prop)

models/tracker/src/types.ts
  └─ @Prop dos campos pdcaCycle* na classe TIssue

services/worker/src/pdca.ts
  └─ agendamento por watermark (pdcaNextCycleDate) + execução da virada
  └─ calculateNextCycleDate (weekly = segunda-feira)
  └─ modo reset-in-place (padrão) e modo duplicate (opcional)
  └─ idempotência via pdcaNextCycleDate + claim (proteção contra redelivery Kafka)
```

O worker consome eventos e usa `pdcaNextCycleDate` como watermark de idempotência: a data é avançada **antes** da mutação, de modo que uma reentrega concorrente da mesma mensagem Kafka lê a data já avançada e é ignorada pelo guard de dedup.

---

## Regras de negócio

- Uma issue só entra no ciclo se `pdcaCycleActive = true`, `pdcaCycleFrequency` e `pdcaCycleResetStatus` estiverem definidos
- Frequência `Custom` exige `pdcaCycleCustomWeekdays` não vazio
- No modo duplicate, a original é fechada (Won) e desativada — ela não dispara novos ciclos
- Redelivery de mensagem Kafka é neutralizado pelo watermark `pdcaNextCycleDate` (evita a criação de N cópias em storm)

---

## Referência

- Skill: `.claude/skills/f04-pdca-cycle/`
- Código do worker: `services/worker/src/pdca.ts`
- Campos e enum: `plugins/tracker/src/index.ts` (~56-63, ~274-281)
- Memória: `pdca` (idempotência Kafka, digest redelivery)
