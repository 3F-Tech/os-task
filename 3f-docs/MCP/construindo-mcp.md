# Construindo o MCP Server para o 3F OS

Guia para criar um servidor MCP que conecta o **3F OS** ao **3F Tasks**, permitindo criar e gerenciar tarefas por chat.

---

## Pré-requisitos

- Node.js 20+
- Acesso ao 3F Tasks rodando (local ou VPS)
- Credenciais de um usuário do workspace

---

## 1. Inicializar o projeto

```bash
mkdir 3f-tasks-mcp
cd 3f-tasks-mcp
npm init -y
npm install @modelcontextprotocol/sdk @hcengineering/api-client
npm install -D typescript @types/node
```

---

## 2. Estrutura de arquivos

```
3f-tasks-mcp/
├── src/
│   ├── index.ts       # Entry point do servidor MCP
│   ├── client.ts      # Conexão com o 3F Tasks
│   ├── auth.ts        # Helpers de role e identidade do token
│   └── tools/
│       ├── tarefas.ts # Ferramentas de tarefas
│       └── projetos.ts # Ferramentas de projetos
├── package.json
└── tsconfig.json
```

---

## 3. Conexão com o 3F Tasks (client.ts)

> O token é gerado na UI do 3F Tasks em **Settings → General → API Access → Generate API Token**.
> O UUID do workspace está embutido no payload JWT — não precisa de email/senha.

```typescript
import {
  createRestClient,
  createRestTxOperations,
  type RestClient
} from '@hcengineering/api-client'
import type { TxOperations } from '@hcengineering/core'

// Variáveis de ambiente — ver seção 7
const TRANSACTOR_URL = process.env.HUB_TRANSACTOR_URL ?? 'http://localhost:3332'
const WORKSPACE_ID = process.env.HUB_WORKSPACE_ID!   // UUID do workspace (payload do token)
const API_TOKEN = process.env.HUB_API_TOKEN!          // Token gerado na UI

let readClient: RestClient | null = null
let writeClient: TxOperations | null = null

export function getReadClient (): RestClient {
  if (readClient == null) {
    readClient = createRestClient(TRANSACTOR_URL, WORKSPACE_ID, API_TOKEN)
  }
  return readClient
}

export async function getWriteClient (): Promise<TxOperations> {
  if (writeClient == null) {
    writeClient = await createRestTxOperations(TRANSACTOR_URL, WORKSPACE_ID, API_TOKEN)
  }
  return writeClient
}
```

> O pacote `@hcengineering/api-client` expõe apenas as factories `createRestClient` (leitura) e `createRestTxOperations` (escrita via `TxOperations`). A classe `RestClientImpl` é interna e não é exportada — não tente importá-la diretamente.

---

## 3.1 Helpers compartilhados (auth.ts)

Dois helpers usados por mais de uma tool: gate de role e resolução do `Ref<Person>` do dono do token.

```typescript
import contact from '@hcengineering/contact'
import { AccountRole, type Account, type Ref } from '@hcengineering/core'
import type { Person } from '@hcengineering/contact'
import { getReadClient } from './client'

// Ordem das roles (de `foundations/core/packages/core/src/classes.ts:617`)
const roleOrder: Record<AccountRole, number> = {
  [AccountRole.ReadOnlyGuest]: 5,
  [AccountRole.DocGuest]: 10,
  [AccountRole.Guest]: 20,
  [AccountRole.User]: 30,
  [AccountRole.Maintainer]: 40,
  [AccountRole.Owner]: 50,
  [AccountRole.Admin]: 100
}

let cachedAccount: Account | null = null
let cachedPersonRef: Ref<Person> | null = null

/** Conta autenticada do token atual (cacheada — não muda durante a sessão). */
export async function getCurrentAccount (): Promise<Account> {
  if (cachedAccount == null) {
    cachedAccount = await getReadClient().getAccount()
  }
  return cachedAccount
}

/** Falha se a role da conta estiver abaixo de `minRole`. */
export async function requireRole (minRole: AccountRole): Promise<void> {
  const account = await getCurrentAccount()
  if (roleOrder[account.role] < roleOrder[minRole]) {
    throw new Error(`Acesso negado: requer ${minRole}, conta tem role ${account.role}`)
  }
}

/** Resolve o Ref<Person> do dono do token (usado em filtros `assignee`). */
export async function getCurrentPersonRef (): Promise<Ref<Person>> {
  if (cachedPersonRef == null) {
    const account = await getCurrentAccount()
    const social = await getReadClient().findOne(contact.class.SocialIdentity, {
      _id: account.primarySocialId as any
    })
    if (social == null) {
      throw new Error('SocialIdentity não encontrada para o token — token sem Person vinculada?')
    }
    cachedPersonRef = social.attachedTo as Ref<Person>
  }
  return cachedPersonRef
}
```

