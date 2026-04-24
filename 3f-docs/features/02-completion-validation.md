# Feature: Validação de Conclusão de Issue

**Branch:** `feature/issue-completion-validation`  
**Prioridade:** Alta  
**Status:** Implementado

---

## Visão Geral

Cada projeto poderá configurar quais campos são obrigatórios para que uma tarefa (ou subtarefa) possa ser marcada como concluída. Ao tentar mover uma issue para um status da categoria **Won** (Done) sem atender os requisitos configurados, o sistema bloqueia a transição e exibe uma mensagem clara indicando o que falta preencher.

A configuração é **por projeto** (não por Space Type), com regras separadas para tasks pai e subtasks.

---

## Estado Atual do Código

### O que já existe
- `Issue.status: Ref<IssueStatus>` — campo de status padrão
- `Issue.estimation: number` — estimativa de horas
- `Issue.reportedTime: number` — tempo lançado (atualizado por trigger)
- `Issue.subIssues: CollectionSize<Issue>` — contagem de sub-issues
- Categoria `task.statusCategory.Won` — identifica status "Done"
- Sistema de triggers — `OnIssueUpdate` em `server-plugins/tracker-resources/src/index.ts:207`
- Mixin pattern — `TClassicProjectTypeData` como exemplo de mixin em `tracker.class.Project`
- `ArrOf(TypeRecord())` — tipo para arrays de objetos em `@Prop` (usado em `TProjectType.statuses`)
- `SettingsRelatedTargets.svelte` — exemplo de componente de settings que recebe `Space` como contexto

### O que não existe
- Qualquer modelo de configuração de regras de conclusão por projeto
- Validação de campos obrigatórios ao mudar status para Done
- UI de configuração das regras por projeto
- Popup de erro ao tentar concluir issue sem atender requisitos

---

## Modelo de Dados

### Novas interfaces (`plugins/tracker/src/index.ts`)

Adicionar após a interface `ProjectTargetPreference`:

```typescript
/**
 * @public
 * Chave de regra de conclusão nativa ou custom field key
 */
export type CompletionRuleKey =
  | 'spentTime'       // reportedTime > 0
  | 'estimation'      // estimation > 0
  | 'allSubIssues'    // todas as sub-issues estão em status Won
  | 'completedDate'   // campo completedDate preenchido (feature/automatic-dates)

export interface CompletionRule {
  key: CompletionRuleKey | string  // string para custom fields
  enabled: boolean
  label?: string  // usado apenas para custom fields — campos nativos usam string label do Huly
}

/**
 * @public
 * Mixin de configuração de regras de conclusão por projeto.
 * Aplicado ao tracker.class.Project.
 */
export interface IssueCompletionConfig extends Project {
  issueRules: CompletionRule[]     // regras para tasks pai
  subIssueRules: CompletionRule[]  // regras para subtasks
}
```

### Novo model (`models/tracker/src/types.ts`)

Adicionar após `TProject`:

```typescript
@Mixin(tracker.mixin.IssueCompletionConfig, tracker.class.Project)
@UX(tracker.string.CompletionRules)
export class TIssueCompletionConfig extends TProject implements IssueCompletionConfig {
  @Prop(ArrOf(TypeRecord()), tracker.string.CompletionRules)
  issueRules!: CompletionRule[]

  @Prop(ArrOf(TypeRecord()), tracker.string.SubIssueCompletionRules)
  subIssueRules!: CompletionRule[]
}
```

### Novos IDs (`models/tracker/src/plugin.ts` + `plugins/tracker-resources/src/plugin.ts`)

**Em `models/tracker/src/plugin.ts`**, adicionar ao bloco `mergeIds`:

```typescript
mixin: {
  IssueCompletionConfig: '' as Ref<Mixin<IssueCompletionConfig>>,
},
string: {
  CompletionRules: '' as IntlString,
  SubIssueCompletionRules: '' as IntlString,
  CompletionBlocked: '' as IntlString,
  CompletionBlockedDescription: '' as IntlString,
  SettingsCompletionRules: '' as IntlString,
  RequirementSpentTime: '' as IntlString,
  RequirementEstimation: '' as IntlString,
  RequirementAllSubIssues: '' as IntlString,
  RequirementCompletedDate: '' as IntlString,
},
component: {
  SettingsCompletionRules: '' as AnyComponent,
},
```

**Em `plugins/tracker-resources/src/plugin.ts`**, adicionar ao bloco `string`:

