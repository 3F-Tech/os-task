> ⚠️ **Feature DESCONTINUADA no 3F Tasks** — o desenvolvimento do dashboard operacional segue em outro sistema. Este documento é preservado como **GUIA DE REGRAS DE NEGÓCIO** (métricas, WIP/eficiência/score, cliente-em-risco +15d, estrutura BU/squad/cargo) para esse novo sistema, **NÃO** como spec da implementação no 3F Tasks.

# F10 — Dashboard de Operação · Checkpoints da Fase 1

> Companion de `fase1-plano.md`. Divide o plano em **5 partes / 10 checkpoints**, cada um construível e testável isoladamente.
> Fluxo por checkpoint (CLAUDE.md): `rush validate` → build do pod → checar boot → teste no browser → checklist de regressão.
> Elaborado em: 2026-06-16

---

## Como usar este documento

- Desenvolva **um checkpoint por vez**. Só avance quando o "Done quando" estiver verde.
- **Antes de cada build:** `rush validate` (deve terminar `SUCCESS` nos pacotes alterados; falha em `@hcengineering/prod` no macOS é aceitável).
- **Após cada build:** checar boot do transactor e do front:
  ```bash
  docker logs dev-transactor_cockroach-1 2>&1 | grep -E "ERROR|NoLocation|not found" | head -20
  docker logs dev-front-1 2>&1 | grep -E "ERROR|error" | head -20
  ```
- **⚠️ Checkpoints com mudança de modelo (CP1, CP2):** a migration só roda se `common/scripts/version.txt` (MODEL_VERSION) for bumpado **e** o `workspace_cockroach` reiniciado; o front precisa de rebuild **`--clean`** para não servir bundle velho.
- **Regressão (rodar ao fim de cada parte):** F01 (completion validation), F02 (tag sharing), F04 (PDCA), F09 (client fields) e o **F10 atual** (M1–M7 + Team Ranking + filtros continuam funcionando).

Mapa de build por tipo de alteração:

| Alterou | Pod | Comando |
|---|---|---|
| `plugins/*-resources/` (só Svelte/metrics) | front | `./3f-build.sh --pod front` |
| `plugins/operational-dashboard/src/index.ts` + `models/model-operational-dashboard/` | front + server | `./3f-build.sh --pod "front server"` |

---

## PARTE 1 — Fundação (modelo + configuração)

Sem métricas novas ainda; prepara o terreno (cargo + config por BU). Toca modelo → atenção ao MODEL_VERSION/--clean.

### CP1 — Mixin `Cargo` em `contact.Person` + UI de atribuição
- **Objetivo:** cada pessoa passa a ter um cargo (Account/Especialista, GT, Social Media, Designer, Editor, Coordenador, Líder QG).
- **Muda:**
  - `plugins/operational-dashboard/src/index.ts` — interface + id do mixin `Cargo` e enum de cargos.
  - `models/model-operational-dashboard/src/types.ts` — `@Mixin` em `contact.class.Person`.
  - `models/model-operational-dashboard/src/migration.ts` — entry de backfill (cargo default vazio).
  - UI de atribuição: nova seção/tela na área de gestão (ex.: editar membro em `TeamManagement`/`EditTeam`, ou tela "Cargos").
- **Build:** `./3f-build.sh --pod "front server"` + bump `common/scripts/version.txt` + restart `workspace_cockroach` + front `--clean`.
- **Teste (TC-CP1):** atribuir cargo a 2–3 pessoas → recarregar → persiste; pessoa sem cargo aparece como "sem cargo".
- **Done quando:** cargo grava e relê; boot sem `NoLocationForPlugin`.

### CP2 — Config por BU (metas + baseline) + leitura na `metrics.ts`
- **Objetivo:** metas e limiares deixam de ser hardcoded; cada BU define os seus.
- **Muda:**
  - Novo Doc `DashboardBUConfig` (ou campos em `BusinessUnit`): meta de no-prazo (%), limiares de capacity (70%/90%), baseline de horas/dia disponíveis.
  - `models/model-operational-dashboard/src/types.ts` + migration.
  - UI: tela de config por BU (espelhar `EditBusinessUnit`).
  - `metrics.ts`: ler limiares da config **com fallback para os defaults atuais** (não quebrar tones de M1–M7).
