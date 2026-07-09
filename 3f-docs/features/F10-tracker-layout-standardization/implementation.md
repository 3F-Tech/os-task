# Implementação Técnica

## Histórico de Abordagens

### 1. Espaçadores Manuais e CSS Flexbox
Tentativa inicial de usar larguras fixas em `rem` para simular o alinhamento.
- **Resultado**: Falha por falta de precisão dinâmica no motor de renderização do Huly.

### 2. Sincronização Forçada via `fixedWidthStore`
Injeção de valores fixos arbitrários no store nativo do Huly (`list_item_clientName`, etc).
- **Resultado**: Conflitava com o motor nativo do `FixedColumn` que já monitora e sincroniza larguras de forma reativa. Resultava em sobreposição de texto ou espaços em branco desiguais.

## Solução Adotada: "Mimetismo Estrutural Dinâmico" (Clone Perfeito)

A solução definitiva abraçou o sistema nativo em vez de lutar contra ele. Recriamos a hierarquia exata do DOM das tarefas no cabeçalho e injetamos a configuração dinâmica do `viewlet` para que ambos (tarefa e cabeçalho) processem as mesmas regras.

### Como funciona:

1. **Estrutura CSS Compartilhada**:
   O `IssueColumnHeader.svelte` utiliza as exatas mesmas classes do `ListItem.svelte`:
   - `.listGrid .row` (herda padding base)
   - `.grow-container` (empurra os campos flex para a direita)
   - `.compression-bar` (aplica `justify-content: flex-end` e agrupa os custom fields)

2. **Injeção Dinâmica de Colunas**:
   Em vez de hardcodar as colunas (que quebrava quando o usuário alterava visibilidade ou ordem), o cabeçalho agora lê o mapa `itemModels` via `props` do `ListCategory.svelte`.
   - Lê dinamicamente os `AttributeModel`s associados à classe (`_class`) sendo exibida.
   - Itera criando `FixedColumn` idênticas às das linhas de dados.
   - Sincroniza dinamicamente as props `key` e `justify` (`fixed: 'left'`).

3. **Automação do `FixedColumn`**:
   O componente nativo `FixedColumn` (que envolve as células) comunica-se com o `fixedWidthStore` autonomamente. Ao darmos a ele a mesma `key` no cabeçalho e na linha, ele equaliza automaticamente a largura pela maior célula encontrada naquela coluna. Nenhuma largura fixa arbitrária é necessária!

### Configuração no Viewlet (`models/tracker/src/viewlets.ts`):
Para consistência visual, todas as propriedades `fixed` dos custom fields e datas foram alteradas de `'right'` para `'left'`. Isso uniformiza a leitura dos dados tubulares, emulando um visual mais semelhante ao ClickUp.

### 4. Padronização de Campos Personalizados e Persistência

Para garantir que campos personalizados (ex: "Videos") não quebrem o layout ou percam o cabeçalho ao serem ativados, implementamos uma padronização na camada de persistência:

- **Componente Central**: `plugins/view-resources/src/components/ViewletSetting.svelte` (Responsável pelo popup de engrenagem do Tracker).
- **Lógica de Injeção Automática**: Refatoramos o `processAttribute` e `getBaseConfig` para que qualquer atributo customizado (`isCustom: true` ou prefixo `custom*`) receba obrigatoriamente `displayProps: { compression: true, fixed: 'left' }`.
- **Garantia de Cabeçalho**: Ao forçar `compression: true`, garantimos que o campo seja renderizado dentro da `compression-bar` do `ListItem.svelte`. Como o `IssueColumnHeader.svelte` também espelha essa barra, o cabeçalho aparece automaticamente alinhado.
- **Limpeza de Dados Legados**: A função `save()` foi tornada "agressiva". Ao salvar uma nova configuração de visualização, ela detecta campos customizados e remove flags conflitantes (como `optional: true`), injetando a estrutura necessária para o alinhamento pixel-perfect.
- **Compatibilidade**: O método `setStatus` foi atualizado para reconhecer campos salvos em formatos antigos (apenas string) e mapeá-los para os novos objetos de configuração sem desativar a visualização do usuário.