```typescript
CompletionBlocked: '' as IntlString,
CompletionBlockedDescription: '' as IntlString,
MissingSpentTime: '' as IntlString,
MissingEstimation: '' as IntlString,
MissingSubIssues: '' as IntlString,
MissingCompletedDate: '' as IntlString,
ConfigureCompletionRules: '' as IntlString,
```

### Strings i18n (`plugins/tracker-resources/src/strings/en.ts` e `pt.ts`)

**en.ts:**
```typescript
CompletionRules: 'Completion Rules',
SubIssueCompletionRules: 'Subtask Completion Rules',
CompletionBlocked: 'Cannot mark as done',
CompletionBlockedDescription: 'The following requirements must be met before this {type} can be completed:',
SettingsCompletionRules: 'Completion Rules',
RequirementSpentTime: 'Spent time must be logged',
RequirementEstimation: 'Estimation must be filled',
RequirementAllSubIssues: 'All subtasks must be completed',
RequirementCompletedDate: 'Completion date must be set',
MissingSpentTime: 'No time has been logged',
MissingEstimation: 'Estimation is not filled',
MissingSubIssues: '{count} subtask(s) are not completed',
MissingCompletedDate: 'Completion date is not set',
ConfigureCompletionRules: 'Configure completion rules',
```

**pt.ts:**
```typescript
CompletionRules: 'Regras de Conclusão',
SubIssueCompletionRules: 'Regras de Conclusão de Subtarefas',
CompletionBlocked: 'Não é possível concluir',
CompletionBlockedDescription: 'Os seguintes requisitos devem ser atendidos antes de concluir este(a) {type}:',
SettingsCompletionRules: 'Regras de Conclusão',
RequirementSpentTime: 'Tempo gasto deve ser lançado',
RequirementEstimation: 'Estimativa deve ser preenchida',
RequirementAllSubIssues: 'Todas as subtarefas devem estar concluídas',
RequirementCompletedDate: 'Data de finalização deve estar preenchida',
MissingSpentTime: 'Nenhum tempo foi lançado',
MissingEstimation: 'Estimativa não preenchida',
MissingSubIssues: '{count} subtarefa(s) não concluída(s)',
MissingCompletedDate: 'Data de finalização não preenchida',
ConfigureCompletionRules: 'Configurar regras de conclusão',
```

---

## Fluxo Técnico

### Visão geral

```
Usuário seleciona status Done
         │
         ▼
[FRONTEND] checkCompletionRules(issue, project)
         │
    ┌────┴────────────────┐
    │                     │
  PASS                   FAIL
    │                     │
    ▼                     ▼
TxUpdateDoc(status)   CompletionBlockedPopup
    │                 (lista o que falta)
    ▼
[BACKEND] OnIssueCompletionCheck trigger
         │
    ┌────┴────────────────┐
    │                     │
  PASS                  FAIL (safety net)
    │                     │
  (sem Tx extras)      TxUpdateDoc(status = anterior)
                       + notificação de erro
```

### Frontend — validação primária

**Arquivo:** novo utilitário `plugins/tracker-resources/src/utils/completionRules.ts`

```typescript
export interface CompletionViolation {
  key: string
  message: IntlString
  params?: Record<string, any>
}

export async function checkCompletionRules(
  issue: Issue,
  isSubIssue: boolean,
  client: TxOperations,
  hierarchy: Hierarchy
): Promise<CompletionViolation[]> {
  const violations: CompletionViolation[] = []

  // Obter config do projeto
  const project = await client.findOne(tracker.class.Project, { _id: issue.space })
  if (!project) return violations
  if (!hierarchy.hasMixin(project, tracker.mixin.IssueCompletionConfig)) return violations

  const config = hierarchy.as<Project, IssueCompletionConfig>(project, tracker.mixin.IssueCompletionConfig)
  const rules = isSubIssue ? config.subIssueRules : config.issueRules

  for (const rule of rules.filter((r) => r.enabled)) {
    switch (rule.key) {
      case 'spentTime':
        if (!issue.reportedTime || issue.reportedTime <= 0) {
          violations.push({ key: 'spentTime', message: tracker.string.MissingSpentTime })
        }
        break
      case 'estimation':
        if (!issue.estimation || issue.estimation <= 0) {
          violations.push({ key: 'estimation', message: tracker.string.MissingEstimation })
        }
        break
      case 'allSubIssues':
        if (issue.subIssues > 0) {
          const subIssues = await client.findAll(tracker.class.Issue, { attachedTo: issue._id })
          const unresolved = subIssues.filter((s) => {
            const status = /* lookup status */ s.status
            // verificar se status.category !== task.statusCategory.Won
            return true // placeholder — ver implementação real
          })
          if (unresolved.length > 0) {
            violations.push({
              key: 'allSubIssues',
              message: tracker.string.MissingSubIssues,
              params: { count: unresolved.length }
            })
          }
        }
        break
      case 'completedDate':
        if (!(issue as any).completedDate) {
          violations.push({ key: 'completedDate', message: tracker.string.MissingCompletedDate })
        }
        break
    }
  }

  return violations
}
```

