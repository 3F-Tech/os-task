> ⚠️ **Feature DESCONTINUADA no 3F Tasks** — o desenvolvimento do dashboard operacional segue em outro sistema. Este documento é preservado como **GUIA DE REGRAS DE NEGÓCIO** (métricas, WIP/eficiência/score, cliente-em-risco +15d, estrutura BU/squad/cargo) para esse novo sistema, **NÃO** como spec da implementação no 3F Tasks.

# F10 — Dashboard de Operação · Plano da Fase 1

> Status: **planejamento** (Fase 1)
> Base: `Dashboard_Operacao_3F_Especificacao_Tecnica.md` (Bruna Israel Santos, jun/2026)
> Plugin existente: `operational-dashboard` / `operational-dashboard-resources` / `model-operational-dashboard`
> Elaborado em: 2026-06-16

---

## Objetivo deste documento

Avaliar quais métricas **verdes** ("fonte = 3F Tasks", marcadas para a Fase 1 na especificação) são de fato construíveis agora sobre o dashboard existente, e registrar o plano aditivo de mudanças/adições. **Não** reescreve o que já existe (M1–M7 + Team Ranking + filtros + config por projeto); apenas estende.

---

## Veredito resumido

Cerca de dois terços das métricas verdes são construíveis a partir de dados já existentes e queryáveis (várias já calculadas em `metrics.ts`). Mas:

- **5 métricas pintadas de verde** dependem de algo que **não existe** hoje (roster de clientes, tipo de ciclo PDCA, baseline de capacity, cargo) — a spec as coloriu como prontas, mas não são.
- A premissa **"1 espaço, 3 visões por perfil"** não tem implementação: hoje é um único app gated em `AccountRole.Maintainer`, com 4 abas admin e nenhum conceito de perfil.

As decisões abaixo recortam a Fase 1 ao que é entregável com adições mínimas.

---

## 1. Decisões consolidadas

| # | Tema | Decisão final |
|---|---|---|
| 1 | Itens verdes que precisam de campo | Adicionar campos mínimos — exceto os adiados abaixo |
| 2 | Cliente / roster de clientes | **Adiado** — vai junto do link tarefa↔cliente, em fase posterior |
| 3 | Cargo | **Mixin `cargo` em `contact.Person`**, declarado dentro do plugin do dashboard (padrão `ProjectWithBU`) |
| 4 | Acesso / perfis | **Mantém `AccountRole.Maintainer`** + as 3 dashboards viram **presets de visão**; sem acesso por operador nesta fase |
| 5 | Definição de "no prazo" | **Activity-derived**: 1ª transição para status de done/aprovado ≤ `dueDate` (lógica M1 atual, configurável por projeto). Canônica para todas as métricas de entrega |
| 6 | Categoria (`clientStage`) | Contar só issues-**raiz**; exibir Onboarding/Retenção; **Churned fora** das taxas |
| 7 | `pdcaCycleType` (tipo do ciclo) | **Adiado** — definir o "como" antes de criar o campo |
| 8 | Histórico de ciclos PDCA | **Adiado** |
| 9 | Baseline de capacity (horas disponíveis) | Entra no **quadro de configuração**, granularidade **por BU** |
| 10 | Multi-responsável (`assignee[]`) | **Conta a tarefa para todos** os responsáveis (consistente com o código atual) |
| 11 | Escalabilidade / server-side | **A decidir depois**; ranking é candidato a server-side |
| 12 | Metas / limiares | **Quadro de configuração** por BU (sai do hardcode de `metrics.ts`) |
| 13 | PDCA na Fase 1 | Métrica **combinada/pontual** "PDCA no prazo" (via activity log, sem split por tipo) |
| 14 | "% de alterações e ajustes" | **Tempo** em EM REVISÃO/AJUSTES vs EM DESENVOLVIMENTO (definição da própria spec, caixa "Fase 1 vs Fase 2") |
| 15 | QG Criativo | **Criar 1 BU + 1 Team** para o QG; execução do QG no ranking = pessoas do **Team** do QG |

---

## 2. Escopo da Fase 1 — métricas verdes

Legenda: ✅ entra · ◑ parcial (numerador pronto, denominador via baseline) · ⏸ adiado · ⏭ Fase 2.

