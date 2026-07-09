# Projetos

## Modelo do Projeto

```typescript
interface Project {
  _id: Ref<Project>
  _class: 'tracker:class:Project'
  // Vindos de Space:
  name: string              // Ex: "Seed - Performance"
  description: string       // Obrigatório (vem de Space, não opcional)
  private: boolean
  archived: boolean
  members: AccountUuid[]    // Lista de UUIDs de contas (não Ref<Account>)
  owners?: AccountUuid[]
  autoJoin?: boolean
  // Vindos de TypedSpace:
  type: Ref<ProjectType>    // Space Type associado (define status/fluxo)
  // Específicos de tracker.Project:
  identifier: string        // Prefixo das tarefas: "SEED", "BOMM", etc.
  sequence: number
  defaultIssueStatus?: Ref<IssueStatus>
  defaultAssignee?: Ref<Employee>
  defaultTimeReportDay: TimeReportDayType
}
```

---

## Listar Todos os Projetos

```typescript
import { connectRest } from '@hcengineering/api-client'
import tracker from '@hcengineering/tracker'

const client = await connectRest('http://localhost:7000', {
  email: 'usuario@exemplo.com',
  password: 'senha',
  workspace: '3fventure'
})

const projetos = await client.findAll(tracker.class.Project, {})
```

**Resposta esperada:**
```json
[
  {
    "_id": "uuid-seed-performance",
    "name": "Seed - Performance",
    "identifier": "SEEDP",
    "description": "",
    "private": false,
    "archived": false
  },
  {
    "_id": "uuid-bomma-performance",
    "name": "Bomma - Performance",
    "identifier": "BOMMP",
    ...
  }
]
```

---

## Buscar Projeto pelo Nome

```typescript
const projeto = await client.findOne(tracker.class.Project, {
  name: 'Seed - Performance'
})
```

---

## Listar Status de um Projeto

Os status são definidos no Space Type (`ProjectType`) do projeto, não no projeto diretamente. Cada Space Type tem um ou mais `TaskType`, e cada `TaskType` referencia a lista de `Status` permitidos.

```typescript
import tracker from '@hcengineering/tracker'
import task from '@hcengineering/task'

// 1) Listar todos os status do workspace (classe correta é IssueStatus / Status)
const statuses = await client.findAll(tracker.class.IssueStatus, {})

// 2) Resolver os status permitidos pelo Space Type do projeto:
const projeto = await client.findOne(tracker.class.Project, { _id: 'uuid-projeto' as any })
const taskTypes = await client.findAll(task.class.TaskType, { parent: projeto!.type })
const statusesDoProjeto = await client.findAll(tracker.class.IssueStatus, {
  _id: { $in: taskTypes.flatMap(t => t.statuses) }
})
```

> `task.class.TaskType` é a **definição de tipo de tarefa** (carrega `statuses: Ref<Status>[]`), não o status em si. Para os UUIDs dos status, use `tracker.class.IssueStatus`.

---

## Projetos da 3F Venture

Conforme a estrutura definida no CLAUDE.md:

| Projeto | BU | Identificador esperado |
|---|---|---|
| Seed - Performance | Seed | SEEDP |
| Seed - Planejamento Design | Seed | SEEDPD |
| Seed - Audiovisual | Seed | SEEDAV |
| Seed - Branding | Seed | SEEDB |
| Seed - Site LP | Seed | SEEDSLP |
| Bomma - Performance | Bomma | BOMMP |
| Bomma - Planejamento Design | Bomma | BOMMPD |
| Bomma - Audiovisual | Bomma | BOMMAV |
| Bomma - Branding | Bomma | BOMMB |
| Bomma - Site LP | Bomma | BOMMSLP |
| Impulse - Performance | Impulse | IMPP |
| Impulse - Planejamento Design | Impulse | IMPPD |
| Impulse - Audiovisual | Impulse | IMPAV |
| Impulse - Branding | Impulse | IMPB |
| Impulse - Site LP | Impulse | IMPSLP |
| Tecnologia - Chamados | Tecnologia | TECCH |
| Tecnologia - Automações & Tecnologias | Tecnologia | TECAT |

> **Atenção:** os identificadores acima são *sugestões* (não foram validados contra o banco). Os identifiers reais são gerados na criação do projeto e podem divergir. Rodar `automation/list-projects.ts` para obter os identifiers reais. Os UUIDs sempre devem ser obtidos via `findAll` em runtime — nunca hardcodar.

---

## Listar Membros de um Projeto

Os membros de um projeto vivem em `project.members: AccountUuid[]` (herdado de `Space`). Para resolver os perfis (nome, etc.), busque os `Person` pelos social IDs vinculados aos `AccountUuid`:

```typescript
import contact from '@hcengineering/contact'

// 1) IDs dos membros direto do projeto
const projeto = await client.findOne(tracker.class.Project, { _id: 'uuid-projeto' as any })
const memberAccountUuids = projeto!.members  // AccountUuid[]

// 2) Listar todos os funcionários do workspace (mixin Employee em Person)
const employees = await client.findAll(contact.mixin.Employee, {})

// 3) Listar Persons (entidades de pessoa) do workspace
const pessoas = await client.findAll(contact.class.Person, {})
```

> `contact.class.Member` **não** é o membro de workspace — é um `AttachedDoc` usado para vincular um `Contact` a uma `Organization`. Para listar pessoas do workspace, use `contact.class.Person` ou o mixin `contact.mixin.Employee`.

---

## Código fonte de referência

- Modelo do Project (tracker): `plugins/tracker/src/index.ts` linha 81
- Task Project base: `plugins/task/src/index.ts` linha 47
- Space (Doc base com members/private/archived): `foundations/core/packages/core/src/classes.ts` linha 494
- TypedSpace (com `type: Ref<ProjectType>`): `foundations/core/packages/core/src/classes.ts` linha 516