**Hook de integração:** A validação precisa ser chamada no handler de mudança de status. O ponto correto é o componente que processa a seleção de status — provavelmente em `plugins/tracker-resources/src/components/issues/IssueStatusActivity.svelte` ou na action `ChangeStatus`. O handler deve:

1. Verificar se o novo status é categoria Won
2. Chamar `checkCompletionRules()`
3. Se houver violações → abrir `CompletionBlockedPopup` em vez de salvar
4. Se não houver violações → prosseguir com `client.updateDoc({ status: newStatus })`

### Backend — validação de segurança (safety net)

**Arquivo:** `server-plugins/tracker-resources/src/index.ts`

Nova função exportada:

```typescript
export async function OnIssueCompletionCheck(txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []

  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue

    const updateTx = tx as TxUpdateDoc<Issue>
    if (!control.hierarchy.isDerived(updateTx.objectClass, tracker.class.Issue)) continue
    if (updateTx.operations.status === undefined) continue

    // Verificar se o novo status é Won
    const [newStatus] = await control.findAll(
      control.ctx,
      tracker.class.IssueStatus,
      { _id: updateTx.operations.status as Ref<IssueStatus> },
      { limit: 1 }
    )
    if (!newStatus) continue

    const [category] = await control.findAll(
      control.ctx,
      core.class.StatusCategory,
      { _id: newStatus.category },
      { limit: 1 }
    )
    if (!category || category._id !== task.statusCategory.Won) continue

    // Verificar config do projeto
    const [issue] = await control.findAll(
      control.ctx,
      tracker.class.Issue,
      { _id: updateTx.objectId },
      { limit: 1 }
    )
    if (!issue) continue

    const [project] = await control.findAll(
      control.ctx,
      tracker.class.Project,
      { _id: issue.space },
      { limit: 1 }
    )
    if (!project) continue
    if (!control.hierarchy.hasMixin(project, tracker.mixin.IssueCompletionConfig)) continue

    const config = control.hierarchy.as<Project, IssueCompletionConfig>(
      project,
      tracker.mixin.IssueCompletionConfig
    )
    const isSubIssue = issue.attachedTo !== (tracker.ids.NoParent as any)
    const rules = isSubIssue ? config.subIssueRules : config.issueRules

    let hasViolation = false
    for (const rule of rules.filter((r) => r.enabled)) {
      if (rule.key === 'spentTime' && (!issue.reportedTime || issue.reportedTime <= 0)) {
        hasViolation = true; break
      }
      if (rule.key === 'estimation' && (!issue.estimation || issue.estimation <= 0)) {
        hasViolation = true; break
      }
      if (rule.key === 'allSubIssues' && issue.subIssues > 0) {
        const subIssues = await control.findAll(control.ctx, tracker.class.Issue, { attachedTo: issue._id })
        const statuses = await control.findAll(control.ctx, tracker.class.IssueStatus, {
          _id: { $in: subIssues.map((s) => s.status) }
        })
        const statusMap = new Map(statuses.map((s) => [s._id, s]))
        const unresolved = subIssues.filter((s) => statusMap.get(s.status)?.category !== task.statusCategory.Won)
        if (unresolved.length > 0) { hasViolation = true; break }
      }
    }

    if (hasViolation) {
      // Compensating transaction: reverter para o status anterior
      result.push(
        control.txFactory.createTxUpdateDoc(
          updateTx.objectClass,
          updateTx.objectSpace,
          updateTx.objectId,
          { status: issue.status }  // status anterior (antes do updateTx ser aplicado)
        )
      )
    }
  }

  return result
}
```

> **Nota:** A segurança do backend é um safety net para clientes que bypassem o frontend. O frontend é a camada principal de UX. Revisar se a versão atual da issue passada ao trigger reflete o estado *antes* ou *depois* do update — se for depois, o trigger precisa buscar o status anterior via histórico de Tx.

**Registro do trigger** (`models/server-tracker/src/index.ts`):

```typescript
builder.createDoc(serverCore.class.Trigger, core.space.Model, {
  trigger: serverTracker.trigger.OnIssueCompletionCheck,
  txMatch: {
    _class: core.class.TxUpdateDoc,
    objectClass: tracker.class.Issue
  }
})
```