| Métrica (spec) | Status | Como será feito |
|---|---|---|
| Tarefas em atraso (+ por pessoa) | ✅ | M2 existente; reframe por `assignee` |
| Taxa de entrega no prazo no mês | ✅ | M1 (activity-derived ≤ `dueDate`) |
| Taxa no prazo — Onboarding / Retenção | ✅ | M1 agrupado por `clientStage` (issues-raiz) |
| Taxa de entrega por pessoa (coordenador) | ✅ | M1 por `assignee` × `clientStage` |
| Planejamentos aguardando aprovação (SM) | ✅ | M7 + config `waitingApprovalStatuses` por projeto |
| % de alterações e ajustes (SM / Designer / Editor / QG) | ✅ | Soma de **tempo-em-status** rework vs desenvolvimento |
| PDCA no prazo (combinado — GT) | ✅ | Activity-derived sobre `pdcaCycleActive=true` |
| Capacity — horas ocupadas vs disponíveis | ◑ | Ocupadas prontas (WorkSlot/Event); disponíveis = baseline por BU |
| Capacity do pool (QG) | ◑ | Idem, sobre o Team do QG |
| Entrega no prazo vs % de ocupação (Ef. Op.) | ◑ | Eixo on-time pronto; eixo ocupação = baseline |
| Taxa de entrega do QG por cargo e BU | ✅ | Por BU (mixin atual) + por cargo (mixin novo) + multi-BU |
| Ranking — execução operacional | ✅* | On-time consolidado por BU; *só posição atual (tendência/histórico → dep. #11)* |
| Clientes sem tarefa de Retenção há +15d | ⏸ | Depende de roster de clientes |
| Contas sem PDCA ativo (por GT) | ⏸ | Depende de roster de clientes |
| Ciclo PDCA Mídia Paga / Gestão no prazo | ⏸ | Depende de `pdcaCycleType` |
| Eficiência de tempo (estimativa vs gasto) | ⏭ | Fase 2 (já marcada assim na spec) |

> **Ranking — atenção:** o score composto (Resultado financeiro 35% / Retenção 30% / NPS 20% / Execução 15%) é majoritariamente **amarelo** — depende do módulo de gestão (MCS, churn, NPS). Na Fase 1 o ranking ordena apenas pelo **pilar de execução operacional**.

---

## 3. Mudanças de modelo (todas aditivas)

1. **Mixin `Cargo` em `contact.Person`** — interface em `plugins/operational-dashboard/src/index.ts`, schema em `models/model-operational-dashboard/src/types.ts` (mesmo padrão do `ProjectWithBU`). Enum: Account/Especialista, GT, Social Media, Designer, Editor, Coordenador, Líder QG. UI de atribuição na área de config. Fica **dentro do plugin** → sem tocar core de tracker/contact.
2. **Config por BU** (`DashboardBUConfig` novo Doc, ou campos na `BusinessUnit`) — metas (no prazo %, limiares de capacity 70%/90%) + baseline de horas/dia disponíveis. Remove os limiares hardcoded de `metrics.ts`.
3. **QG Criativo (dados, não schema):** criar 1 `BusinessUnit` "QG Criativo" + 1 `Team` "QG Criativo" (pool de SM + Designer + Editor de Seed/Impulse).
4. **Sem** entidade `Client` e **sem** `pdcaCycleType` nesta fase.
5. `models/model-operational-dashboard/src/migration.ts` (hoje no-op): backfill leve se necessário.

> Nenhuma mudança fora dos pacotes do dashboard nesta fase (o `pdcaCycleType`, que seria em `models/tracker`, foi adiado).

---

## 4. Camada de métricas — novo módulo `metricsGreen.ts`

Novo arquivo `plugins/operational-dashboard-resources/src/metricsGreen.ts`, **reusando** helpers de `metrics.ts` (`effectiveApproved`, `isActive`, `isOverdue`, `matchesFilter`, mapa `byAssignee`, walk de transições) — sem reescrever o existente:

- `onTimeByStage(...)` — M1 bucketizado por `clientStage` (só raiz).
- `onTimePerPerson(...)` / `overduePerPerson(...)` — reusam o padrão `byAssignee`.
- `computeStatusDurations(transitions, reworkSet, devStatus)` — estende o walk de transições somando **tempo-em-status** (replicando o `Date.now()-last` de `IssueStatusActivity.svelte` para issues em andamento). Saída: % tempo rework / total.
- `pdcaOnTime(...)` — `pdcaCycleActive=true` + on-time via activity log (sobrevive ao reset; no modo *duplicate*, inclui as cópias já concluídas).
- `committedHours(persons, period)` — reusa `calculateEventsDuration()` de `time-resources/src/utils.ts` e o padrão de query de `WithTeamData.svelte` (expandir `ReccuringEvent`, tratar `allDay`).
- `availableHours(period, baselineBU)` — baseline configurável por BU.
- `byBU(...)` — caminho de consolidação multi-BU (ranking + QG).
- `qgExecution(...)` — execução do QG calculada pelas pessoas do **Team** do QG.

---

## 5. Camada de UI — presets de visão

- Em `Dashboard.svelte`: adicionar um **seletor de Visão** (Individual / Coordenador / Líder QG / Eficiência Op. / Ranking) **acima** das 4 abas admin atuais (Overview/BUs/Teams/Config), que permanecem como visão "Admin".
- **Individual** — seleciona pessoa → cards comuns + os do **cargo** dela:
  - Account/Especialista: comuns (o +15d foi adiado).
  - GT: comuns + PDCA no prazo (combinado).
  - Social Media: comuns + aguardando aprovação + % alterações.
  - Designer/Editor: comuns + % alterações + capacity.
- **Coordenador** — seleciona Team/squad → taxa por pessoa (Onb/Ret), atraso por pessoa, % alterações consolidado.
- **Líder QG** — usa o **Team do QG** → entrega por cargo/BU, % alterações consolidado, capacity do pool, atraso por pessoa.
- **Ranking** — todas as BUs (inclui a BU do QG) por execução operacional; posição atual.
- **Config** — por BU (metas + baseline) + atribuição de cargo.
- Novos componentes em `plugins/operational-dashboard-resources/src/components/green/*.svelte` (modelados em `MetricCard.svelte` / `TeamRanking.svelte`).
- **Multi-BU:** hoje `computeDashboard` exige 1 BU (retorna vazio se `buId===''`); adicionar um caminho "todas as BUs"/QG **sem** quebrar o gate single-BU do Overview atual.

---

## 6. Ordem de implementação (blocos)

1. **Config & cargo** — Doc de config por BU + mixin `Cargo` + UI de atribuição. (Desbloqueia metas e "por cargo".)
2. **Métricas zero-campo** — on-time por categoria, on-time/atraso por pessoa, % alterações (tempo), aguardando aprovação, PDCA combinado. Tudo em `metricsGreen.ts` + componentes.
3. **Capacity** — numerador (ocupadas, reusa time-resources) + denominador (baseline) + cruzamento entrega×ocupação.
4. **QG + multi-BU + ranking** — BU+Team do QG, caminho all-BU, ranking de execução por BU.
5. **Presets de visão** — seletor de Visão no `Dashboard.svelte` amarrando tudo.

---

## 7. Limitações e dependências conhecidas

- **Ranking:** entrega só o pilar de execução; score composto depende de dados externos (amarelos). **Tendência (↑↓→), histórico de 3 meses e regra de oscilação ≥2 pts exigem snapshots periódicos do score**, que não existem hoje → parado junto do item **#11** (server-side). Fase 1 mostra posição atual.
- **Capacity:** só reflete o que foi efetivamente agendado no planner/Google Agenda; trabalho não agendado é invisível. "Disponíveis" é estimativa via baseline até existir um valor real por pessoa.
- **PDCA:** combinado e pontual; sem split por tipo (Mídia Paga/Gestão) nem histórico estruturado.
- **Escala:** todas as métricas recomputam client-side (carrega issues + `DocUpdateMessage` da BU no browser). Mitigar limitando por período; worker/server-side a decidir (#11).
- **Acesso:** Maintainer-only com presets — qualquer admin vê tudo; sem isolamento por operador nesta fase (#4).

---

## 8. Itens adiados (mapa para fases seguintes)

| Item | Desbloqueado por |
|---|---|
| Clientes sem tarefa de Retenção +15d; Contas sem PDCA ativo | Roster de clientes (link tarefa↔cliente) — #2 |
| Ciclo PDCA Mídia Paga / Gestão no prazo | Campo `pdcaCycleType` + decisão do "como" — #7 |
| Histórico de PDCA no prazo | Mecanismo de snapshot por ciclo — #8 |
| Eficiência de tempo (estimativa vs gasto) | Cultura de lançamento de tempo (Fase 2 da spec) |
| Tendência/histórico do ranking; isolamento por operador | Computação server-side + snapshots — #11 / #4 |
| Score composto do ranking (financeiro/retenção/NPS) | Integração com o módulo de gestão |