---

## 4. Ferramentas de Tarefas (tools/tarefas.ts)

```typescript
import tracker from '@hcengineering/tracker'
import { AccountRole } from '@hcengineering/core'
import { getReadClient, getWriteClient } from '../client'
import { getCurrentPersonRef, requireRole } from '../auth'

export const tarefasTools = {
  listar_tarefas: {
    description: 'Lista tarefas de um projeto. Aceita filtros por status, responsável, cliente, etapa do cliente e ciclo PDCA.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto_id: { type: 'string', description: 'UUID do projeto' },
        status_id: { type: 'string', description: 'UUID do status (opcional)' },
        responsavel_id: { type: 'string', description: 'UUID do responsável (opcional)' },
        nome_cliente: { type: 'string', description: 'Filtrar por nome do cliente exato (opcional)' },
        etapa_cliente: {
          type: 'string',
          enum: ['onboarding', 'expansion', 'retention', 'churned'],
          description: 'Filtrar por etapa do cliente (opcional)'
        },
        pdca_ativo: { type: 'boolean', description: 'Filtrar somente tarefas com Ciclo PDCA ativo (opcional)' },
        frequencia_pdca: {
          type: 'string',
          enum: ['weekly', 'biweekly', 'monthly', 'quarterly'],
          description: 'Filtrar por frequência do ciclo PDCA (opcional)'
        },
        limite: { type: 'number', description: 'Máximo de resultados (padrão: 50)' }
      },
      required: ['projeto_id']
    },
    handler: async ({
      projeto_id,
      status_id,
      responsavel_id,
      nome_cliente,
      etapa_cliente,
      pdca_ativo,
      frequencia_pdca,
      limite = 50
    }: any) => {
      const client = getReadClient()
      const query: any = { space: projeto_id }
      if (status_id) query.status = status_id
      if (responsavel_id) query.assignee = responsavel_id
      if (nome_cliente) query.clientName = nome_cliente
      if (etapa_cliente) query.clientStage = etapa_cliente
      if (pdca_ativo !== undefined) query.pdcaCycleActive = pdca_ativo
      if (frequencia_pdca) query.pdcaCycleFrequency = frequencia_pdca

      const tarefas = await client.findAll(tracker.class.Issue, query, {
        limit: limite,
        sort: { modifiedOn: -1 }
      })

      return tarefas.map((t: any) => ({
        id: t._id,
        identificador: t.identifier,
        titulo: t.title,
        status: t.status,
        prioridade: ['Sem prioridade', 'Urgente', 'Alta', 'Média', 'Baixa'][t.priority] ?? t.priority,
        responsavel: t.assignee,
        estimativa: t.estimation,
        tempo_lancado: t.reportedTime,
        inicio: t.startDate ? new Date(t.startDate).toLocaleDateString('pt-BR') : null,
        vencimento: t.dueDate ? new Date(t.dueDate).toLocaleDateString('pt-BR') : null,
        finalizado_em: t.completedDate ? new Date(t.completedDate).toLocaleDateString('pt-BR') : null,
        // Campos customizados 3F
        nome_cliente: t.clientName,
        etapa_cliente: t.clientStage,
        pdca_ativo: t.pdcaCycleActive ?? false,
        frequencia_pdca: t.pdcaCycleFrequency ?? null,
        proximo_ciclo_pdca: t.pdcaNextCycleDate ? new Date(t.pdcaNextCycleDate).toLocaleDateString('pt-BR') : null
      }))
    }
  },

  criar_tarefa: {
    description: 'Cria uma nova tarefa no 3F Tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto_id: { type: 'string', description: 'UUID do projeto' },
        titulo: { type: 'string', description: 'Título da tarefa' },
        status_id: { type: 'string', description: 'UUID do status inicial' },
        nome_cliente: { type: 'string', description: 'Nome do cliente (obrigatório)' },
        etapa_cliente: {
          type: 'string',
          enum: ['onboarding', 'expansion', 'retention', 'churned'],
          description: 'Etapa do cliente (obrigatório)'
        },
        prioridade: {
          type: 'number',
          description: '0=Sem prioridade, 1=Urgente, 2=Alta, 3=Média, 4=Baixa',
          default: 3
        },
        responsavel_id: { type: 'string', description: 'UUID do responsável (opcional)' },
        estimativa: { type: 'number', description: 'Horas estimadas (opcional)' },
        vencimento: { type: 'string', description: 'Data de vencimento ISO 8601 (opcional)' },
        pdca_ativo: { type: 'boolean', description: 'Ativar Ciclo PDCA (opcional)' },
        frequencia_pdca: {
          type: 'string',
          enum: ['weekly', 'biweekly', 'monthly', 'quarterly'],
          description: 'Frequência do ciclo PDCA (obrigatório se pdca_ativo=true)'
        }
      },
      required: ['projeto_id', 'titulo', 'status_id', 'nome_cliente', 'etapa_cliente']
    },
    handler: async ({
      projeto_id,
      titulo,
      status_id,
      nome_cliente,
      etapa_cliente,
      prioridade = 3,
      responsavel_id,
      estimativa = 0,
      vencimento,
      pdca_ativo,
      frequencia_pdca
    }: any) => {
      const client = await getWriteClient()

      const id = await client.createDoc(
        tracker.class.Issue,
        projeto_id,
        {
          title: titulo,
          status: status_id,
          priority: prioridade,
          assignee: responsavel_id ?? null,
          estimation: estimativa,
          remainingTime: estimativa,
          reportedTime: 0,
          attachedTo: projeto_id,
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
          dueDate: vencimento ? new Date(vencimento).getTime() : null,
          completedDate: null,
          // Campos customizados 3F (obrigatórios no modelo)
          clientName: nome_cliente,
          clientStage: etapa_cliente,
          // PDCA (opcional)
          ...(pdca_ativo !== undefined ? { pdcaCycleActive: pdca_ativo } : {}),
          ...(frequencia_pdca ? { pdcaCycleFrequency: frequencia_pdca } : {})
        }
      )

      return { id, mensagem: `Tarefa criada com sucesso` }
    }
  },

  atualizar_status: {
    description: 'Atualiza o status de uma tarefa.',
    inputSchema: {
      type: 'object',
      properties: {
        tarefa_id: { type: 'string', description: 'UUID da tarefa' },
        projeto_id: { type: 'string', description: 'UUID do projeto' },
        status_id: { type: 'string', description: 'UUID do novo status' }
      },
      required: ['tarefa_id', 'projeto_id', 'status_id']
    },
    handler: async ({ tarefa_id, projeto_id, status_id }: any) => {
      const client = await getWriteClient()
      await client.updateDoc(tracker.class.Issue, projeto_id, tarefa_id, { status: status_id })
      return { mensagem: 'Status atualizado com sucesso' }
    }
  },

  buscar_tarefa: {
    description: 'Busca uma tarefa pelo identificador (ex: SEED-42) ou por texto.',
    inputSchema: {
      type: 'object',
      properties: {
        identificador: { type: 'string', description: 'Identificador da tarefa (ex: SEED-42)' },
        texto: { type: 'string', description: 'Texto para busca (opcional)' }
      }
    },
    handler: async ({ identificador, texto }: any) => {
      const client = getReadClient()

      if (identificador) {
        return await client.findOne(tracker.class.Issue, { identifier: identificador })
      }

      if (texto) {
        return await client.searchFulltext(
          { query: texto, classes: ['tracker:class:Issue'] },
          { limit: 10 }
        )
      }

      throw new Error('Informe um identificador ou texto para busca')
    }
  },

  minhas_tarefas_pendentes: {
    description: 'Lista as tarefas pendentes (não concluídas/canceladas) atribuídas ao dono do token.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto_id: { type: 'string', description: 'Restringir a um projeto específico (opcional)' },
        limite: { type: 'number', description: 'Máximo de resultados (padrão: 100)' }
      }
    },
    handler: async ({ projeto_id, limite = 100 }: any) => {
      const client = getReadClient()
      const meuPersonRef = await getCurrentPersonRef()

      const query: any = {
        assignee: meuPersonRef,
        isDone: { $ne: true }   // exclui status com category Won/Lost
      }
      if (projeto_id) query.space = projeto_id

      const tarefas = await client.findAll(tracker.class.Issue, query, {
        limit: limite,
        sort: { dueDate: 1, modifiedOn: -1 }
      })

      return tarefas.map((t: any) => ({
        id: t._id,
        identificador: t.identifier,
        titulo: t.title,
        projeto: t.space,
        status: t.status,
        prioridade: ['Sem prioridade', 'Urgente', 'Alta', 'Média', 'Baixa'][t.priority] ?? t.priority,
        nome_cliente: t.clientName,
        etapa_cliente: t.clientStage,
        vencimento: t.dueDate ? new Date(t.dueDate).toLocaleDateString('pt-BR') : null,
        atrasada: t.dueDate != null && t.dueDate < Date.now()
      }))
    }
  },

  tarefas_pendentes_de: {
    description: 'Lista tarefas pendentes de um usuário específico. Requer role Maintainer ou superior.',
    inputSchema: {
      type: 'object',
      properties: {
        person_ref: { type: 'string', description: 'Ref<Person> do usuário-alvo' },
        projeto_id: { type: 'string', description: 'Restringir a um projeto específico (opcional)' },
        limite: { type: 'number', description: 'Máximo de resultados (padrão: 100)' }
      },
      required: ['person_ref']
    },
    handler: async ({ person_ref, projeto_id, limite = 100 }: any) => {
      await requireRole(AccountRole.Maintainer)   // gate de role

      const client = getReadClient()
      const query: any = {
        assignee: person_ref,
        isDone: { $ne: true }
      }
      if (projeto_id) query.space = projeto_id

      const tarefas = await client.findAll(tracker.class.Issue, query, {
        limit: limite,
        sort: { dueDate: 1, modifiedOn: -1 }
      })

      return tarefas.map((t: any) => ({
        id: t._id,
        identificador: t.identifier,
        titulo: t.title,
        projeto: t.space,
        status: t.status,
        prioridade: ['Sem prioridade', 'Urgente', 'Alta', 'Média', 'Baixa'][t.priority] ?? t.priority,
        nome_cliente: t.clientName,
        etapa_cliente: t.clientStage,
        vencimento: t.dueDate ? new Date(t.dueDate).toLocaleDateString('pt-BR') : null,
        atrasada: t.dueDate != null && t.dueDate < Date.now()
      }))
    }
  }
}
```