---

## Componentes Svelte

### 1. `CompletionBlockedPopup.svelte`

**Path:** `plugins/tracker-resources/src/components/issues/CompletionBlockedPopup.svelte`

Popup modal exibido quando o usuário tenta concluir uma issue sem atender os requisitos.

**Props:**
- `violations: CompletionViolation[]` — lista de requisitos não atendidos
- `isSubIssue: boolean` — para personalizar o texto (task vs subtarefa)
- `projectId: Ref<Project>` — para link direto às configurações

**Comportamento:**
- Exibe título "Não é possível concluir"
- Lista os requisitos faltantes com ícone de alerta
- Botão "Fechar" — fecha o popup, mantém status atual
- Link "Configurar regras" (visível apenas para Maintainer/Owner) — navega para settings do projeto

**Exemplo visual:**
```
┌─────────────────────────────────────────┐
│  ⚠ Não é possível concluir             │
│                                         │
│  Preencha os seguintes requisitos:      │
│                                         │
│  • Nenhum tempo foi lançado             │
│  • 2 subtarefa(s) não concluída(s)      │
│                                         │
│  [Configurar regras]        [Fechar]    │
└─────────────────────────────────────────┘
```

### 2. `SettingsCompletionRules.svelte`

**Path:** `plugins/tracker-resources/src/components/SettingsCompletionRules.svelte`

Shell do componente de settings (padrão do `SettingsRelatedTargets.svelte`).

```svelte
<script lang="ts">
  import { Space } from '@hcengineering/core'
  import { Header, Breadcrumb } from '@hcengineering/ui'
  import tracker from '../plugin'
  import EditCompletionRules from './EditCompletionRules.svelte'

  export let value: Space | undefined
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb
      icon={tracker.icon.Issues}
      label={tracker.string.CompletionRules}
      size={'large'}
      isCurrent
    />
  </Header>
  <EditCompletionRules {value} />
</div>
```

### 3. `EditCompletionRules.svelte`

**Path:** `plugins/tracker-resources/src/components/EditCompletionRules.svelte`

Editor das regras de conclusão. Recebe o projeto como contexto.

**Estrutura da UI:**

```
Regras de Conclusão para Tasks

  [ ] Tempo gasto deve ser lançado
  [ ] Estimativa deve ser preenchida
  [ ] Todas as subtarefas devem estar concluídas
  [ ] Data de finalização deve estar preenchida

─────────────────────────────────────────

Regras de Conclusão para Subtarefas

  [ ] Tempo gasto deve ser lançado
  [ ] Estimativa deve ser preenchida
  [ ] Data de finalização deve estar preenchida

```

**Lógica Svelte:**

```typescript
import { createQuery, getClient } from '@hcengineering/presentation'
import { Space, Mixin } from '@hcengineering/core'
import type { IssueCompletionConfig, CompletionRule } from '@hcengineering/tracker'
import tracker from '../plugin'

export let value: Space | undefined

const client = getClient()
const hierarchy = client.getHierarchy()

let config: IssueCompletionConfig | undefined
let issueRules: CompletionRule[] = []
let subIssueRules: CompletionRule[] = []

$: if (value) {
  if (hierarchy.hasMixin(value, tracker.mixin.IssueCompletionConfig)) {
    config = hierarchy.as(value, tracker.mixin.IssueCompletionConfig)
    issueRules = config.issueRules ?? defaultIssueRules()
    subIssueRules = config.subIssueRules ?? defaultSubIssueRules()
  } else {
    issueRules = defaultIssueRules()
    subIssueRules = defaultSubIssueRules()
  }
}

async function toggleRule(rules: CompletionRule[], key: string, isSubIssue: boolean): Promise<void> {
  const updated = rules.map((r) => r.key === key ? { ...r, enabled: !r.enabled } : r)
  const field = isSubIssue ? 'subIssueRules' : 'issueRules'

  if (hierarchy.hasMixin(value!, tracker.mixin.IssueCompletionConfig)) {
    await client.updateMixin(
      value!._id,
      tracker.class.Project,
      value!.space,
      tracker.mixin.IssueCompletionConfig,
      { [field]: updated }
    )
  } else {
    await client.createMixin(
      value!._id,
      tracker.class.Project,
      value!.space,
      tracker.mixin.IssueCompletionConfig,
      { issueRules: defaultIssueRules(), subIssueRules: defaultSubIssueRules(), [field]: updated }
    )
  }
}

function defaultIssueRules(): CompletionRule[] {
  return [
    { key: 'spentTime',      enabled: false },
    { key: 'estimation',     enabled: false },
    { key: 'allSubIssues',   enabled: false },
    { key: 'completedDate',  enabled: false }
  ]
}

function defaultSubIssueRules(): CompletionRule[] {
  return [
    { key: 'spentTime',      enabled: false },
    { key: 'estimation',     enabled: false },
    { key: 'completedDate',  enabled: false }
    // allSubIssues não se aplica a subtarefas (não têm filhos)
  ]
}
```

