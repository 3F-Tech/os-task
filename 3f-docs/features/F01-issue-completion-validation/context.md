# F01 — Validação de Conclusão de Issue

## Visão Geral

Impede que uma issue seja marcada como "concluída" sem que critérios configuráveis sejam atendidos. As regras são definidas por projeto e se aplicam separadamente para Issues e Sub-Issues (subtarefas).

**Branch:** `feature/issue-completion-validation`  
**Status:** Implementado e mergeado em `develop`  
**Prioridade original:** Alta

---

## Problema que resolve

No fluxo original do Huly, qualquer issue pode ser movida para o status Done sem nenhuma validação. Na 3F Venture, isso causava problemas como:
- Issues finalizadas sem tempo lançado (`Spent time`)
- Issues finalizadas sem estimativa preenchida (`Estimation`)
- Issues pai finalizadas com subtarefas ainda abertas

---

## Arquitetura

### Modelo de dados
**Arquivo:** `plugins/tracker/src/index.ts`

```typescript
export type CompletionRuleKey = 'spentTime' | 'estimation' | 'allSubIssues' | 'completedDate'

export interface CompletionRule {
  key: CompletionRuleKey | string
  enabled: boolean
}

// Mixin aplicado ao Project para configurar regras por projeto
export interface IssueCompletionConfig extends Project {
  issueRules: CompletionRule[]     // regras para issues normais
  subIssueRules: CompletionRule[]  // regras para sub-issues
}
```

O mixin `IssueCompletionConfig` é sobreposto ao `Project` — cada projeto pode ter sua própria configuração sem alterar o schema base.

### Regras disponíveis

| Chave | Descrição |
|---|---|
| `spentTime` | Tempo gasto (`reportedTime`) deve ser > 0 |
| `estimation` | Campo `estimation` deve estar preenchido |
| `allSubIssues` | Todas as sub-issues devem estar em status Won |
| `completedDate` | Campo `completedDate` deve estar preenchido |

### Fluxo de validação (frontend)
**Arquivo principal:** `plugins/tracker-resources/src/components/issues/StatusEditor.svelte` (L.73–136)

1. Usuário clica para mudar o status da issue
2. `changeStatus()` chama `checkCompletionRules()` antes de persistir
3. `checkCompletionRules()`:
   - Verifica se o novo status é categoria `Won` (concluído)
   - Busca o projeto e verifica se tem mixin `IssueCompletionConfig`
   - Detecta se é subtarefa via `issue.parents`
   - Seleciona `subIssueRules` ou `issueRules` conforme o tipo
   - Itera pelas regras ativas e valida cada campo
4. Se há violações → exibe `CompletionBlockedNotification` (popup)
5. Se não há violações → executa `TxUpdateDoc` normalmente

### Componentes de UI

| Componente | Caminho | Função |
|---|---|---|
| `StatusEditor.svelte` | `plugins/tracker-resources/src/components/issues/` | Contém a lógica de validação (L.73–136) |
| `CompletionBlockedNotification.svelte` | `plugins/tracker-resources/src/components/issues/` | Popup que lista as regras violadas |
| `EditCompletionRules.svelte` | `plugins/tracker-resources/src/components/` | Tela de configuração das regras (toggles) |
| `SettingsCompletionRules.svelte` | `plugins/tracker-resources/src/components/` | Container/wrapper da tela de settings |

### Trigger de servidor
**Arquivo:** `models/server-tracker/src/index.ts` (L.83–89)

Registra o trigger `OnIssueCompletionCheck` para disparar em `TxUpdateDoc` sobre `Issue`. Atualmente a validação primária é feita no frontend; o trigger serve como camada adicional de segurança no backend.

---

## Strings de UI (i18n)
**Arquivo:** `plugins/tracker-assets/lang/en.json`

Chaves adicionadas:
- `CompletionRules` — "Completion Rules"
- `SubIssueCompletionRules` — "Subtask Completion Rules"
- `CompletionBlocked` — "Cannot mark as done"
- `CompletionBlockedTask` — mensagem para tasks
- `CompletionBlockedSubtask` — mensagem para subtasks
- `CompletionRuleSpentTime` — "Spent time must be logged"
- `CompletionRuleEstimation` — "Estimation must be filled"
- `CompletionRuleAllSubIssues` — "All subtasks must be completed"
- `CompletionRuleCompletedDate` — "Completion date must be set"
- `ConfigureCompletionRules` — "Configure completion rules"

Traduzidas para: `cs`, `de`, `es`, `fr`, `it`, `ja`, `ru`, `tr`, `zh`

---

## Decisões de implementação

### Por que no frontend e não só no backend?
A validação no `StatusEditor` dá feedback imediato ao usuário com detalhes das violações. O trigger backend serve como barreira secundária para mutations diretas via API.

### Por que mixin em vez de campos diretos no Project?
Mantém compatibilidade com o upstream do Huly — o modelo base de `Project` não é alterado. Qualquer projeto que não configure o mixin funciona exatamente como antes (sem restrições).

### Regras independentes para Issue vs Sub-Issue
Sub-issues têm um ciclo de vida diferente: podem não precisar de estimativa própria (herdada da issue pai). Por isso as regras são configuradas separadamente.

---

## Limitações conhecidas e TODOs

- [ ] A regra `completedDate` requer que o campo seja preenchido manualmente — a feature de **datas automáticas** (`feature/automatic-dates`) vai preencher isso automaticamente no futuro
- [ ] Não há validação no backend para mutações diretas via MCP/API (apenas frontend por enquanto)
- [ ] A tela de configuração de regras ainda não aparece no menu de settings do projeto na UI — precisa de registro em `workbench`

---

## Como testar

Ver `tests.md` nesta mesma pasta.
