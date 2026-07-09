# Testes das Features Desenvolvidas — 3F Tasks

> **Ambiente:** http://localhost:8087  
> **Usuário de teste:** pedrobartelle@3fventure.com.br (Owner)  
> **Pré-requisito:** Docker rodando (`docker compose -f dev/docker-compose.yaml up -d`)

---

## F01 — Validação de Conclusão de Issue

### O que faz
Impede que uma issue seja marcada como concluída sem que critérios configuráveis sejam atendidos. As regras são configuradas por projeto e se aplicam separadamente para Issues e Sub-Issues.

### Onde encontrar no código
| Arquivo | Responsabilidade |
|---|---|
| `plugins/tracker/src/index.ts` | Interface `IssueCompletionConfig`, `CompletionRule` |
| `plugins/tracker-resources/src/components/issues/StatusEditor.svelte` (L.73–136) | Validação antes de mudar status |
| `plugins/tracker-resources/src/components/issues/CompletionBlockedNotification.svelte` | Popup de bloqueio |
| `plugins/tracker-resources/src/components/EditCompletionRules.svelte` | Tela de configuração das regras |
| `plugins/tracker-resources/src/components/SettingsCompletionRules.svelte` | Container da tela de settings |
| `plugins/tracker-assets/lang/en.json` | Strings de UI |

---

### TC-F01-01 — Configurar regras de conclusão em um projeto

**Caminho:** Settings → Tracker → [Projeto] → Completion Rules

**Passos:**
1. Acesse as configurações do workspace (ícone de engrenagem, canto inferior esquerdo)
2. Navegue até **Tracker** na barra lateral
3. Selecione um projeto existente (ex: "Tecnologia - Chamados")
4. Clique na aba **Completion Rules**
5. Você verá duas seções: **Issue Completion Rules** e **Subtask Completion Rules**
6. Ative a regra **Spent time must be logged**
7. Ative a regra **Estimation must be filled**
8. Feche as configurações

**Resultado esperado:** Toggles salvam automaticamente. Ao reabrir a tela, as regras ativadas continuam marcadas.

---

### TC-F01-02 — Bloqueio ao tentar marcar issue sem cumprir regras

**Pré-requisito:** TC-F01-01 executado com as regras `Spent time` e `Estimation` ativas.

**Passos:**
1. Abra o projeto configurado no TC-F01-01
2. Crie uma nova issue sem preencher `Estimation` e sem lançar `Spent time`
3. Tente mudar o status da issue para o status de conclusão do projeto (ex: "FINALIZADO", "RESOLVIDO")

**Resultado esperado:**
- O status **não muda**
- Um popup é exibido com o título **"Cannot mark as done"**
- O popup lista as regras não atendidas:
  - "Spent time must be logged"
  - "Estimation must be filled"
- Dois botões aparecem: **"Configure completion rules"** e **"Close"**

---

### TC-F01-03 — Marcar issue concluída com todas as regras atendidas

**Pré-requisito:** TC-F01-01 executado.

**Passos:**
1. Abra uma issue no projeto configurado
2. Preencha o campo **Estimation** (ex: 2h)
3. Lance tempo no campo **Spent time** (ex: 1h)
4. Tente mudar o status para o status de conclusão

**Resultado esperado:** O status muda normalmente, sem popup de bloqueio.

---

### TC-F01-04 — Regra "All subtasks must be completed"

**Passos:**
1. Ative a regra **All subtasks must be completed** nas configurações do projeto
2. Crie uma issue com pelo menos uma sub-issue
3. Deixe a sub-issue em um status não-concluído
4. Tente marcar a issue pai como concluída

**Resultado esperado:** Popup de bloqueio exibe "All subtasks must be completed".

5. Marque todas as sub-issues como concluídas
6. Tente marcar a issue pai novamente

**Resultado esperado:** Status muda sem bloqueio.

---

### TC-F01-05 — Regras independentes para Sub-Issues

**Passos:**
1. Nas configurações do projeto, ative uma regra apenas na seção **Subtask Completion Rules** (ex: `Spent time`)
2. Deixe a seção **Issue Completion Rules** sem nenhuma regra ativa
3. Tente marcar uma **issue pai** (sem spent time) como concluída