---

## Tela de Configuração — Acesso

A tela de configuração é acessível por **Maintainer** e **Owner** via:

**Settings do Workspace → Tracker → Completion Rules**  
(seguindo o mesmo padrão de `SettingsRelatedTargets` que é uma WorkspaceSettingCategory)

O `value: Space` recebido pelo componente permite filtrar por projeto caso o componente seja mostrado no contexto de um projeto específico.

**Registro em `models/tracker/src/index.ts`:**

```typescript
builder.createDoc(setting.class.WorkspaceSettingCategory, core.space.Model, {
  name: 'completionRules',
  label: tracker.string.CompletionRules,
  icon: tracker.icon.Issues,
  component: tracker.component.SettingsCompletionRules,
  group: 'settings-editor',
  role: AccountRole.Maintainer,
  order: 4500
})
```

> **Melhoria futura:** Expor via settings inline do projeto (ícone de engrenagem no sidebar do projeto), passando o projeto como contexto direto ao componente. Isso elimina a necessidade de navegar até Settings globais.

---

## Migration

O mixin `IssueCompletionConfig` é opcional — projetos sem o mixin simplesmente não têm validação ativa. Não é necessário migration para projetos existentes: o comportamento padrão (sem mixin = sem restrições) é o comportamento atual do sistema.

Se futuramente desejar inicializar todos os projetos com regras desativadas:

```typescript
async function migrateCompletionConfig(client: MigrationUpgradeClient): Promise<void> {
  const projects = await client.findAll(tracker.class.Project, {})
  const ops = new TxOperations(client, core.account.System)
  for (const project of projects) {
    if (!client.getHierarchy().hasMixin(project, tracker.mixin.IssueCompletionConfig)) {
      await ops.createMixin(
        project._id,
        tracker.class.Project,
        project.space,
        tracker.mixin.IssueCompletionConfig,
        { issueRules: [], subIssueRules: [] }
      )
    }
  }
}
```

---

## Passo a Passo de Implementação

### Fase 1 — Modelo de dados (estimativa: 2h)

1. **`plugins/tracker/src/index.ts`**  
   Adicionar tipos `CompletionRuleKey`, `CompletionRule`, interface `IssueCompletionConfig`

2. **`models/tracker/src/types.ts`**  
   Adicionar classe `TIssueCompletionConfig` com decorator `@Mixin`

3. **`models/tracker/src/plugin.ts`**  
   Adicionar IDs: `mixin.IssueCompletionConfig`, strings de label, `component.SettingsCompletionRules`

4. **`plugins/tracker-resources/src/plugin.ts`**  
   Adicionar strings de erro e UI

5. **`plugins/tracker-resources/src/strings/en.ts`** e **`pt.ts`**  
   Adicionar todas as strings novas

6. **`models/tracker/src/index.ts`**  
   - Registrar `TIssueCompletionConfig` no `createModel`  
   - Registrar settings category para o componente

### Fase 2 — Utilitário de validação frontend (estimativa: 1.5h)

7. **Criar `plugins/tracker-resources/src/utils/completionRules.ts`**  
   Implementar `checkCompletionRules()` — verifica cada rule contra o estado atual da issue

### Fase 3 — Componentes de UI (estimativa: 3h)

8. **Criar `plugins/tracker-resources/src/components/issues/CompletionBlockedPopup.svelte`**  
   Popup com lista de requisitos faltantes

9. **Criar `plugins/tracker-resources/src/components/EditCompletionRules.svelte`**  
   Editor de regras com checkboxes por tipo de issue

10. **Criar `plugins/tracker-resources/src/components/SettingsCompletionRules.svelte`**  
    Shell do settings (Header + Breadcrumb + EditCompletionRules)

11. **Registrar os novos componentes** em `plugins/tracker-resources/src/index.ts`

### Fase 4 — Hook de validação no status change (estimativa: 2h)

12. **Localizar o handler de mudança de status** no frontend  
    Candidatos: `plugins/tracker-resources/src/components/issues/IssueStatusActivity.svelte` ou action `ChangeStatus` em `models/tracker/src/index.ts`