> **Por que `isDone` e não `status`:** o campo `isDone?: boolean` é mantido automaticamente por trigger do tracker — vira `true` quando a issue entra num status da categoria `Won` (finalizado) ou `Lost` (cancelado). Isso evita ter que carregar a tabela de status pra montar a query. Definido em `plugins/task/src/index.ts:57` e nas categorias em `plugins/task/src/index.ts:272-279`.

> **Sobre o gate de role:** `requireRole` é defesa-em-profundidade no MCP. A barreira real continua sendo o backend do 3F Tasks (o `findAll` só retorna o que a role do token permite ver). Se o 3F OS também fizer guardrail antes de expor a tool, melhor ainda — defesa em três camadas.

---

## 5. Ferramentas de Projetos (tools/projetos.ts)

```typescript
import tracker from '@hcengineering/tracker'
import { getReadClient } from '../client'

export const projetosTools = {
  listar_projetos: {
    description: 'Lista todos os projetos do workspace 3F Venture.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      const client = getReadClient()
      const projetos = await client.findAll(tracker.class.Project, { archived: false })
      return projetos.map((p: any) => ({
        id: p._id,
        nome: p.name,
        identificador: p.identifier
      }))
    }
  }
}
```

---

## 6. Entry point do servidor (index.ts)

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tarefasTools } from './tools/tarefas'
import { projetosTools } from './tools/projetos'