**Resultado esperado:** Issue pai conclui normalmente (sem regras para issues).

4. Tente marcar uma **sub-issue** (sem spent time) como concluída

**Resultado esperado:** Popup de bloqueio exibe a regra violada.

---

### TC-F01-06 — Botão "Configure completion rules" no popup

**Passos:**
1. Reproduza o bloqueio do TC-F01-02
2. No popup, clique em **"Configure completion rules"**

**Resultado esperado:** Navegação para a tela de configuração de regras do projeto correspondente.

---

## F02 — Compartilhamento por Tags (Tag-Based Sharing)

### O que faz
Permite criar etiquetas (tags) e atribuí-las a colaboradores. Espaços/projetos podem ser configurados para dar acesso automático a todos os membros que possuem uma determinada tag. Quando a tag é atribuída ou removida, a filiação no espaço é atualizada automaticamente por um trigger no servidor.

### Onde encontrar no código
| Arquivo | Responsabilidade |
|---|---|
| `plugins/tag-sharing/src/index.ts` | Interfaces `UserTag`, `SpaceTagAccess`, `TaggedProfile` |
| `models/model-tag-sharing/src/index.ts` | Model classes + registro de settings |
| `plugins/tag-sharing-resources/src/components/UserTagsPanel.svelte` | Painel admin de tags |
| `plugins/tag-sharing-resources/src/components/EditUserTag.svelte` | Modal criar/editar tag |
| `plugins/tag-sharing-resources/src/components/UserTagsEditor.svelte` | Editor de tags no perfil do colaborador |
| `plugins/tag-sharing-resources/src/components/SpaceTagAccessEditor.svelte` | Configuração de acesso por tag em espaços |
| `plugins/tag-sharing-resources/src/components/UserTagSelector.svelte` | Popup seletor de tags |
| `plugins/contact-resources/src/components/EditPerson.svelte` | Integração do editor de tags no perfil |
| `server-plugins/tag-sharing-resources/src/index.ts` (L.71–153) | Trigger `OnTagAssignmentChanged` |
| `server-plugins/tag-sharing-resources/src/index.ts` (L.159–215) | Trigger `OnSpaceTagAccessChanged` |
| `models/server-tag-sharing/src/index.ts` | Registro dos triggers no modelo |

---

### TC-F02-01 — Criar uma User Tag

**Caminho:** Settings → User Tags → New Tag

**Passos:**
1. Acesse as configurações do workspace
2. Clique em **User Tags** na barra lateral (requer papel Maintainer ou Owner)
3. Clique no botão **New Tag** (ou ícone +)
4. No modal, selecione uma **cor** clicando no swatch
5. Preencha o campo **Title** (ex: "Seed")
6. Preencha o campo **Description** (ex: "Equipe da BU Seed") — opcional
7. Clique em **Save** (ou confirme)

**Resultado esperado:** A tag aparece listada no painel com a cor e título informados. O botão Save só fica ativo quando o título não está vazio.

---

### TC-F02-02 — Editar uma User Tag existente

**Passos:**
1. No painel **User Tags**, clique no ícone de edição (lápis) ao lado de uma tag existente
2. Altere o título ou descrição
3. Salve

**Resultado esperado:** Tag atualizada reflete as novas informações imediatamente na lista.

---

### TC-F02-03 — Excluir uma User Tag

**Passos:**
1. No painel **User Tags**, clique no ícone de exclusão (lixeira) ao lado de uma tag
2. Confirme a exclusão no diálogo de confirmação

**Resultado esperado:** Tag removida da lista. Tags associadas a colaboradores ou espaços devem ser desassociadas automaticamente.

---

### TC-F02-04 — Atribuir tag a um colaborador

**Caminho:** HR → Membros → [Colaborador] → Editar perfil

**Passos:**
1. Navegue para o módulo **HR** (Recursos Humanos) ou **Contatos**
2. Abra o perfil de um colaborador (employee)
3. Clique em **Edit** para entrar no modo de edição
4. Localize o campo **User Tags** no perfil
5. Clique no botão de adicionar tag (ícone + ou "Add tag")
6. No seletor, escolha a tag criada no TC-F02-01 (ex: "Seed")
7. Salve o perfil