13. **Injetar `checkCompletionRules()`** no fluxo de mudança de status  
    - Antes do `client.updateDoc({ status: newStatus })`
    - Se nova categoria = Won → chamar validação
    - Se violações → abrir `CompletionBlockedPopup`

### Fase 5 — Trigger de segurança no backend (estimativa: 2h)

14. **`server-plugins/tracker-resources/src/index.ts`**  
    Implementar e exportar `OnIssueCompletionCheck`

15. **Registrar `serverTracker.trigger.OnIssueCompletionCheck`** no objeto de plugin do `server-tracker`

16. **`models/server-tracker/src/index.ts`**  
    Registrar o novo trigger com `builder.createDoc(serverCore.class.Trigger, ...)`

### Fase 6 — Testes e integração (estimativa: 1.5h)

17. Testar sem mixin configurado → status deve mudar normalmente (sem bloqueio)
18. Testar com `spentTime` ativo e issue sem tempo lançado → deve bloquear
19. Testar com `allSubIssues` ativo e subtarefas pendentes → deve bloquear com contagem correta
20. Testar com todos os requisitos atendidos → deve concluir normalmente
21. Testar como User (sem acesso a settings) → validação funciona, link de settings não aparece
22. Testar bypass via API direta → trigger de backend reverte o status

---

## Arquivos a Modificar

| Arquivo | Ação | Detalhes |
|---|---|---|
| `plugins/tracker/src/index.ts` | Modificar | Adicionar tipos `CompletionRuleKey`, `CompletionRule`, interface `IssueCompletionConfig` |
| `models/tracker/src/types.ts` | Modificar | Adicionar classe `TIssueCompletionConfig` com `@Mixin` |
| `models/tracker/src/plugin.ts` | Modificar | Adicionar IDs de mixin, strings, componente |
| `models/tracker/src/index.ts` | Modificar | Registrar mixin no createModel + settings category |
| `plugins/tracker-resources/src/plugin.ts` | Modificar | Adicionar strings de UI/erro |
| `plugins/tracker-resources/src/strings/en.ts` | Modificar | Adicionar strings em inglês |
| `plugins/tracker-resources/src/strings/pt.ts` | Modificar | Adicionar strings em português |
| `plugins/tracker-resources/src/index.ts` | Modificar | Registrar os 3 novos componentes |
| `server-plugins/tracker-resources/src/index.ts` | Modificar | Implementar `OnIssueCompletionCheck` |
| `models/server-tracker/src/index.ts` | Modificar | Registrar novo trigger |
| `plugins/tracker-resources/src/components/issues/[StatusChangeHandler]` | Modificar | Injetar validação antes do updateDoc de status |

> O arquivo exato do handler de status change precisa ser identificado durante a implementação. Candidatos: `IssueStatusActivity.svelte`, o action handler de `ChangeStatus`, ou o componente de seleção de status inline.

---

## Novos Arquivos a Criar

| Arquivo | Propósito |
|---|---|
| `plugins/tracker-resources/src/utils/completionRules.ts` | Lógica de validação de regras (reutilizável no frontend) |
| `plugins/tracker-resources/src/components/issues/CompletionBlockedPopup.svelte` | Popup de erro com lista de requisitos faltantes |
| `plugins/tracker-resources/src/components/EditCompletionRules.svelte` | Editor de regras com checkboxes (lógica principal) |
| `plugins/tracker-resources/src/components/SettingsCompletionRules.svelte` | Shell de settings (Header + Breadcrumb + EditCompletionRules) |

---

## Riscos Técnicos

### 1. Localização do handler de status change (alto)
O ponto de injeção da validação frontend ainda não foi identificado com precisão. O Huly usa Actions para operações como `ChangeStatus` — pode ser necessário modificar o sistema de Actions, que tem uma API diferente do fluxo direto de componentes Svelte. Mitigação: explorar `models/tracker/src/index.ts` procurando a action `ChangeStatus` e seu `actionImpl`.

### 2. Trigger de backend lê estado pré ou pós-update? (médio)
Na função `OnIssueCompletionCheck`, o `control.findAll` para buscar a issue retorna o estado atual no banco — que pode ser *após* o TxUpdateDoc já ter sido aplicado (status novo) ou *antes*, dependendo da ordem de execução de triggers no pipeline. Se for pós-update, o `issue.status` já será o novo status; precisamos do status anterior para o compensating transaction. Mitigação: verificar a ordem de triggers no `server-plugins` ou usar o `TxProcessor.buildDoc2Doc` com o histórico de Tx.

