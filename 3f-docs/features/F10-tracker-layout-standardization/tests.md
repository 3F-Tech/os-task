# Protocolo de Testes

## Testes de Alinhamento Visual
- [ ] **Sincronização de Cabeçalho**: Verificar se os rótulos (CLIENTE, ETAPA, etc.) estão exatamente sobre os dados correspondentes.
- [ ] **Sincronização Dinâmica**: Ocultar, reordenar ou adicionar uma coluna usando o menu de "View Options" do Huly e verificar se o cabeçalho se adapta automaticamente, ocultando ou reordenando o título correspondente.
- [ ] **Redimensionamento de Janela**: Garantir que, ao encolher a janela, o cabeçalho e as tarefas mantenham o alinhamento de forma elástica graças ao comportamento da `compression-bar`.
- [ ] **Zoom do Navegador**: Testar em 80%, 100% e 120% de zoom.

## Testes de Regressão
- [ ] **Drag and Drop**: Verificar se a função de mover tarefas (reordenação) continua funcionando.
- [ ] **Campos Personalizados Variáveis**: Mudar para diferentes visualizações de lista (ex: "Todos os Issues", "Meus Issues") que possuem conjuntos diferentes de campos, e garantir que o cabeçalho reflete os campos corretos daquela view específica.

## Histórico de Bugs Resolvidos
- **B1**: Conflito de larguras estáticas com o motor nativo (Resolvido pela remoção de injeções hardcoded no `fixedWidthStore`).
- **B2**: Títulos do cabeçalho em ordem errada comparada aos dados das células (Resolvido tornando o cabeçalho 100% dinâmico, extraindo os campos do `itemModels` associado à classe listada).
- **B3**: Alinhamentos desalinhados (textos das tarefas à direita, rótulos à esquerda). (Resolvido uniformizando a configuração `fixed: 'left'` na definição global dos viewlets e do cabeçalho).
