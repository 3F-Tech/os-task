# Parecer Técnico: Otimização e Padronização do Tracker

## 1. Objetivo
Padronizar a interface de visualização de tarefas do Huly Tracker, garantindo uma sequência de colunas fixa, eliminando a poluição visual causada por atributos de diferentes projetos e restaurando a funcionalidade de agrupamento e layout de "dois blocos".

---

## 2. Implementações Realizadas

### 2.1. Padronização de Colunas e Ordem Estática
Foi modificada a configuração central das colunas no arquivo `models/tracker/src/viewlets.ts`. A nova sequência obrigatória para todos os trackers é:
1.  **Prioridade** (Apenas Ícone)
2.  **Status** (Apenas Ícone)
3.  **Título**
4.  **[Espaçador Dinâmico]**
5.  **Nome do Cliente**
6.  **Etapa do Cliente** (Onboarding, etc.)
7.  **Tempo Relatado** (Spent Time)
8.  **Data de Início/Modificação**
9.  **Data de Vencimento** (Due Date)
10. **Responsável** (Assignee)

### 2.2. Layout de "Dois Blocos" (List View)
Para atender à preferência estética de blocos separados (esquerda e direita), realizamos as seguintes ações:
-   **Descriptor Revertido**: Alteramos o descritor de visualização de `Table` para `List`. Isso permite que o sistema utilize o alinhamento `fixed: 'right'` e o agrupamento nativo por status (ex: "Backlog 3").
-   **Coluna Grow**: Inserimos uma coluna invisível com a propriedade `grow: true` entre o *Título* e o *Nome do Cliente*. Essa coluna funciona como uma mola, empurrando os metadados da tarefa para a extremidade direita da tela.

### 2.3. Isolamento de Atributos Customizados (Filtro por Projeto)
Implementamos uma lógica de segurança e organização no componente `ViewSetting.svelte`.
-   **Funcionamento**: Ao abrir o menu "Customize View", o sistema agora filtra os atributos disponíveis.
-   **Regra**: Atributos marcados como `isCustom` só são exibidos se o seu `space` (ID do projeto) coincidir com o `space` do viewlet atual ou se forem atributos globais. Isso impede que campos criados especificamente para o "Projeto A" apareçam como lixo visual no "Projeto B".

### 2.4. Modo Estrito (Strict Mode)
Ativamos o `strict: true` nas configurações dos viewlets do Tracker. Isso garante que:
-   Apenas as colunas explicitamente definidas no código apareçam por padrão.
-   Campos novos adicionados pelo banco de dados ou por outros módulos não sejam injetados automaticamente sem autorização.

---

## 3. Correções de Bugs (Fixes)

### 3.1. TypeErrors nos Presenters
Ao tentar definir chaves explícitas para colunas complexas, os componentes `DueDatePresenter` e `TimePresenter` começaram a falhar (crash) por receberem apenas o valor da célula em vez do objeto da tarefa completo.
-   **Solução**: Revertemos o `key` para string vazia (`''`) no `issueConfig`, garantindo que o objeto `Issue` seja passado integralmente para os apresentadores.

### 3.2. Erro 'NaN years ago' nas Datas
O uso de um apresentador de timestamp genérico causou falha na interpretação das datas de início.
-   **Solução**: Restauramos o `ModificationDatePresenter` original, que lida corretamente com os formatos de data do Huly, exibindo-os de forma amigável (ex: "12 de mai.").

---

## 4. Guia de Uso da Visualização

1.  **Agrupamento**: As tarefas agora voltam a ser agrupadas por **Status** automaticamente, facilitando a visualização de fluxos como "Backlog", "In Progress" e "Done".
2.  **Adição de Campos**: Para visualizar um campo personalizado criado para o projeto, o usuário deve clicar no ícone de **Customize View** (engrenagem/três pontos) e marcar o campo desejado. Ele aparecerá no bloco da direita.
3.  **Visual Clean**: Prioridades e Status não ocupam mais espaço de texto no cabeçalho, utilizando apenas ícones intuitivos para uma interface mais premium.

---

**Responsável Técnica:** Antigravity AI
**Data:** 12 de Maio de 2026
**Local:** Workspace Huly-3F
