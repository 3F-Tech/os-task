# F04 — Ciclo PDCA

## Status
🔲 A desenvolver

**Branch:** `feature/pdca-cycle`  
**Prioridade:** Alta

---

## Objetivo

Permitir que uma issue seja marcada como recorrente no ciclo PDCA. Quando ativado, o sistema cria automaticamente uma nova issue baseada no template da issue original ao início de cada ciclo, com frequência configurável.

---

## Campos novos na Issue

| Campo | Tipo | Obrigatório | Valores |
|---|---|---|---|
| `Ciclo PDCA Ativo` | Boolean | Não | true / false |
| `Frequência do Ciclo` | Dropdown | Não (obrigatório se PDCA ativo) | Semanal / Quinzenal / Mensal |

Estes campos são custom fields configurados via **Settings → Space Types → [Space Type] → Task Types → Padrão → Propriedades**.

---

## Comportamento esperado

1. Usuário marca `Ciclo PDCA Ativo = true` na issue
2. Usuário define `Frequência do Ciclo` (ex: Semanal)
3. No início de cada novo ciclo (Domingo à meia-noite para Semanal, ou 1º dia do mês para Mensal):
   - O sistema cria uma nova issue no mesmo projeto
   - A issue herdada traz: título, responsável, componente, prioridade, estimativa, descrição
   - `Ciclo PDCA Ativo` e `Frequência do Ciclo` são mantidos na nova issue
   - Spent time e subtarefas NÃO são herdados (começam zerados)
   - O responsável recebe notificação de nova tarefa criada

### Nomenclatura da issue gerada

```
[CLIENTE] Ciclo PDCA de Comunicação — Semana 18
[CLIENTE] Ciclo PDCA de Mídia Paga — Quinzena 2 de Abril
[CLIENTE] Relatório Mensal — Maio 2026
```

Formato:
- **Semanal:** `{título original} — Semana {nº da semana ISO}`
- **Quinzenal:** `{título original} — Quinzena {1|2} de {mês}`
- **Mensal:** `{título original} — {mês} {ano}`

---

## Arquitetura planejada

### Abordagem recomendada: scheduler server-side

Não usar cron externo. Usar o sistema de **triggers + scheduled jobs** já existente no Huly.

```
plugins/tracker/src/index.ts
  └─ Adicionar string IDs: cicloPdcaAtivo, frequenciaCiclo, pdcaCycleScheduled

models/tracker/src/types.ts
  └─ Adicionar campos na interface Issue (ou como custom fields via TxCreateDoc)

server-plugins/tracker-resources/src/
  └─ Criar trigger OnPdcaCycleIssueCreate
  └─ Criar scheduler que verifica issues com PDCA ativo a cada ciclo
```

### Alternativa mais simples (recomendada para MVP)

Usar o sistema de **custom fields** existente do Huly (não modificar o modelo `Issue` diretamente):

1. Admin cria os campos `Ciclo PDCA Ativo` (Boolean) e `Frequência do Ciclo` (Dropdown) via Settings UI
2. Criar um server plugin que roda periodicamente, busca issues com `Ciclo PDCA Ativo = true`, e executa `TxCreateDoc` para criar a issue clonada

Benefício: não precisa de migration de schema se usar custom fields nativos.

---

## Regras de negócio

- Se a issue-pai for removida (status Done/Cancelled), o ciclo PDCA dela **não** cria novas issues
- O ciclo conta a partir da data de criação da issue original, não da última criação automática
- Cada issue gerada automaticamente tem `attachedTo = null` (não é sub-issue, é issue independente)
- Se `Frequência do Ciclo` não estiver preenchido e `Ciclo PDCA Ativo = true`, o sistema deve alertar (validação)

---

## Issues de template no onboarding (F05)

As seguintes issues são criadas no onboarding com PDCA ativo por padrão:

```
[CLIENTE] Ciclo PDCA de Comunicação   → Frequência: Semanal
[CLIENTE] Ciclo PDCA de Mídia Paga    → Frequência: Semanal
[CLIENTE] Ciclo PDCA de Gestão do Cliente → Frequência: Semanal
[CLIENTE] Relatório Mensal            → Frequência: Mensal
```

---

## Decisões de design

| Decisão | Escolha | Motivo |
|---|---|---|
| Custom fields vs campos no modelo | Custom fields (MVP) | Evita migration, permite configurar via UI sem código |
| Scheduler | Server plugin periódico | Integra com arquitetura existente do Huly |
| Clone profundo ou raso | Raso (sem subtarefas/spent time) | Cada ciclo começa do zero |
| Notificação | Nativa (sistema de notifications do Huly) | Sem dependência externa |

---

## Arquivos a criar/modificar

| Arquivo | Ação | Observação |
|---|---|---|
| `plugins/tracker/src/index.ts` | Modificar | Adicionar string IDs para campos PDCA |
| `server-plugins/tracker-resources/src/pdcaCycle.ts` | Criar | Lógica do scheduler e clonagem de issue |
| `server-plugins/tracker-resources/src/index.ts` | Modificar | Registrar o scheduler PDCA |
| `models/tracker/src/` | Modificar (opcional) | Se preferir adicionar campos no modelo em vez de custom fields |

---

## Referência

- CLAUDE.md → seção "Ciclo PDCA (A DESENVOLVER)"
- Exemplo de trigger existente: `server-plugins/tracker-resources/src/` (triggers de completion validation)
- Exemplo de custom field: Settings → Space Types → Task Types → Propriedades