### 3. `allSubIssues` e queries de status de sub-issues (médio)
Verificar se todas as sub-issues estão em Won exige buscar todas as sub-issues E seus status categories. No frontend isso requer múltiplas queries assíncronas que podem atrasar o popup de validação perceptivelmente em issues com muitas subtarefas. Mitigação: usar `issue.childInfo[]` que é um cache desnormalizado — verificar se contém informação de status suficiente para evitar queries adicionais.

### 4. `completedDate` como requisito sem a feature `feature/automatic-dates` (baixo)
O campo `completedDate` ainda não existe na interface `Issue` — é parte da feature `feature/automatic-dates` (03-automatic-dates.md). Se a validação de `completedDate` for ativada antes dessa feature ser implementada, o campo estará sempre `null` e a regra nunca será satisfeita. Mitigação: a regra `completedDate` deve ser marcada como "experimental" ou desabilitada por padrão até que `feature/automatic-dates` esteja implementada.

### 5. Mixin sem migration (baixo)
Projetos existentes não terão o mixin. O comportamento padrão (sem mixin = sem restrições) é correto e seguro. Mas se administradores ativarem a feature esperando que todos os projetos tenham validação, podem se surpreender que projetos antigos não têm config. Mitigação: documentar isso e exibir um aviso na tela de settings se o projeto ainda não tiver o mixin configurado.

### 6. Regressão no `OnIssueUpdate` existente (baixo)
O novo trigger `OnIssueCompletionCheck` roda sobre o mesmo `TxUpdateDoc<Issue>` que `OnIssueUpdate`. Garantir que não haja conflito entre os dois triggers (ex: `OnIssueUpdate` atualiza `remainingTime` e `OnIssueCompletionCheck` reverte o status — ambos para a mesma issue na mesma transação). Mitigação: o Huly aplica todos os Tx extras dos triggers em sequência; testar explicitamente o cenário de revert com time report simultâneo.

---

## Estimativa de Esforço

| Fase | Estimativa |
|---|---|
| Fase 1 — Modelo de dados | ~2h |
| Fase 2 — Utilitário de validação | ~1.5h |
| Fase 3 — Componentes de UI | ~3h |
| Fase 4 — Hook de status change | ~2h |
| Fase 5 — Trigger de backend | ~2h |
| Fase 6 — Testes e integração | ~1.5h |
| **Total** | **~12h** |

---

## Decisões de Design

| Questão | Decisão | Justificativa |
|---|---|---|
| Config por projeto ou por Space Type? | Por projeto | Requisito explícito; flexibilidade máxima para diferentes projetos da mesma BU |
| Armazenamento da config? | Mixin no Project | Idiomático no Huly; evita query adicional; permite herança futura via Space Type |
| Validação frontend ou backend como principal? | Frontend | UX mais responsiva; backend é safety net para API direta |
| Backend bloqueia ou compensa? | Compensating Tx | Arquitetura de triggers do Huly não suporta bloqueio nativo; compensating Tx é o padrão viável |
| Regras separadas para tasks e subtasks? | Sim | Requisito do produto; subtasks geralmente têm requisitos diferentes (ex: sem allSubIssues) |
| `completedDate` como requisito disponível? | Sim (desabilitado por padrão) | Compatível com feature/automatic-dates; seguro quando não implementado pois padrão é desabilitado |
| Backfill de projetos existentes? | Não (fase 1) | Comportamento padrão sem mixin = sem restrições = equivalente ao estado atual |

---

## Dependências

| Feature | Relação |
|---|---|
| `feature/automatic-dates` | A regra `completedDate` depende desta feature para ser funcional |
| `feature/custom-fields-list-view` | Custom fields como requisitos de conclusão dependem da infraestrutura de custom fields |

---

## Notas de Implementação

### Handler de status change encontrado
**Arquivo:** `plugins/tracker-resources/src/components/issues/StatusEditor.svelte`  
**Função:** `changeStatus()` — linhas 61-78 (original), expandida para ~100 linhas após a feature  
**Ponto de interceptação:** antes do `client.update(value, { status: newStatus })` na linha 72 original

A validação é chamada apenas quando `'_class' in value` (issue existente). Issues em draft (`IssueDraft`) e novas issues durante criação (`AttachedData<Issue>`) não são validadas — correto, pois o status inicial não é uma "conclusão".

### Decisões tomadas durante implementação

