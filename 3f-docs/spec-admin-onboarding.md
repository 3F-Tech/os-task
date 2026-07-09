# Spec: Scripts de Automação (Settings → Automation Scripts)

**Status:** Implementado (via UI, scripts hardcoded deprecados)
**Branch:** `feature/automation-scripts-ui`
**Prioridade:** Alta

---

## Objetivo

Tela em Settings que permite a admins e maintainers disparar o onboarding de um
novo cliente diretamente pela UI do 3F Tasks, sem rodar scripts CLI nem editar
código. A tela substitui os antigos `npm run onboard-seed`, `onboard-impulse` e
`onboard-bomma`.

Rodando dentro do frontend, **nenhum token ou URL é necessário** — o `getClient()`
do `@hcengineering/presentation` já está autenticado com a sessão do usuário e
resolve o workspace pelo contexto da plataforma.

---

## Unidades de Negócio suportadas

- **Seed**
- **Impulse**
- **Bomma** — duas modalidades: **com SM** (Social Media) e **sem SM**

O conjunto de tarefas criado por BU é **configurável pela própria UI** — não há
mais listas de projeto/template hardcoded em código.

---

## Onde fica

**Settings → Automation Scripts** ("Scripts de Automação"), visível apenas para
role `Maintainer` ou `Owner`.

Componente shipado: `plugins/tracker-resources/src/components/settings/AutomationScriptsPage.svelte`
(registrado em `tracker-resources`).

---

## Estado atual

- Onboarding é feito **via UI** (`AutomationScriptsPage.svelte`) — o admin escolhe
  cliente, BU e (para Bomma) a modalidade com/sem SM, e o conjunto de tarefas é
  criado sem edição de código.
- Os **scripts hardcoded por BU** em `automation/` (e as antigas tabelas de IDs
  de projeto/template) estão **DEPRECADOS**. Ficaram apenas como referência
  histórica; o fluxo normal de operação não os usa mais.

> Nota histórica: uma versão anterior desta spec indicava o caminho
> `plugins/tracker/src/components/setting/` e trazia tabelas grandes de IDs
> hardcoded de projeto/template por BU. Ambos foram substituídos — o caminho real
> é `tracker-resources/.../settings/` e a configuração migrou para a UI.
