# Tarefas (Issues) — CRUD

## Modelo da Tarefa

```typescript
interface Issue {
  _id: Ref<Issue>           // UUID gerado pelo cliente
  _class: 'tracker:class:Issue'
  identifier: string        // Ex: "SEED-42" (gerado automaticamente, vem de Task)
  title: string             // Título da tarefa
  description: MarkupBlobRef | null  // Gerenciado pelo Collaborator (Yjs)
  status: Ref<IssueStatus>  // UUID do status (ex: "A FAZER")
  priority: IssuePriority   // 0=Sem prioridade, 1=Urgente, 2=Alta, 3=Média, 4=Baixa
  assignee: Ref<Person> | null      // Herdado de Task — Ref<Person>, não Employee
  space: Ref<Project>       // UUID do projeto
  component: Ref<Component> | null
  milestone?: Ref<Milestone> | null  // Sprint (opcional)
  estimation: number        // Horas estimadas
  remainingTime: number     // Horas restantes
  reportedTime: number      // Horas lançadas (atualizado por trigger)
  startDate?: Timestamp | null
  dueDate: Timestamp | null
  completedDate?: Timestamp | null
  attachedTo: Ref<Issue>    // UUID do projeto (ou da issue pai se for subtarefa)
  parents: IssueParentInfo[]
  childInfo: IssueChildInfo[]
  subIssues: number         // Contador de subtarefas
  blockedBy?: RelatedDocument[]
  relations?: RelatedDocument[]
  // Campos customizados 3F (obrigatórios)
  clientName: string        // Nome do Cliente
  clientStage: ClientStage  // Onboarding | Expansion | Retention | Churned
  // Campos do Ciclo PDCA (opcionais)
  pdcaCycleActive?: boolean
  pdcaCycleFrequency?: PdcaFrequency // weekly | biweekly | monthly | quarterly
  pdcaCycleResetStatus?: Ref<IssueStatus>
  pdcaNextCycleDate?: Timestamp
  pdcaCycleDueDays?: number[]
  pdcaCycleDuplicate?: boolean
}

enum IssuePriority { NoPriority = 0, Urgent = 1, High = 2, Medium = 3, Low = 4 }
enum PdcaFrequency { Weekly = 'weekly', Biweekly = 'biweekly', Monthly = 'monthly', Quarterly = 'quarterly' }
enum ClientStage { Onboarding = 'onboarding', Expansion = 'expansion', Retention = 'retention', Churned = 'churned' }
```

---

## Classes e IDs importantes

```
tracker:class:Issue       → Tarefa
tracker:class:Project     → Projeto
tracker:class:IssueStatus → Status
tracker:class:Component   → Componente
tracker:class:Milestone   → Sprint
```

---

## Listar Tarefas

```typescript
import { connectRest } from '@hcengineering/api-client'
import tracker from '@hcengineering/tracker'

const client = await connectRest('http://localhost:7000', {
  email: 'usuario@exemplo.com',
  password: 'senha',
  workspace: '3fventure'
})

// Todas as tarefas de um projeto
const tarefas = await client.findAll(tracker.class.Issue, {
  space: 'uuid-do-projeto' as any
})

// Tarefas por status
const emAndamento = await client.findAll(tracker.class.Issue, {
  space: 'uuid-do-projeto' as any,
  status: 'uuid-status-em-andamento' as any
})

// Tarefas de um responsável
const minhasTarefas = await client.findAll(tracker.class.Issue, {
  assignee: 'uuid-do-responsavel' as any
})

// Com paginação e ordenação
const recentes = await client.findAll(
  tracker.class.Issue,
  { space: 'uuid-do-projeto' as any },
  { limit: 20, sort: { modifiedOn: -1 } }
)
```

### Filtrar por campos customizados 3F

Todos os campos customizados podem ser usados em `query`. Os campos abaixo são indexados (`@Index(IndexKind.Indexed)`) e filtram com boa performance:

```typescript
// Tarefas de um cliente específico
const doCliente = await client.findAll(tracker.class.Issue, {
  space: 'uuid-do-projeto' as any,
  clientName: 'Acme Ltda'
})

// Tarefas por etapa do cliente
const onboarding = await client.findAll(tracker.class.Issue, {
  space: 'uuid-do-projeto' as any,
  clientStage: 'onboarding' as any
})

// Tarefas com ciclo PDCA ativo
const comPdca = await client.findAll(tracker.class.Issue, {
  space: 'uuid-do-projeto' as any,
  pdcaCycleActive: true
})

// Tarefas de PDCA mensal de um cliente
const pdcaMensal = await client.findAll(tracker.class.Issue, {
  space: 'uuid-do-projeto' as any,
  clientName: 'Acme Ltda',
  pdcaCycleActive: true,
  pdcaCycleFrequency: 'monthly' as any
})

// Combinando vários filtros — todas as tarefas Urgentes do cliente em onboarding
const urgentesOnboarding = await client.findAll(tracker.class.Issue, {
  space: 'uuid-do-projeto' as any,
  clientStage: 'onboarding' as any,
  priority: 1
})
```

