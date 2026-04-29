# F09 — Campos de Cliente — Casos de Teste

## Pré-condições

- Space Types configurados com os campos `Nome do Cliente` (Texto) e `Etapa` (Dropdown)
- Valores do dropdown `Etapa`: Onboarding, Expansão, Retenção, Churned
- Usuário logado com papel de Member ou superior

---

## TC-09-01 — Criar issue com Nome do Cliente e Etapa preenchidos

**Passos:**
1. Abrir projeto Seed - Performance
2. Criar nova issue
3. Preencher `Nome do Cliente` = "Bomma"
4. Preencher `Etapa` = "Onboarding"
5. Preencher demais campos obrigatórios
6. Salvar

**Resultado esperado:**
- Issue criada com sucesso
- Painel da issue exibe `Nome do Cliente: Bomma` e `Etapa: Onboarding`
- Campos persistem após recarregar a página

---

## TC-09-02 — Criar issue sem Nome do Cliente (validação de obrigatoriedade)

**Passos:**
1. Criar nova issue
2. Deixar `Nome do Cliente` vazio
3. Tentar salvar

**Resultado esperado:**
- Sistema exibe erro: "Nome do Cliente é obrigatório"
- Issue não é criada

---

## TC-09-03 — Criar issue sem Etapa (validação de obrigatoriedade)

**Passos:**
1. Criar nova issue
2. Preencher `Nome do Cliente` = "Seed"
3. Deixar `Etapa` sem seleção
4. Tentar salvar

**Resultado esperado:**
- Sistema exibe erro: "Etapa é obrigatória"
- Issue não é criada

---

## TC-09-04 — Editar Etapa de uma issue existente

**Passos:**
1. Abrir issue com `Etapa = Onboarding`
2. Alterar `Etapa` para `Expansão`
3. Salvar

**Resultado esperado:**
- Etapa atualizada para `Expansão`
- Mudança registrada no histórico da issue (activity log)
- Alteração refletida em tempo real para outros usuários com a issue aberta

---

## TC-09-05 — Filtrar issues por Nome do Cliente

**Passos:**
1. Na list view do projeto, abrir filtros
2. Adicionar filtro: `Nome do Cliente = "Bomma"`
3. Aplicar

**Resultado esperado:**
- Somente issues com `Nome do Cliente = Bomma` são exibidas
- Issues de outros clientes ficam ocultas

---

## TC-09-06 — Filtrar issues por Etapa

**Passos:**
1. Na list view do projeto, abrir filtros
2. Adicionar filtro: `Etapa = Retenção`
3. Aplicar

**Resultado esperado:**
- Somente issues com `Etapa = Retenção` são exibidas
- Badge de `Retenção` (cor amarela) visível em cada issue

---

## TC-09-07 — Agrupar issues por Etapa

**Passos:**
1. Na list view, selecionar opção "Agrupar por: Etapa"

**Resultado esperado:**
- Issues agrupadas em seções: Onboarding | Expansão | Retenção | Churned
- Cada seção exibe o contador de issues

---

## TC-09-08 — Nome do Cliente exibido na list view (depende de F07)

**Pré-condição:** F07 implementado

**Passos:**
1. Abrir list view de qualquer projeto

**Resultado esperado:**
- Coluna `Nome do Cliente` visível inline na linha de cada issue
- Etapa exibida como badge colorido:
  - Onboarding = azul
  - Expansão = verde
  - Retenção = amarelo
  - Churned = vermelho

---

## TC-09-09 — Etapa preenchida automaticamente no onboarding (depende de F05)

**Pré-condição:** F05 (Onboarding Automático) implementado

**Passos:**
1. Cadastrar novo cliente "Impulse" via módulo de onboarding
2. Verificar issues geradas automaticamente

**Resultado esperado:**
- Todas as issues criadas pelo onboarding têm:
  - `Nome do Cliente = "Impulse"`
  - `Etapa = Onboarding`

---

## TC-09-10 — Campos visíveis em todos os Space Types

**Passos:**
1. Verificar nos seguintes projetos que `Nome do Cliente` e `Etapa` estão disponíveis:
   - Seed - Performance
   - Seed - Planejamento & Design
   - Seed - Audiovisual
   - Seed - Branding
   - Seed - Site LP
   - Bomma - Performance
   - Tecnologia - Chamados
   - Tecnologia - Automações

**Resultado esperado:**
- Campos presentes e funcionais em todos os Space Types listados

---

## Cenários de regressão

- [ ] Issues existentes sem esses campos não quebram a list view
- [ ] Busca global no Huly encontra issues pelo Nome do Cliente
- [ ] Exportação de issues inclui as colunas Nome do Cliente e Etapa
- [ ] Campos aparecem corretamente no painel da issue em modo mobile/responsivo