const allTools = { ...tarefasTools, ...projetosTools }

const server = new Server(
  { name: '3f-tasks-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(allTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = allTools[request.params.name as keyof typeof allTools]
  if (!tool) throw new Error(`Ferramenta desconhecida: ${request.params.name}`)

  const result = await tool.handler(request.params.arguments ?? {})
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
```

---

## 7. Variáveis de ambiente

O token é gerado uma vez na UI e colocado nas variáveis de ambiente. Sem email/senha.

```env
# Endpoint do Transactor (porta 3332, não a porta do app 7000)
# Local:
HUB_TRANSACTOR_URL=http://localhost:3332
# Produção (VPS):
# HUB_TRANSACTOR_URL=https://3ftasks.3fventure.tech:3332

# UUID do workspace — extraído do payload JWT do token gerado na UI
# Decodificar base64 da parte central do token para obter o workspace UUID
HUB_WORKSPACE_ID=b001f439-0561-4eea-b40d-5d6df7972a79

# Token gerado em: Settings → General → API Access → Generate API Token
HUB_API_TOKEN=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
```

**Como extrair o WORKSPACE_ID do token:**
```bash
# Pegar a parte central do JWT (entre os dois pontos) e decodificar
echo "eyJleHRyYSI6..." | base64 -d
# Saída: {"extra":{"authMethod":"password"},"account":"...","workspace":"UUID-AQUI"}
```

---

## 8. Registrar no 3F OS

Adicionar ao arquivo de configuração de MCPs do 3F OS (mesma estrutura dos MCPs de Meta/Gmail/Calendar):

```json
{
  "mcpServers": {
    "3f-tasks": {
      "command": "node",
      "args": ["./3f-tasks-mcp/dist/index.js"],
      "env": {
        "HUB_TRANSACTOR_URL": "https://3ftasks.3fventure.tech:3332",
        "HUB_WORKSPACE_ID": "b001f439-0561-4eea-b40d-5d6df7972a79",
        "HUB_API_TOKEN": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
      }
    }
  }
}
```

Para renovar o acesso: gerar novo token na UI do 3F Tasks e atualizar apenas `HUB_API_TOKEN`.

---

## Ferramentas disponíveis após implementação

| Ferramenta | O que faz | Role mínima |
|---|---|---|
| `listar_projetos` | Lista todos os projetos da 3F Venture | User |
| `listar_tarefas` | Lista tarefas de um projeto, filtra por status, responsável, cliente, etapa e ciclo PDCA | User |
| `criar_tarefa` | Cria uma nova tarefa (com `clientName`, `clientStage` e PDCA opcional) | User |
| `atualizar_status` | Muda o status de uma tarefa | User |
| `buscar_tarefa` | Busca por identificador (SEED-42) ou texto | User |
| `minhas_tarefas_pendentes` | Lista as tarefas pendentes do dono do token | User |
| `tarefas_pendentes_de` | Lista as tarefas pendentes de outro usuário | **Maintainer** |

---

## Próximas ferramentas sugeridas

- `criar_subtarefa` — criar subtarefa vinculada a uma issue
- `adicionar_comentario` — comentar em uma tarefa
- `lancar_tempo` — registrar horas em uma tarefa
- `listar_membros` — listar usuários do workspace
- `listar_status` — listar status disponíveis de um projeto
- `buscar_tarefas_atrasadas` — tarefas com dueDate vencida

---

## Referências

- Autenticação: [autenticacao.md](./autenticacao.md)
- Endpoints REST: [api-rest.md](./api-rest.md)
- Modelo de tarefas: [tarefas.md](./tarefas.md)
- Projetos: [projetos.md](./projetos.md)
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
