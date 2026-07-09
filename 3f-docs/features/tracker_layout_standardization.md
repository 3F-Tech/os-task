# Padronização do Layout do Tracker (ClickUp-Style)

Este documento registra o desenvolvimento da interface tabular modernizada para o rastreador de tarefas (Tracker) do Huly, detalhando os objetivos, as abordagens técnicas e as lições aprendidas durante os testes.

## Objetivo da Feature
Transformar a visualização de lista do Huly em uma interface profissional de alta densidade, similar ao ClickUp, com:
- Cabeçalho estático e alinhado para colunas de metadados.
- Larguras de colunas previsíveis e padronizadas (Cliente, Etapa, Tempo, etc.).
- Suporte a campos personalizados sem quebrar o alinhamento visual.

---

## Histórico de Tentativas e Testes Frustrados

### 1. Abordagem: Espaçadores Manuais (Hardcoded)
- **O que foi feito**: Inserção de `divs` com larguras fixas (`3.25rem`, etc.) no cabeçalho para tentar empurrar os títulos para cima das colunas.
- **Resultado**: **Fracassou**. O layout do Huly é elástico e muda conforme o zoom, tamanho da tela e densidade, fazendo com que os rótulos nunca estivessem 100% alinhados.

### 2. Abordagem: Mimetismo Estrutural (Ghost DOM)
- **O que foi feito**: Tentativa de copiar a estrutura exata de classes CSS das tarefas (`.antiList-cells__notifyCell`, etc.) para o cabeçalho.
- **Resultado**: **Fracassou**. A complexidade das "Compression Bars" do Huly (que agrupam datas na direita) criava lacunas dinâmicas que o cabeçalho "fantasma" não conseguia replicar.

### 3. Abordagem: Identificação por Atributos (`data-key`)
- **O que foi feito**: Modificação do componente base `FixedColumn.svelte` para adicionar um atributo `data-key`, permitindo travar as larguras via CSS `:global`.
- **Resultado**: **Fracassou**. O sistema de build/cache do Huly ignorou as mudanças no componente base, mantendo a versão original sem os atributos, o que impediu o CSS de "enxergar" as colunas.

### 4. Abordagem: CSS Grid Soberano
- **O que foi feito**: Forçar o layout de todas as linhas para `display: grid !important` com colunas matemáticas fixas.
- **Resultado**: **Fracassou (Crítico)**. O Huly depende profundamente de Flexbox para cálculos internos de redimensionamento e menus de contexto. Forçar Grid quebrou a funcionalidade de drag-and-drop e a renderização de elementos auxiliares.

---

## Abordagem Atual: Sincronização via `fixedWidthStore`
- **Técnica**: Utilizar o gerenciador de estado nativo do Huly (`fixedWidthStore`) para ditar as larguras programaticamente.
- **Vantagem**: Em vez de lutar contra o CSS, o cabeçalho escreve no "cérebro" do sistema os tamanhos desejados, e as tarefas (que consultam o mesmo store) se ajustam automaticamente de forma nativa.
- **Status**: Em teste (Build v5).

---

## Configurações de Grid Estabelecidas
| Campo | Largura Definida | Tipo de Layout |
| :--- | :--- | :--- |
| NOME | Flexível (mín 200px) | `flex-grow` |
| CLIENTE | 150px | `fixed` |
| ETAPA | 130px | `fixed` |
| TEMPO | 85px | `fixed` |
| ATUALIZADO | 115px | `fixed` |
| PRAZO | 115px | `fixed` |
| RESPONSÁVEL | 75px | `fixed` |