- **Build:** `./3f-build.sh --pod "front server"` + MODEL_VERSION + restart + front `--clean`.
- **Teste (TC-CP2):** editar meta de uma BU → o tom (verde/amarelo/vermelho) dos cards reage à nova meta; BU **sem** config usa os defaults antigos (regressão M1–M7 intacta).
- **Done quando:** config grava/relê e altera tones; nada quebra em BU sem config.

---

## PARTE 2 — Métricas individuais (zero-campo novo)

Tudo em `metricsGreen.ts` + componentes; **build só `front`**. Aqui nasce o primeiro preset "Individual".

### CP3 — On-time por categoria + por pessoa + atraso por pessoa
- **Objetivo:** taxa no prazo total + por Onboarding/Retenção, e por pessoa; atraso por pessoa.
- **Muda:** `metricsGreen.ts` (`onTimeByStage`, `onTimePerPerson`, `overduePerPerson`); componentes `OnTimeByStagePanel`, `OnTimePerPersonTable`, `OverduePerPersonTable`; primeiro **seletor de Visão** com o preset **Individual** (seleciona pessoa).
- **Build:** `./3f-build.sh --pod front`.
- **Teste (TC-CP3):** selecionar pessoa → taxa no prazo total + Onboarding + Retenção; conferir que conta só **issues-raiz** (criar sub-issue e ver que não dobra a contagem); Churned não entra.
- **Done quando:** números batem com checagem manual numa BU pequena.

### CP4 — % de alterações e ajustes (tempo-em-status)
- **Objetivo:** retrabalho por **tempo** em REVISÃO/AJUSTES vs EM DESENVOLVIMENTO.
- **Muda:** `metricsGreen.ts` (`computeStatusDurations`, reusa o walk de transições + `Date.now()-last` de `IssueStatusActivity.svelte`); componente `ChangesAdjustmentsPanel`. Usa `ProjectDashboardConfig.reworkStatuses` + `cycleStartStatus` já existentes.
- **Build:** `./3f-build.sh --pod front`.
- **Teste (TC-CP4):** num projeto com status de rework/dev configurados, criar issue que passa por EM DESENVOLVIMENTO → EM REVISÃO → AJUSTES e voltar; verificar % de tempo coerente; issue em andamento conta o tempo aberto.
- **Done quando:** % de tempo bate com o histórico do `IssueStatusActivity` da issue.

### CP5 — Aguardando aprovação (SM) + PDCA no prazo (combinado, GT)
- **Objetivo:** surfacing do M7 na visão SM + métrica combinada de PDCA no prazo.
- **Muda:** wiring do M7 (já calculado) no preset SM; `metricsGreen.pdcaOnTime` (`pdcaCycleActive=true` + on-time via activity log; incluir cópias concluídas no modo duplicate); componente `PdcaOnTimePanel`.
- **Build:** `./3f-build.sh --pod front`.
- **Teste (TC-CP5):** configurar `waitingApprovalStatuses` num projeto → contagem aparece; ativar PDCA numa tarefa, concluir dentro/fora do prazo → métrica reflete.
- **Done quando:** M7 aparece na visão SM; PDCA no prazo coerente. **Fim da Parte 2 → rodar regressão F01/F02/F04/F09/F10.**

---

## PARTE 3 — Capacity

Depende do baseline (CP2). Reusa `time-resources`. Build só `front` (pode exigir adicionar dependência de `calendar`/`time` em `operational-dashboard-resources`).

### CP6 — Horas ocupadas + disponíveis + % de ocupação
- **Objetivo:** capacity por pessoa/pool = horas ocupadas vs baseline.
- **Muda:** `metricsGreen.ts` (`committedHours` reusando `calculateEventsDuration()` + padrão de query de `WithTeamData.svelte`; `availableHours` da config por BU); componente `CapacityPanel`. Expandir `ReccuringEvent`, tratar `allDay`.
- **Build:** `./3f-build.sh --pod front`.
- **Teste (TC-CP6):** agendar WorkSlots/eventos no planner de uma pessoa no período → horas ocupadas batem; % de ocupação usa o baseline da BU; alerta dispara >90% e <70%.
- **Done quando:** horas ocupadas conferem com o planner; % e alertas corretos.

