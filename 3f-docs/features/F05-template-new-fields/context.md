# F05 — Novos campos nos Templates

## Status
✅ Implementada

---

Os templates de tarefa precisavam carregar os novos campos de negócio da 3F (nome do cliente, etapa, e a configuração de ciclo PDCA) para que uma tarefa criada a partir de um template já nascesse com esses campos preenchidos.

Isso foi implementado: `IssueTemplateData` (e portanto `TIssueTemplate`/`IssueTemplate`) agora carregam os campos:

- `clientName` / `clientStage` (campos de cliente — ver F09)
- `pdcaCycleActive`, `pdcaCycleFrequency`, `pdcaCycleResetStatus`, `pdcaCycleDueDays`, `pdcaCycleCustomWeekdays`, `pdcaCycleDuplicate`, `pdcaCycleResetSubIssues` (configuração do ciclo PDCA — ver F04)

Definição em `plugins/tracker/src/index.ts` na interface `IssueTemplateData` (~332-359), da qual `IssueTemplateChild` e `IssueTemplate` herdam. Com isso, uma issue criada a partir de um template herda os campos de cliente e a recorrência PDCA já configurados.