**Resultado esperado:** A tag aparece como badge colorido no perfil do colaborador.

---

### TC-F02-05 — Remover tag de um colaborador

**Passos:**
1. Abra o perfil de um colaborador que possui tags (TC-F02-04)
2. Entre no modo de edição
3. Clique no **×** ao lado do badge da tag que deseja remover
4. Salve

**Resultado esperado:** Tag removida do perfil. Se havia acesso a espaços via essa tag, o trigger remove a filiação automaticamente (verificar TC-F02-08).

---

### TC-F02-06 — Configurar acesso por tag em um espaço/projeto

**Caminho:** Tracker → [Projeto] → Settings → Members (ou Tag Access)

**Passos:**
1. Abra as configurações de um projeto no Tracker
2. Localize a seção **Tag Access** (ou "Tags with access")
3. Clique para adicionar uma tag (ex: "Seed")
4. Confirme

**Resultado esperado:** A tag aparece listada como tendo acesso ao espaço. O trigger `OnSpaceTagAccessChanged` deve disparar e adicionar todos os colaboradores com essa tag ao espaço.

---

### TC-F02-07 — Verificar adição automática ao espaço ao atribuir tag

**Pré-requisito:** TC-F02-06 executado — tag "Seed" com acesso ao projeto configurado.

**Passos:**
1. Crie um novo colaborador (ou use um existente) **sem** a tag "Seed"
2. Confirme que esse colaborador **não é membro** do projeto
3. Atribua a tag "Seed" ao colaborador (TC-F02-04)
4. Aguarde alguns segundos para o trigger processar
5. Verifique a lista de membros do projeto

**Resultado esperado:** O colaborador foi adicionado automaticamente à lista de membros do projeto após receber a tag.

---

### TC-F02-08 — Verificar remoção automática do espaço ao remover tag

**Pré-requisito:** TC-F02-07 — colaborador com tag "Seed" é membro do projeto via tag.

**Passos:**
1. Remova a tag "Seed" do colaborador (TC-F02-05)
2. Aguarde alguns segundos para o trigger processar
3. Verifique a lista de membros do projeto

**Resultado esperado:** O colaborador foi removido automaticamente dos membros do projeto.

> **Nota:** Se o colaborador foi adicionado manualmente ao projeto *além* do acesso via tag, a remoção da tag também remove o acesso manual (limitação conhecida — Bug 3 no código).

---

### TC-F02-09 — Múltiplas tags no mesmo espaço

**Passos:**
1. Configure duas tags com acesso ao mesmo projeto (ex: "Seed" e "Tecnologia")
2. Atribua tag "Seed" ao colaborador A e tag "Tecnologia" ao colaborador B
3. Atribua **ambas** as tags ao colaborador C

**Resultado esperado:** Colaboradores A, B e C são todos membros do projeto.

4. Remova a tag "Seed" do colaborador C (que ainda tem "Tecnologia")

**Resultado esperado:** Colaborador C **permanece** membro do projeto (acesso via tag "Tecnologia" ainda ativo).

---

### TC-F02-10 — Remover acesso de tag de um espaço

**Pré-requisito:** Tag "Seed" configurada com acesso ao projeto.

**Passos:**
1. Vá nas configurações do projeto → seção Tag Access
2. Clique no **×** ao lado da tag "Seed" para remover o acesso
3. Aguarde o trigger processar
4. Verifique a lista de membros

**Resultado esperado:** Todos os colaboradores que eram membros **apenas** via tag "Seed" foram removidos do projeto.

---

## Notas de Ambiente

- Os triggers `OnTagAssignmentChanged` e `OnSpaceTagAccessChanged` rodam no container `dev-transactor_cockroach-1`
- Para ver os logs dos triggers em tempo real: `docker logs -f dev-transactor_cockroach-1`
- Se uma mudança não refletir, aguarde até 10 segundos (processamento assíncrono)
- O papel mínimo para gerenciar User Tags é **Maintainer**; para configurar acesso em espaços, **Owner** do espaço
