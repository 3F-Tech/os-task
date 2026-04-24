# Guia de Desenvolvimento — 3F Hub

## Pré-requisitos

- Docker Desktop rodando com os containers do Huly ativos em `localhost:7000`
- Rush instalado globalmente (`npm install -g @microsoft/rush`)
- Node.js 20+

---

## Rodando o frontend em desenvolvimento

```bash
# A partir da raiz do projeto
cd dev/prod
rushx dev-server
```

O servidor sobe em `http://localhost:8080` com **hot reload** — qualquer arquivo `.svelte` ou `.ts` salvo recompila automaticamente em segundos.

O webpack já está configurado para proxiar todas as chamadas de API e WebSocket para o Docker em `localhost:7000`.

```
Seu browser (localhost:8080)
       ↓  frontend servido pelo webpack
       ↓  chamadas de API/WebSocket proxiadas para
Docker backend (localhost:7000)
```

### Checklist antes de rodar

```bash
# 1. Verificar se o Docker está de pé
docker ps | grep huly

# 2. Build dos pacotes (só necessário na primeira vez ou após rush install)
rush build

# 3. Subir o dev server
cd dev/prod
rushx dev-server
```

> Se o Docker estiver parado, o login funciona mas o workspace fica carregando infinitamente.
> Causa comum: container `redpanda` unhealthy. Solução: `docker restart <nome_do_container_redpanda>`

---

## Dois mundos: frontend vs backend

O Docker roda **imagens pré-compiladas** do Docker Hub (`hardcoreeng/transactor`, `hardcoreeng/account`, etc.).
Mudanças no código-fonte **não refletem automaticamente** no Docker — dependendo do que você alterar, o fluxo é diferente.

```
Seu código-fonte (platform/)
     ↕ NÃO conectado automaticamente
Docker (imagens hardcoreeng/* do Docker Hub)
```

---

## Fluxo por tipo de mudança

| Tipo de mudança | Onde mexe | Como testar |
|---|---|---|
| Componentes Svelte (UI) | `plugins/*-resources/src/` | Hot reload automático — só salvar o arquivo |
| Lógica TypeScript de UI | `plugins/*/src/` | Hot reload automático |
| Custom fields list view | Svelte + TypeScript UI | Hot reload |
| Home Dashboard | Svelte + TypeScript UI | Hot reload |
| Validação de conclusão (frontend) | Checar antes de mudar status | Hot reload |
| Triggers server-side | `server-plugins/` ou `pods/` | Precisa rebuildar Docker |
| Datas automáticas | Trigger no transactor | Precisa rebuildar Docker |
| Ciclo PDCA | Scheduler + trigger | Precisa rebuildar Docker |
| BU access control | Frontend + permissões server | Hot reload (frontend) + Docker rebuild (backend) |

---

## Rebuildar o backend (Docker)

Quando a mudança é em código server-side (triggers, permissões, model):

```bash
# 1. Compilar o projeto
rush build

# 2. Buildar a imagem Docker do serviço alterado
# Exemplo para o transactor (servidor principal):
cd pods/server
rushx docker:build

# 3. Restartar o container com a nova imagem
docker compose up -d --force-recreate transactor
```

Os pods disponíveis e seus containers correspondentes:

| Pasta | Container Docker |
|---|---|
| `pods/server` | `transactor` |
| `pods/account` | `account` |
| `pods/collaborator` | `collaborator` |
| `pods/front` | `front` |
| `pods/workspace` | `workspace` |
| `pods/fulltext` | `fulltext` |

> O rebuild de Docker demora bastante (5–15 min). Para as features de UI, sempre prefira o fluxo de hot reload.

---

## Estrutura dos arquivos por tipo de mudança

```
platform/
├── plugins/
│   ├── tracker-resources/src/components/   ← Componentes Svelte do Tracker
│   ├── tracker/src/index.ts                ← Definições e interfaces do Tracker
│   └── workbench/src/                      ← Navegação e rotas da UI
├── models/
│   └── tracker/src/                        ← Modelo de dados (schema)
├── server-plugins/
│   └── server-tracker/src/                 ← Triggers e lógica server-side do Tracker
└── pods/
    └── server/src/                         ← Entry point do transactor
```

---

## Regras importantes

- **NUNCA** use `pnpm install` diretamente — use `rush install`
- **NUNCA** edite o banco diretamente — toda mutação é uma Tx (transação)
- Mudanças de schema requerem migration transactions, não é um ORM com ALTER TABLE
- A `description` de uma Issue é gerenciada por Yjs — nunca edite via transação direta