| Questão | Decisão | Motivo |
|---|---|---|
| Verificar sub-issue via `parents[]` | `issue.parents?.length > 0` | Campo mais semântico que `attachedToClass`; já usado pelo sistema de triggers |
| Status "Won" no frontend | `statuses?.find(s => s._id === newStatus)?.category === task.statusCategory.Won` | Evita query adicional — `statuses` já está carregado no componente |
| Sub-issues status no frontend | `$statusStore.byId.get(s.status)?.category` | Evita query adicional; store já contém todos os status do workspace |
| Sub-issues status no backend | Query explícita via `control.findAll` | Triggers não têm acesso ao `statusStore` do frontend |
| `CompletionRule` não usa `Ref<>` | Array de objetos inline (`TypeRecord()`) | Simples, sem necessidade de coleção separada para regras |

### Arquivos modificados (lista final real)

| Arquivo | Tipo de mudança |
|---|---|
| `plugins/tracker/src/index.ts` | +`CompletionRule`, `IssueCompletionConfig` interfaces, +mixin ID, +2 string IDs |
| `models/tracker/src/types.ts` | +`TIssueCompletionConfig` mixin class, +imports |
| `models/tracker/src/plugin.ts` | +`SettingsCompletionRules`, `EditCompletionRules` component IDs |
| `models/tracker/src/index.ts` | +`TIssueCompletionConfig` no createModel, +settings category |
| `plugins/tracker-resources/src/plugin.ts` | +13 string IDs para UI/erro |
| `plugins/tracker-assets/lang/en.json` | +17 strings em inglês |
| `plugins/tracker-assets/lang/pt.json` | +17 strings em português |
| `plugins/tracker-assets/lang/pt-br.json` | +17 strings em português (BR) |
| `plugins/tracker-resources/src/index.ts` | +3 imports, +3 componentes no Resources |
| `plugins/tracker-resources/src/components/issues/StatusEditor.svelte` | +função `checkCompletionRules()`, interceptação no `changeStatus()` |
| `server-plugins/tracker/src/index.ts` | +`OnIssueCompletionCheck` trigger ID |
| `server-plugins/tracker-resources/src/index.ts` | +imports, +função `OnIssueCompletionCheck`, +export |
| `models/server-tracker/src/index.ts` | +registro do trigger `OnIssueCompletionCheck` |

### Novos arquivos criados

| Arquivo | Propósito |
|---|---|
| `plugins/tracker-resources/src/components/issues/CompletionBlockedNotification.svelte` | Popup com lista do que falta para concluir |
| `plugins/tracker-resources/src/components/EditCompletionRules.svelte` | Editor de checkboxes (lógica principal) |
| `plugins/tracker-resources/src/components/SettingsCompletionRules.svelte` | Shell de settings (Header + Breadcrumb + editor) |

---

## Como Testar

### Configurar regras por projeto (guia do admin)

1. Acessar **Settings → Tracker → Completion Rules** (requer role Maintainer ou Owner)
2. A tela lista os projetos do workspace — selecionar o projeto desejado
3. Ativar as regras desejadas com os toggles:
   - **Tasks**: regras que se aplicam a issues pai (top-level)
   - **Subtarefas**: regras que se aplicam a sub-issues
4. As regras são salvas imediatamente — sem botão de Salvar

### Casos de teste

**TC01 — Sem config (padrão):**  
Projeto sem mixin → mudar status para Done → deve funcionar normalmente ✓

**TC02 — Regra `spentTime` ativa, sem tempo lançado:**  
Ativar regra → tentar mover issue para Done sem `TimeSpendReport` → popup de bloqueio aparece com "Nenhum tempo foi lançado" ✓

**TC03 — Regra `spentTime` ativa, com tempo lançado:**  
Lançar tempo → tentar mover para Done → deve concluir normalmente ✓

**TC04 — Regra `allSubIssues` ativa, com subtarefa aberta:**  
Ativar regra → criar subtarefa em status A FAZER → tentar fechar task pai → popup com "N subtarefa(s) não concluída(s)" ✓

**TC05 — Regra `allSubIssues` ativa, todas subtarefas concluídas:**  
Concluir todas as subtarefas → mover task pai para Done → deve concluir ✓

**TC06 — Regra `estimation` ativa, sem estimativa:**  
Ativar regra → issue com estimation = 0 → tentar concluir → popup "Estimativa não preenchida" ✓

**TC07 — Safety net backend:**  
Usar API direta para mudar status para Done sem atender requisitos → trigger reverte para status anterior ✓

**TC08 — Subtarefa com regra separada:**  
Configurar regra `spentTime` apenas para subtarefas → mudar status de subtarefa sem tempo → bloqueado; mudar status de task pai → não bloqueado ✓