> Como `clientName`, `clientStage` e `pdcaCycleResetStatus` são indexados, é seguro usá-los como filtros principais. Operadores Mongo-like (`$in`, `$ne`, `$exists`) também funcionam: `{ clientStage: { $in: ['onboarding', 'expansion'] } }`.

---

## Buscar Uma Tarefa

```typescript
// Por ID
const tarefa = await client.findOne(tracker.class.Issue, {
  _id: 'uuid-da-tarefa' as any
})

// Por identificador (ex: SEED-42)
const tarefa = await client.findOne(tracker.class.Issue, {
  identifier: 'SEED-42'
})
```

---

## Criar Tarefa

```typescript
import { createRestTxOperations } from '@hcengineering/api-client'
import tracker from '@hcengineering/tracker'

const client = await createRestTxOperations(
  'http://localhost:3332',
  'uuid-do-workspace',
  'token-jwt'
)

const novaIssueId = await client.createDoc(
  tracker.class.Issue,
  'uuid-do-projeto' as any,
  {
    title: '[CLIENTE] Reunião de Onboarding',
    status: 'uuid-status-a-fazer' as any,
    priority: 2,                          // Alta
    assignee: 'uuid-do-responsavel' as any,
    estimation: 2,
    remainingTime: 2,
    reportedTime: 0,
    attachedTo: 'uuid-do-projeto' as any,
    attachedToClass: tracker.class.Project,
    collection: 'issues',
    subIssues: 0,
    parents: [],
    childInfo: [],
    relations: [],
    component: null,
    milestone: null,
    description: null,
    startDate: Date.now(),
    dueDate: null,
    completedDate: null,
    // Campos customizados 3F (obrigatórios no modelo)
    clientName: 'Cliente Exemplo',
    clientStage: 'onboarding'
  }
)

console.log('Tarefa criada:', novaIssueId)
```

---

## Criar Subtarefa

Subtarefa é uma `Issue` com `attachedTo` apontando para outra `Issue`:

```typescript
const subtarefaId = await client.addCollection(
  tracker.class.Issue,
  'uuid-do-projeto' as any,
  'uuid-da-tarefa-pai',      // attachedTo
  tracker.class.Issue,       // attachedToClass
  'subIssues',               // collection
  {
    title: 'Subtarefa de exemplo',
    status: 'uuid-status-a-fazer' as any,
    priority: 3,             // Média
    assignee: null,
    estimation: 1,
    remainingTime: 1,
    reportedTime: 0,
    subIssues: 0,
    parents: [],
    childInfo: [],
    relations: [],
    component: null,
    milestone: null,
    description: null,
    startDate: null,
    dueDate: null,
    completedDate: null,
    // Campos customizados 3F (obrigatórios no modelo)
    clientName: 'Cliente Exemplo',
    clientStage: 'onboarding'
  }
)
```

---

## Atualizar Tarefa

```typescript
// Atualizar status
await client.updateDoc(
  tracker.class.Issue,
  'uuid-do-projeto' as any,
  'uuid-da-tarefa',
  { status: 'uuid-novo-status' as any }
)

// Atualizar responsável e prioridade
await client.updateDoc(
  tracker.class.Issue,
  'uuid-do-projeto' as any,
  'uuid-da-tarefa',
  {
    assignee: 'uuid-novo-responsavel' as any,
    priority: 1  // Urgente
  }
)

// Lançar tempo gasto
await client.updateDoc(
  tracker.class.Issue,
  'uuid-do-projeto' as any,
  'uuid-da-tarefa',
  { reportedTime: 3.5 }
)
```

---

## Deletar Tarefa

```typescript
await client.removeDoc(
  tracker.class.Issue,
  'uuid-do-projeto' as any,
  'uuid-da-tarefa'
)
```

---

## Adicionar Comentário

```typescript
import chunter from '@hcengineering/chunter'

await client.addCollection(
  chunter.class.ChatMessage,
  'uuid-do-projeto' as any,
  'uuid-da-tarefa',
  tracker.class.Issue,
  'comments',
  {
    message: 'Comentário adicionado via 3F OS',
    attachments: 0,
    editedOn: undefined
  }
)
```

---

## Valores de Prioridade

| Valor | Nome |
|---|---|
| `0` | Sem Prioridade |
| `1` | Urgente |
| `2` | Alta |
| `3` | Média |
| `4` | Baixa |

---

## Etapa do Cliente (clientStage)

| Valor | Label |
|---|---|
| `'onboarding'` | Onboarding |
| `'expansion'` | Expansão |
| `'retention'` | Retenção |
| `'churned'` | Churned |

---

## Código fonte de referência

- Modelo da Issue: `plugins/tracker/src/index.ts` linha 227
- Enum IssuePriority: `plugins/tracker/src/index.ts` linha 156
- Enum PdcaFrequency: `plugins/tracker/src/index.ts` linha 56
- Enum ClientStage: `plugins/tracker/src/index.ts` linha 66
- TxOperations (CRUD): `foundations/core/packages/core/src/tx.ts`
- createRestTxOperations: `foundations/core/packages/api-client/src/rest/tx.ts`
