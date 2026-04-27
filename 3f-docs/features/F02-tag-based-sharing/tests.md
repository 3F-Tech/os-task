# Testes — F02: Compartilhamento por Tags

> **Ambiente:** http://localhost:7000  
> **Papel necessário:** Maintainer ou Owner para criar/configurar tags  
> **Logs dos triggers:** `docker logs -f dev-transactor_cockroach-1`  
> **Latência dos triggers:** até ~10 segundos após a ação

---

## TC-F02-01 — Criar uma User Tag

**Caminho:** Settings → User Tags → Botão "+"

**Passos:**
1. Acesse as configurações do workspace
2. Clique em **User Tags** na barra lateral
3. Clique no botão de nova tag
4. No modal, clique no **swatch de cor** e selecione uma cor
5. Preencha **Title** com `Seed`
6. Preencha **Description** com `Equipe da BU Seed` (opcional)
7. Clique em **Save**

**Resultado esperado:** Tag "Seed" aparece listada com a cor e título informados.

**Validação extra:** Tente salvar com o título vazio — o botão Save deve estar desabilitado.

---

## TC-F02-02 — Editar uma User Tag

**Passos:**
1. No painel **User Tags**, clique no ícone de edição (lápis) ao lado da tag "Seed"
2. Altere o título para `Seed BU`
3. Salve

**Resultado esperado:** Tag atualizada reflete o novo nome imediatamente na lista.

---

## TC-F02-03 — Excluir uma User Tag

**Passos:**
1. Crie uma tag de teste chamada `Para Excluir`
2. Clique no ícone de exclusão (lixeira) ao lado dela
3. Confirme no diálogo

**Resultado esperado:** Tag removida da lista. Não deve aparecer mais em nenhum seletor.

---

## TC-F02-04 — Atribuir tag a um colaborador

**Caminho:** HR → [Colaborador] → Edit → User Tags

**Passos:**
1. Navegue para o módulo **HR** ou **Contatos**
2. Abra o perfil de um colaborador que seja Employee
3. Clique em **Edit** (modo de edição)
4. Localize o campo **User Tags** no perfil
5. Clique no botão de adicionar tag (ícone +)
6. No seletor popup, escolha a tag `Seed`
7. Confirme / feche o seletor

**Resultado esperado:** Badge colorido da tag `Seed` aparece no perfil do colaborador.

---

## TC-F02-05 — Remover tag de um colaborador

**Pré-requisito:** TC-F02-04 executado.

**Passos:**
1. Abra o perfil do colaborador com a tag `Seed`
2. Entre no modo de edição
3. Clique no **×** ao lado do badge `Seed`

**Resultado esperado:** Badge removido do perfil.

---

## TC-F02-06 — Configurar acesso por tag em um projeto

**Caminho:** Tracker → [Projeto] → Settings → Tag Access (ou Members)

**Passos:**
1. Abra as configurações de um projeto no Tracker (ex: "Seed - Performance")
2. Localize a seção **Tag Access** (ou "Tags with access")
3. Adicione a tag `Seed`
4. Aguarde alguns segundos

**Resultado esperado:**
- Tag `Seed` aparece listada como tendo acesso ao projeto
- O trigger `OnSpaceTagAccessChanged` dispara e adiciona todos os colaboradores com a tag `Seed` como membros do projeto

---

## TC-F02-07 — Adição automática ao projeto ao receber tag

**Pré-requisito:** TC-F02-06 — tag `Seed` com acesso ao projeto configurado.

**Passos:**
1. Use um colaborador que **não** possui a tag `Seed`
2. Verifique que esse colaborador **não está** na lista de membros do projeto
3. Atribua a tag `Seed` ao colaborador (TC-F02-04)
4. Aguarde até 10 segundos
5. Verifique a lista de membros do projeto

**Resultado esperado:** O colaborador aparece automaticamente na lista de membros do projeto.

**Como monitorar:** `docker logs -f dev-transactor_cockroach-1 | grep "OnTagAssignmentChanged"`

---

## TC-F02-08 — Remoção automática do projeto ao perder tag

**Pré-requisito:** TC-F02-07 — colaborador com tag `Seed` é membro via tag.

**Passos:**
1. Remova a tag `Seed` do colaborador (TC-F02-05)
2. Aguarde até 10 segundos
3. Verifique a lista de membros do projeto

**Resultado esperado:** O colaborador foi removido automaticamente dos membros do projeto.

> **Atenção (Bug 3):** Se o colaborador foi adicionado **manualmente** ao projeto além do acesso via tag, remover a tag também remove o acesso manual. Este é um comportamento conhecido — ver `context.md`.

---

## TC-F02-09 — Múltiplas tags no mesmo projeto

**Passos:**
1. Configure duas tags com acesso ao mesmo projeto: `Seed` e `Tecnologia`
2. Atribua tag `Seed` ao colaborador A
3. Atribua tag `Tecnologia` ao colaborador B
4. Atribua **ambas** as tags ao colaborador C
5. Aguarde os triggers

**Resultado esperado:** Colaboradores A, B e C são todos membros do projeto.

6. Remova a tag `Seed` do colaborador C (que ainda tem `Tecnologia`)
7. Aguarde os triggers

**Resultado esperado:** Colaborador C **permanece** membro (acesso via `Tecnologia` ainda ativo).

---

## TC-F02-10 — Remoção de acesso de tag do projeto

**Pré-requisito:** Tag `Seed` configurada com acesso ao projeto, pelo menos um membro via tag.

**Passos:**
1. Vá nas configurações do projeto → seção Tag Access
2. Clique no **×** ao lado da tag `Seed`
3. Aguarde até 10 segundos
4. Verifique a lista de membros

**Resultado esperado:** Todos os colaboradores que eram membros **apenas** via tag `Seed` foram removidos do projeto automaticamente.

---

## TC-F02-11 — Colaborador sem mixin Employee não exibe campo de tags

**Passos:**
1. Abra o perfil de um **Contato** que não seja Employee (ex: contato externo)
2. Entre no modo de edição

**Resultado esperado:** Campo **User Tags** não aparece (componente `UserTagsEditor` só é renderizado se o perfil tem mixin `Employee`).