### CP7 — Cruzamento entrega no prazo × % de ocupação (Eficiência Op.)
- **Objetivo:** identificar sobrecarregado-e-atrasando vs ocioso.
- **Muda:** `metricsGreen` combinando on-time (CP3) × ocupação (CP6); componente `EfficiencyScatter`; preset **Eficiência Op.**
- **Build:** `./3f-build.sh --pod front`.
- **Teste (TC-CP7):** pessoa com alta ocupação e baixa entrega aparece no quadrante de risco; pessoa ociosa idem.
- **Done quando:** cruzamento plota coerente. **Fim da Parte 3 → regressão.**

---

## PARTE 4 — Consolidações e ranking

### CP8 — QG (BU + Team) + multi-BU + visão Líder QG
- **Objetivo:** representar o QG e habilitar consolidação multi-BU.
- **Muda:** criar (dados, via UI) 1 `BusinessUnit` "QG Criativo" + 1 `Team` "QG Criativo"; `metricsGreen.byBU` (caminho all-BU **sem** quebrar o gate single-BU do Overview) + `qgExecution` (pessoas do Team do QG); preset **Líder QG** (entrega por cargo/BU, % alterações consolidado, capacity do pool, atraso por pessoa).
- **Build:** `./3f-build.sh --pod front`.
- **Teste (TC-CP8):** popular o Team do QG → visão Líder QG mostra consolidado por cargo; Overview single-BU continua funcionando.
- **Done quando:** visão QG consolida pelo Team; nada quebra no Overview.

### CP9 — Ranking de execução por BU
- **Objetivo:** ranquear Bomma/Seed/Impulse + QG pela execução operacional.
- **Muda:** componente `BURankingTable` (espelha `TeamRanking`); execução do QG via `qgExecution`; preset **Ranking** (posição atual).
- **Build:** `./3f-build.sh --pod front`.
- **Teste (TC-CP9):** 4 entidades aparecem ordenadas por on-time consolidado; QG usa execução do Team.
- **Done quando:** ranking lista as 4 entidades corretamente. **Fim da Parte 4 → regressão.**
- **Nota:** tendência/histórico/oscilação ≥2 pts ficam fora (dep. #11 server-side/snapshots).

---

## PARTE 5 — Amarração das visões

### CP10 — Preset Coordenador + finalização do seletor de Visão
- **Objetivo:** fechar os presets e a navegação.
- **Muda:** preset **Coordenador** (seleciona Team/squad → taxa por pessoa Onb/Ret, atraso por pessoa, % alterações consolidado); revisão do seletor de Visão em `Dashboard.svelte` cobrindo Individual / Coordenador / Líder QG / Eficiência Op. / Ranking + abas admin preservadas; cada preset mostra o set de métricas do cargo certo.
- **Build:** `./3f-build.sh --pod front`.
- **Teste (TC-CP10):** percorrer todos os presets — cada um mostra o conjunto correto de métricas; abas admin (Overview/BUs/Teams/Config) intactas.
- **Done quando:** navegação completa e coerente. **Regressão final completa (F01/F02/F04/F09/F10).**

---

## Resumo das partes

| Parte | Checkpoints | Pod | Mudança de modelo? |
|---|---|---|---|
| 1 — Fundação | CP1, CP2 | front + server | **Sim** (cargo, config) → MODEL_VERSION + restart + `--clean` |
| 2 — Individual | CP3, CP4, CP5 | front | Não |
| 3 — Capacity | CP6, CP7 | front | Não |
| 4 — Consolidação/Ranking | CP8, CP9 | front | Não (QG é dado) |
| 5 — Amarração | CP10 | front | Não |

> Só as Partes 1 toca modelo/migration. Das Partes 2–5 em diante é tudo `front`, o que torna o ciclo desenvolve→testa bem mais rápido.
