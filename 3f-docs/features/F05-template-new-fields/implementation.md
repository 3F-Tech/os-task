# Implementation Plan: Sync Issue Template Fields with Task Fields (F05)

Este documento detalha o plano para sincronizar os campos disponíveis nos templates de tarefas (`IssueTemplate`) com os campos atuais das tarefas (`Issue`), garantindo que campos de Cliente (F09) e PDCA (F04) possam ser pré-preenchidos.

## Objetivos

1.  Adicionar campos de Cliente (`clientName`, `clientStage`) aos templates.
2.  Adicionar campos de PDCA (`pdcaCycleActive`, `pdcaCycleFrequency`, etc.) aos templates.
3.  Atualizar a interface de criação e edição de templates para suportar esses campos.
4.  Garantir que os campos sejam aplicados corretamente ao criar uma tarefa a partir de um template.

## Alterações Propostas

### 1. Tracker Plugin (Interfaces)

**Arquivo:** `plugins/tracker/src/index.ts`

-   **`IssueDraft`**: Adicionar campos de PDCA (já possui campos de cliente).
-   **`IssueTemplateData`**: Adicionar campos de Cliente e PDCA.

### 2. Tracker Model (Database Schema)

**Arquivo:** `models/tracker/src/types.ts`

-   **`TIssueTemplate`**: Adicionar propriedades `@Prop` para todos os novos campos:
    -   `clientName`
    -   `clientStage`
    -   `pdcaCycleActive`
    -   `pdcaCycleFrequency`
    -   `pdcaCycleResetStatus`
    -   `pdcaCycleDueDays`
    -   `pdcaCycleDuplicate`

### 3. Tracker Resources (UI Components)

**Arquivo:** `plugins/tracker-resources/src/components/templates/TemplateControlPanel.svelte`

-   Inserir `clientName` (AttributeBarEditor), `clientStage` (ClientStageSelector) e `PdcaCycleSection`.
-   Atualizar lista de `ignoreKeys` para evitar duplicidade na listagem genérica de atributos.

**Arquivo:** `plugins/tracker-resources/src/components/templates/CreateIssueTemplate.svelte`

-   Atualizar o objeto inicial e a função de criação para incluir os novos campos.
-   Adicionar os seletores correspondentes na interface de criação.

**Arquivo:** `plugins/tracker-resources/src/components/templates/IssueTemplateChildEditor.svelte`

-   Atualizar valores padrão e UI para que sub-tarefas dentro do template também suportem esses campos.

**Arquivo:** `plugins/tracker-resources/src/components/CreateIssue.svelte`

-   Validar o mapeamento dos campos quando o template é aplicado ao draft da tarefa.

## Plano de Verificação

### Validação Manual
1.  **Criação de Template**: Verificar se os campos de Cliente e PDCA aparecem na criação de um novo template.
2.  **Edição de Template**: Validar se os campos são salvos e exibidos corretamente no painel lateral.
3.  **Sub-tarefas**: Verificar se as sub-tarefas do template também permitem configurar esses campos.
4.  **Aplicação de Template**: Criar uma tarefa real a partir do template e confirmar se todos os campos (incluindo "Nome do Cliente", "Etapa" e configurações de PDCA) foram preenchidos corretamente.
