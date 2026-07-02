---
name: f04-pdca-cycle
description: >-
  Use ao trabalhar na feature F04 (Ciclo PDCA): recorrência automática de issues
  — clonar ou resetar uma tarefa periodicamente (diário/semanal/quinzenal/mensal/
  trimestral/custom). Ative ao mexer no agendamento, no worker PDCA, nos campos
  pdcaCycle* da Issue, ou ao debugar por que uma tarefa recorrente (não) foi
  recriada/resetada no vencimento do ciclo. IMPORTANTE: os docs em 3f-docs dizem
  "a desenvolver", mas a feature ESTÁ implementada — confie no código.
---

# F04 — Ciclo PDCA

## O que é
Tarefas recorrentes. Uma Issue com `pdcaCycleActive=true` + frequência é agendada;
no vencimento do ciclo o sistema **clona** a issue (modo duplicate) ou a **reseta
no lugar** (modo reset), zerando status/tempo e recalculando datas.

## Estado atual
Implementada e viva. **Roda no pod `worker`** (NÃO no transactor). Os docs
`3f-docs/features/F04-pdca-cycle/` estão desatualizados ("a desenvolver") — o
código é a fonte da verdade.

## Arquitetura / fluxo
Agendamento por tempo via **TimeMachine + Kafka/Redpanda**:
1. Ativou/mudou o ciclo → trigger `OnPdcaCycleToggle` (no transactor) calcula
   `pdcaNextCycleDate` e agenda um evento (id `pdca_<issueId>`, topic `PdcaCycle`).
2. No vencimento, o **worker** consome o evento (`startPdcaConsumer`) e processa
   (`processPdcaCycleEvent`): clona ou reseta a issue e agenda o próximo ciclo.
3. `bootstrapPdcaSchedules` reconstrói os agendamentos no boot do worker.

Idempotência: watermark `pdcaNextCycleDate` — o evento carrega o valor esperado
(`expectedNextCycleDate`); se o watermark já avançou, o ciclo é pulado (tolera
reentrega do Kafka).

## Arquivos-chave
- **Worker (coração)** — `services/worker/src/pdca.ts` (`processPdcaCycleEvent`, `calculateNextCycleDate`, `startPdcaConsumer`, `bootstrapPdcaSchedules`), `services/worker/src/worker.ts`
- **Enum/tipos** — `plugins/tracker/src/index.ts` (`enum PdcaFrequency`: daily | weekly | biweekly | monthly | quarterly | custom)
- **Schema** — `models/tracker/src/types.ts` (campos `pdcaCycle*` na `Issue` e no `IssueTemplate`)
- **Migration** — `models/tracker/src/migration.ts` (state `pdcaCycleResetSubIssuesDefault`)
- **Trigger — declaração** — `server-plugins/tracker/src/index.ts:44` (`OnPdcaCycleToggle`, `OnPdcaCycleCancel`)
- **Trigger — implementação** — `server-plugins/tracker-resources/src/index.ts` (`OnPdcaCycleToggle` :752, `OnPdcaCycleCancel` :935, `schedulePdcaTimer`, `calculateNextCycleDate` :682)
- **UI** — `plugins/tracker-resources/src/components/issues/PdcaCycleSection.svelte`; integrada em `.../issues/edit/ControlPanel.svelte` e `.../CreateIssue.svelte`
- **UI templates** — `.../templates/TemplateControlPanel.svelte`, `.../templates/IssueTemplateChildEditor.svelte`
- **Dashboard** — `plugins/operational-dashboard-resources/src/metricsGreen.ts` (métrica `pdcaOnTime`), `.../components/PdcaOnTimePanel.svelte`, `.../components/IndividualView.svelte`

## Campos na Issue (`pdcaCycle*`)
`pdcaCycleActive`, `pdcaCycleFrequency`, `pdcaCycleResetStatus`, `pdcaNextCycleDate`
(watermark), `pdcaCycleDueDays`, `pdcaCycleCustomWeekdays`, `pdcaCycleDuplicate`
(clonar vs resetar), `pdcaCycleResetSubIssues`. Espelhados também no `IssueTemplate`.

## Regras de negócio (extraídas do código)
- **Ativar exige**: frequência + status de reset definidos; frequência `custom` exige weekdays.
- **Duplicate mode** (`pdcaCycleDuplicate=true`): cria nova issue (novo identifier),
  copia título/assignee/prioridade/component/milestone/estimation/clientName/
  clientStage + config PDCA; **zera** reportedTime, status→resetStatus, startDate=agora,
  dueDate recalculada, completedDate=null, parents/childInfo canônicos. A original vira
  status "Won" e `pdcaCycleActive=false` (evita duplicar N vezes numa reentrega).
- **Reset mode** (`false`): reseta status/tempo/datas na própria issue.
- **Sub-issues**: só são resetadas/clonadas se `pdcaCycleResetSubIssues=true`.
- **Próximo ciclo** (`calculateNextCycleDate`): daily +1; weekly próxima segunda;
  biweekly +14; monthly dia 1; quarterly +3 meses; custom próximo weekday configurado.
- **Comentário de auditoria** por ciclo (status anterior, tempo gasto, due/completed).
- **Dashboard `pdcaOnTime`**: conta issues PDCA raiz (exclui sub-issues); on-time = 1ª
  aprovação ≤ dueDate.

## Gotchas / debug
- **Pod correto**: mexeu no agendamento/clone (worker) → `./3f-build.sh --skip-webpack --pod worker`.
  Mexeu no trigger/schema → `--pod server`. Mexeu na UI → `--pod front`. É fácil
  editar o worker e esquecer que ele NÃO é o transactor.
- **Duas cópias de `calculateNextCycleDate`**: uma no worker (`services/worker/src/pdca.ts`)
  e uma no trigger (`server-plugins/tracker-resources/src/index.ts:682`) — mantenha em sincronia.
- **Issue clonada precisa de `parents: []`** (+ `childInfo`) senão o trigger de time-report
  estoura e o tempo gasto some — regra canônica de criação de Issue no 3F.
- **Reentrega Kafka**: handler longo pode ser expulso do grupo de consumo e reprocessar
  em loop; a idempotência por watermark protege — não a remova.
- **Verificar** (logs do pod `worker`): `PDCA bootstrap: scheduled`,
  `PDCA cycle: new issue created as duplicate`, `PDCA cycle: status reset`,
  `PDCA cycle: skipping — cycle already advanced (dedup)`, `PDCA cycle processing error`.

## Docs & testes
- Spec (desatualizada — confira contra o código): `3f-docs/features/F04-pdca-cycle/context.md`, `tests.md`
- Plano original: `3f-docs/plans/01-pdca-cycle.md`
