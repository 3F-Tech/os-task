# 3F Hub — CLAUDE.md

## Visão Geral do Projeto

Fork customizado do Huly (https://github.com/hcengineering/platform)
para uso interno da 3F Venture. O objetivo é substituir o ClickUp como
plataforma de gestão, com customizações próprias desenvolvidas em cima
da base open source.

**Repositório upstream:** https://github.com/hcengineering/platform  
**Licença:** EPL-2.0 — uso interno, repositório privado permitido  
**Versão atual:** 0.7.413  
**URL local:** http://localhost:7000  

---

## Stack

- **Frontend:** Svelte 4.2.20 + TypeScript 5.9.3
- **Backend:** Node.js 20+ + TypeScript
- **Banco:** CockroachDB + Elasticsearch + MinIO
- **Mensageria:** Redpanda/Kafka + Redis
- **Videoconferência:** LiveKit
- **Monorepo:** Rush + pnpm (~481 pacotes)
- **Infra:** Docker Compose + Nginx

---

## Como rodar o projeto

```bash
# Instalar dependências (NUNCA use pnpm install diretamente)
rush install

# Build completo
rush build

# Subir via Docker
docker compose up -d

# Acessar
http://localhost:7000
```

---

## Estrutura do Workspace 3FVenture

A estrutura é organizada por projetos separados, um por setor/BU.
Não existe camada de Folder — cada setor é um projeto independente
com seu próprio Space Type, status e membros.

```
Workspace 3FVenture
│
├── BU: Seed
│   ├── Projeto: Seed - Performance
│   ├── Projeto: Seed - Planejamento Design
│   ├── Projeto: Seed - Audiovisual
│   ├── Projeto: Seed - Branding
│   └── Projeto: Seed - Site LP
│
├── BU: Bomma
│   ├── Projeto: Bomma - Performance
│   ├── Projeto: Bomma - Planejamento Design
│   ├── Projeto: Bomma - Audiovisual
│   ├── Projeto: Bomma - Branding
│   └── Projeto: Bomma - Site LP
│
├── BU: Impulse
│   ├── Projeto: Impulse - Performance
│   ├── Projeto: Impulse - Planejamento Design
│   ├── Projeto: Impulse - Audiovisual
│   ├── Projeto: Impulse - Branding
│   └── Projeto: Impulse - Site LP
│
└── BU: Tecnologia
    ├── Projeto: Tecnologia - Chamados
    └── Projeto: Tecnologia - Automações & Tecnologias
```

**Importante:** O caractere `|` não é permitido em nomes de Space Type.
Usar `-` como separador no lugar de `|`.

---

## Hierarquia de Dados

```
Workspace
  └─ Project (um por setor)
       └─ Issue (Tarefa)
            └─ Sub-Issue (Subtarefa)
```

Sub-issues são Issues com `attachedTo: Ref<Issue>` preenchido.
`parents[]` e `childInfo[]` são caches desnormalizados mantidos
por triggers — qualquer operação que mova issues precisa
reconverger esses campos.

---

## Terminologia do Projeto

| Huly original | 3F Hub |
|---|---|
| Issue | Tarefa |
| Sub-issue | Subtarefa |
| Project | Projeto (por setor) |
| Milestone | Sprint |
| Chunter | Chat 3F |
| Teamspace | Documentos |
| Component | Componente (agrupador por cliente dentro do projeto) |
| Space Type | Tipo de Projeto |

---

## Space Types e Status por Setor

Cada Space Type define o fluxo de status do setor.
**Configurar em:** Settings → Space Types → [Space Type] → Process States

Os seguintes Space Types devem ser criados (os setores Performance,
Planejamento & Design, Audiovisual, Branding e Site/LP são compartilhados
entre as BUs Seed, Bomma e Impulse — criar um Space Type por setor,
não por BU):

### Performance
```
A FAZER → EM ANDAMENTO → DEMANDA COM TERCEIRO →
AGUARDANDO CLIENTE → EM ATRASO → EM APROVAÇÃO INTERNA →
EM APROVAÇÃO EXTERNA → EM AJUSTE → FINALIZADO
```

### Planejamento & Design
```
A FAZER → REUNIÃO AGENDADA → AGUARDANDO MATERIAIS →
BRIEFING EM CONSTRUÇÃO → BRIEFING FINALIZADO →
EM DESENVOLVIMENTO → PRONTO PARA APROVAÇÃO → EM REVISÃO →
AJUSTES → EM APROVAÇÃO → PRONTO PARA AGENDAMENTO →
EM AGENDAMENTO → APROVADO
```

### Audiovisual
```
A FAZER → REUNIÃO AGENDADA → AGUARDANDO MATERIAIS →
BRIEFING EM CONSTRUÇÃO → BRIEFING FINALIZADO →
EM DESENVOLVIMENTO → PRONTO PARA APROVAÇÃO → EM REVISÃO →
AJUSTES → EM APROVAÇÃO → PRONTO PARA AGENDAMENTO →
EM AGENDAMENTO → APROVADO
```

### Branding
```
A FAZER → DEMANDA ABERTA → BRIEFING EM CONSTRUÇÃO →
PRONTO PARA CRIAÇÃO → EM CRIAÇÃO → EM APROVAÇÃO →
EM AJUSTES → EM FINALIZAÇÃO → APROVADO
```

### Site / LP
```
A FAZER → EM ANDAMENTO → DEMANDA COM TERCEIRO →
AGUARDANDO CLIENTE → EM ATRASO → EM APROVAÇÃO INTERNA →
EM APROVAÇÃO EXTERNA → EM AJUSTE → FINALIZADO
```

### Tecnologia - Chamados
```
ABERTA (OPERAÇÃO) → EM ANÁLISE (TECNOLOGIA) →
EM EXECUÇÃO (TECNOLOGIA) → EM VALIDAÇÃO (OPERAÇÃO) →
AJUSTE (TECNOLOGIA) → RESOLVIDO → FINALIZADO
```

### Tecnologia - Automações
```
BACKLOG → REFINAMENTO → SPRINT → EM DESENVOLVIMENTO →
EM TESTE / QA → AGUARDANDO VALIDAÇÃO → BLOQUEADO →
PENDENTE → CANCELADO → CONCLUÍDO → CICLO PDCA →
ENCERRADO / VALIDADE
```

---

## Campos Customizados das Issues

Configurar em: Settings → Space Types → [Space Type] →
Task Types → Padrão → Propriedades

### Campos presentes em todos os Space Types

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| Título | Texto | Sim | [Cliente] Descrição da tarefa |
| Status | Lista | Sim | Conforme fluxo do setor |
| Prioridade | Lista | Sim | Baixa / Média / Alta / Urgente |
| Responsável | Conta | Sim | Dispara notificação no Planner |
| Start date | Data | Sim | Preenchida automaticamente na criação (A DESENVOLVER) |
| Due date | Data | Sim | Nativo no Huly |
| Data de Finalização | Data | Sim | Preenchida automaticamente ao status Finalizado (A DESENVOLVER) |
| Estimation | Número | Sim | Lançado na criação pelo admin |
| Spent time | Número | Sim | Obrigatório antes de finalizar |
| Descrição | Texto rico | Sim | Links, briefing, pasta, etc |
| Nome do Cliente | Texto | Sim | Nome do cliente |
| Etapa | Dropdown | Sim | Onboarding / Expansão / Retenção / Churned |
| Ciclo PDCA Ativo | Boolean | Não | Ativa o módulo de recorrência |
| Frequência do Ciclo | Dropdown | Não | Semanal / Quinzenal / Mensal |

---

## Regras de Negócio das Issues

### Validação de conclusão (A DESENVOLVER)
Uma issue NÃO pode ser marcada como finalizada sem que:
1. Todas as sub-issues estejam concluídas manualmente
2. Tempo gasto (Spent time) tenha sido lançado
3. Estimativa de tempo (Estimation) esteja preenchida

Configurável por projeto — cada Space Type define quais campos
são obrigatórios para ir para o status Done.

Implementação: regra nativa no frontend + backend do Huly.
**Branch:** `feature/issue-completion-validation`

### Datas automáticas por trigger (A DESENVOLVER)
- **Start date:** preenchida automaticamente com o timestamp
  de criação da issue
- **Data de Finalização:** preenchida automaticamente quando
  o status muda para o estado Done do projeto

Implementação: trigger nativo no sistema de transações do Huly.
**Branch:** `feature/automatic-dates`

### Ciclo PDCA (A DESENVOLVER)
Quando o campo `Ciclo PDCA Ativo = true`:
- No início de cada ciclo (conforme Frequência configurada)
  o sistema cria automaticamente uma nova issue baseada
  no template da issue original
- A nova issue herda todos os campos padrão
- O responsável é notificado automaticamente
- Cada ciclo tem seu próprio histórico, spent time e subtarefas

Nomenclatura da issue gerada:
`[CLIENTE] Ciclo PDCA de Comunicação — Semana 18`

Implementação: módulo nativo dentro do Tracker, estendendo
o sistema de automações existente do Huly.
**Branch:** `feature/pdca-cycle`

---

## Sistema de BUs e Controle de Acesso (A DESENVOLVER)

### Conceito
Cada usuário pertence a uma ou mais BUs. O acesso aos projetos
e módulos é controlado pela BU do usuário — sem precisar
adicionar pessoa por pessoa manualmente em cada espaço.

### Cadastro do usuário
```
Nome: João Silva
Email: joao@seed.com.br
BU: [Seed]              ← campo novo, aceita múltiplas BUs
Papel: User
```

Usuários do time de Tecnologia que atendem todas as BUs:
```
Nome: Pedro Bartelle
BU: [Seed, Bomma, Impulse, Tecnologia]
```

### Configuração do projeto
```
Projeto: Seed - Performance
BUs com acesso: [Seed]   ← seleção de BUs permitidas
```

### Comportamento
- Usuário loga → sistema verifica BU(s) dele
- Mostra apenas projetos onde a BU dele está na lista de acesso
- Novo colaborador: define BU → herda todos os acessos automaticamente
- Novo projeto: define BUs com acesso → todos os usuários daquelas
  BUs enxergam automaticamente

Implementação: novo campo `bu` no modelo de usuário +
filtro de acesso no middleware de permissões.
**Branch:** `feature/bu-access-control`

---

## Módulo de Onboarding Automático de Cliente (A DESENVOLVER)

Quando um cliente assinar contrato no sistema de contratos (Hub 3F),
o módulo cria automaticamente as issues padrão de onboarding
nos projetos correspondentes.

### Configuração (Settings → Onboarding)
O admin define por BU quais issues serão criadas automaticamente:
- Qual projeto receberá a issue
- Qual template de issue usar
- Qual Space Type aplicar

### Issues criadas automaticamente para novo cliente Seed

**Seed - Performance:**
- `[CLIENTE] [ONBOARDING] Reunião de Onboarding e Briefing Inicial`
- `[CLIENTE] [ONBOARDING] Reunião de Apresentação de Estratégia`
- `[CLIENTE] [ONBOARDING] Setup de Contas`
- `[CLIENTE] Ciclo PDCA de Comunicação` (com Ciclo PDCA Ativo = true)
- `[CLIENTE] Ciclo PDCA de Mídia Paga` (com Ciclo PDCA Ativo = true)
- `[CLIENTE] Ciclo PDCA de Gestão do Cliente` (com Ciclo PDCA Ativo = true)
- `[CLIENTE] Relatório Mensal` (com Ciclo PDCA Ativo = true)

**Seed - Planejamento & Design:**
- `[CLIENTE] Anúncios`
- `[CLIENTE] [MÊS]`

**Seed - Audiovisual:**
- `[CLIENTE] Anúncios`
- `[CLIENTE] [MÊS]`

Implementação: módulo nativo novo integrado ao Tracker.
**Branch:** `feature/auto-client-onboarding`

---

## Visualização de Custom Fields na Lista (A DESENVOLVER)

Custom fields precisam aparecer inline na linha de cada issue
na list view, não apenas dentro do painel da issue.

Exemplo visual:
```
SEPF-1  [A FAZER]  [CLIENTE] Nome da tarefa  [ONBOARDING]  [Miguel]
```

Implementação: extensão dos componentes de list view do Tracker.
**Branch:** `feature/custom-fields-list-view`

---

## Home Dashboard (A DESENVOLVER)

Tela inicial personalizada mostrando:
- Tasks em atraso do usuário logado
- Tasks em atraso da equipe (para Maintainers e Owners)
- Widgets configuráveis por usuário

**Branch:** `feature/home-dashboard`

---

## Controle de Acesso por Módulo

### Visibilidade

| Módulo | Quem vê | Como configurar |
|---|---|---|
| Caixa de Entrada | Todos | Público |
| Planejador | Todos | Público |
| Escritório | Todos | Público |
| Conversas (Chat) | Todos | Público |
| Tracker (Projetos) | Conforme BU do usuário | Sistema de BUs (a desenvolver) |
| Documentos | Conforme BU do usuário | Make private por teamspace |
| Contatos | Somente gestão/admin | Make private |
| Recursos Humanos | Somente gestão/admin | Make private |
| Equipe | Somente líderes | Make private |
| Recrutamento | Somente gestão/admin | Make private |

### Papéis no workspace
- **Owner:** Pedro Bartelle + admin principal
- **Maintainer:** Líderes e coordenadores
- **User:** Restante do time

---

## Resumo de Features a Desenvolver

| Feature | Prioridade | Branch |
|---|---|---|
| Datas automáticas por trigger (start + finalização) | Alta | `feature/automatic-dates` |
| Validação de conclusão de issue | Alta | `feature/issue-completion-validation` |
| Ciclo PDCA nativo | Alta | `feature/pdca-cycle` |
| Módulo de onboarding automático de cliente | Alta | `feature/auto-client-onboarding` |
| Sistema de BUs e controle de acesso | Alta | `feature/bu-access-control` |
| Visualização de custom fields na lista | Média | `feature/custom-fields-list-view` |
| Home dashboard com tasks atrasadas | Média | `feature/home-dashboard` |

---

## Padrões de Código

### Regras obrigatórias
- Use sempre os decorators: @Model, @Prop, @Mixin, @UX, @Index
- IDs seguem o padrão: `pluginId:kind:name`
- Toda mutação é uma Tx — NUNCA edite o banco diretamente
- `description` de Issue é MarkupBlobRef gerenciado por Yjs —
  NUNCA edite via transação direta, use o collaborator service
- NUNCA use `pnpm install` diretamente — use `rush install`
- Sub-issues são Issues com `attachedTo` preenchido —
  NUNCA crie uma classe SubIssue separada
- Mudanças de schema requerem migration transactions —
  não é um ORM tradicional com ALTER TABLE

### Adicionando novos plugins
1. Definir IDs em `plugins/meu-plugin/src/index.ts`
2. Definir modelo em `models/model-meu-plugin/src/types.ts`
3. Criar `createModel` em `models/model-meu-plugin/src/index.ts`
4. Registrar em `models/all/src/index.ts`
5. Registrar pacotes no `rush.json`
6. Registrar no workbench se precisar de navegação

---

## Arquivos Críticos

| Arquivo | Por que é crítico |
|---|---|
| foundations/core/packages/core/src/classes.ts | Interfaces base de tudo |
| foundations/core/packages/platform/src/platform.ts | Geração de IDs |
| foundations/core/packages/model/src/dsl.ts | Builder + decorators |
| foundations/core/packages/core/src/tx.ts | Sistema de transações |
| models/all/src/index.ts | Registry master de plugins |
| foundations/communication/packages/server/src/middleware/permissions.ts | Permissões server-side |
| plugins/tracker/src/index.ts | Definição canônica do tracker |
| plugins/workbench/src/plugin.ts | Navegação/UI principal |

---

## Sincronização com Upstream

```bash
# Adicionar upstream (primeira vez)
git remote add upstream https://github.com/hcengineering/platform

# Buscar atualizações
git fetch upstream

# Merge na main
git merge upstream/main
```

**Frequência recomendada:** a cada 2 semanas  
**Regra:** features em arquivos isolados minimizam conflitos com upstream

---

## Integração MCP

**Pacote:** @firfi/huly-mcp@latest  
**Workspace:** 3FVenture  
**Ferramentas disponíveis:** criar/listar/atualizar issues,
milestones, documentos, labels, time tracking, busca global,
contatos, calendário, notificações, custom fields

---

## Padrão de Commits

```
feat(tracker): add PDCA cycle module
feat(permissions): add BU-based access control
fix(issues): block completion without spent time
refactor(dates): automate start and end date triggers
chore(deps): update rush lockfile
```
