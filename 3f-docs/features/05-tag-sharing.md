# Feature: Compartilhamento por Tag (Tag-based Sharing)

**Branch:** `feature/tag-based-sharing`  
**Prioridade:** Alta  
**Status:** Implementado (aguardando `rush install` + build + testes)

---

## Visão Geral

Sistema genérico de tags para usuários que permite conceder acesso a Spaces (projetos, drives,
canais) em lote — em vez de adicionar pessoa por pessoa manualmente.

**Exemplo de uso:**
- Criar tag `squad-seed` → atribuir a 5 usuários
- Ao criar/editar um Space, marcar que `squad-seed` tem acesso
- Todos os 5 usuários ganham acesso automaticamente
- Se um usuário sair do squad: remover tag → perde acesso imediatamente

**Diferença do sistema de BUs (feature/bu-access-control):**
- BU é um campo estrutural no modelo de usuário (campo `bu`)
- Tag é um mecanismo genérico de agrupamento — pode ser setor, squad, nível, cliente ou qualquer outra categorização
- Ambos podem coexistir; Tags são a camada mais flexível

---

## Estado Atual do Código

### O que já existe
- `tags` plugin com `TagElement`, `TagReference`, `TagCategory` — mas voltado a marcar *Issues*, não usuários
- `Space.members: AccountUuid[]` — lista direta de membros por UUID de conta
- `SpaceType` + `Role` + `Permission` — sistema de papéis por space type
- `RolesAssignment` mixin no Space: `Record<Ref<Role>, AccountUuid[]>`
- Middleware de permissões em `foundations/communication/packages/server/src/middleware/permissions.ts`
- `setting` plugin com `SettingsCategory` e `WorkspaceSettingCategory` para painéis admin
- `AccountRole` enum: ReadOnlyGuest, Guest, User, Maintainer, Owner, Admin
- `SpaceMembers.svelte` e `SpaceMembersEditor.svelte` em `contact-resources`
- `Members.svelte` no `setting-resources` para gestão de membros do workspace

### O que NÃO existe
- Nenhuma entidade de "tag de usuário" — o sistema de tags atual é para Issues
- Nenhum mecanismo de propagar tags de usuário para membros de Space
- Nenhum campo de tags no perfil/conta de usuário
- Nenhuma UI para gerenciar tags de usuário no painel admin
- Nenhum hook no `Space.members` que resolva tags → AccountUuids

---

## Modelo de Dados

### Visão geral do schema

```
UserTag (novo Doc)
  ├─ title: string           — Nome da tag (ex: "squad-seed", "lead-designer")
  ├─ description?: string    — Descrição opcional
  ├─ color: number           — Cor para UI (0-10)
  └─ icon?: Asset            — Ícone opcional

AccountTagAssignment (novo AttachedDoc → attachedTo: AccountUuid no social profile)
  ├─ tag: Ref<UserTag>       — Qual tag
  └─ assignedBy: AccountUuid — Quem atribuiu (para auditoria)

SpaceTagAccess (novo AttachedDoc → attachedTo: Space)
  ├─ tag: Ref<UserTag>       — Qual tag tem acesso
  └─ role?: Ref<Role>        — Papel opcional (se SpaceType usa roles)
```

### Onde persistir
- `UserTag` → novo domínio `DOMAIN_TAG_SHARING` (ou reusar `DOMAIN_TAGS` com targetClass discriminador)
- `AccountTagAssignment` → mesmo domínio, attachedTo = `PersonId` (via `contact.class.Member` pattern)
- `SpaceTagAccess` → mesmo domínio, attachedTo = `Space._id`

### Alternativa simplificada (recomendada para V1)

Ao invés de `AccountTagAssignment` como AttachedDoc separado, adicionar um campo
`tags: Ref<UserTag>[]` diretamente no `Account` via mixin em `contact.mixin.Employee`
(similar ao que HR faz com `hr.mixin.Staff`). Mais simples de consultar no middleware.

```typescript
// Mixin sobre Employee (já é o profile de conta no workspace)
interface TaggedProfile {
  userTags: Ref<UserTag>[]
}
```

---

## Fluxo Técnico de Verificação de Permissão

### Fluxo atual (simplificado)
```
Request → PermissionsMiddleware → Space.members.includes(account.uuid) → allow/deny
```

### Fluxo com Tag-based Sharing
```
Request
  → PermissionsMiddleware
      → Space.members.includes(account.uuid)  // check direto (mantém)
          → true → allow
      → SpaceTagAccess[space].some(sta => taggedProfile.userTags.includes(sta.tag))
          → true → allow (membro via tag)
      → deny
```

### Implementação no middleware

O middleware precisa de um **resolver** que, dado um `AccountUuid`, retorna o conjunto
expandido de `Space._id` acessíveis via tags. Esse resolver deve ser **cacheado por sessão**
para não re-consultar a cada request.

```
TagResolver.getAccessibleSpaces(accountUuid: AccountUuid): Set<SpaceId>
  1. Busca profile do account → pega userTags[]
  2. Busca todos SpaceTagAccess onde tag ∈ userTags
  3. Retorna set de Space._id
```

Cache invalidation: quando `AccountTagAssignment` ou `SpaceTagAccess` mudar → invalida cache.

### Impacto no `Space.members`

**Opção A — Denormalized (recomendada para V1):**
- Quando uma tag é atribuída a um usuário OU uma tag é adicionada a um Space:
  - Trigger resolve todos os AccountUuids da tag
  - Insere-os diretamente em `Space.members`
- Quando tag é removida: trigger remove do `Space.members`
- **Vantagem:** zero mudança no middleware e nas queries existentes
- **Desvantagem:** `Space.members` cresce; remoção precisa checar se membro foi adicionado via outra rota

**Opção B — Virtual (para V2):**
- Novo campo `tagMembers: { tag: Ref<UserTag>, members: AccountUuid[] }[]` no Space
- Middleware une `members` + `tagMembers.flatMap(t => t.members)` para checar acesso
- Mais limpo semanticamente, mais invasivo para o middleware

**Decisão para V1:** Opção A (denormalized via trigger) — menor risco de quebrar permissões existentes.

---

## Arquivos Existentes a Modificar

| Arquivo | O que muda |
|---|---|
| `plugins/contact/src/index.ts` | Adicionar interface `TaggedProfile` mixin |
| `models/contact/src/index.ts` | Adicionar `TTaggedProfile` com `@Prop ArrOf(TypeRef(UserTag))` |
| `plugins/setting/src/index.ts` | Adicionar refs: `ids.TagSharing`, `component.TagSharingPanel`, `component.EditUserTag`, `string.UserTags`, `icon.UserTags` |
| `plugins/setting-resources/src/index.ts` | Registrar novos componentes no Resources export |
| `plugins/setting-resources/src/plugin.ts` | Adicionar `mergeIds` para novos strings/componentes |
| `models/setting/src/index.ts` | Adicionar `WorkspaceSettingCategory` doc para "User Tags" |
| `models/all/src/index.ts` | Registrar novo plugin `tag-sharing` |
| `rush.json` | Registrar novos pacotes `plugins/tag-sharing` e `models/model-tag-sharing` |
| `plugins/contact-resources/src/components/EditMember.svelte` | Adicionar exibição de tags do usuário |
| `plugins/contact-resources/src/components/SpaceMembersEditor.svelte` | Adicionar seletor de tags junto a membros diretos |

---

## Novos Arquivos a Criar

### Plugin principal

```
plugins/tag-sharing/
  src/
    index.ts          — IDs canônicos do plugin (tagSharingId, classes, strings, icons)
  package.json
```

### Model

```
models/model-tag-sharing/
  src/
    index.ts          — createModel() com TUserTag, TAccountTagAssignment, TSpaceTagAccess, TTaggedProfile
    types.ts          — interfaces TypeScript (UserTag, AccountTagAssignment, SpaceTagAccess, TaggedProfile)
    migration.ts      — MigrationClient para DOMAIN_TAG_SHARING
  package.json
```

### Server plugin (trigger)

```
server-plugins/tag-sharing/
  src/
    index.ts          — Trigger: onTagAssigned, onSpaceTagAccessChanged → denormaliza em Space.members
  package.json
```

### UI Resources

```
plugins/tag-sharing-resources/
  src/
    index.ts          — Resources export
    plugin.ts         — mergeIds com componentes
    components/
      UserTagsPanel.svelte      — Painel admin: listar/criar/editar/deletar tags
      EditUserTag.svelte        — Modal CRUD de tag
      UserTagSelector.svelte    — Popup para selecionar tags (reutilizado em várias telas)
      UserTagPresenter.svelte   — Badge colorido de tag (para lista de usuários)
      SpaceTagAccessEditor.svelte — Seletor de tags no painel do Space
      UserTagsEditor.svelte     — Editor de tags inline no perfil do usuário
  package.json
```

---

## Componentes Svelte: Detalhamento

### `UserTagsPanel.svelte` (Admin → Workspace Settings → Tags de Usuário)
- Lista todas `UserTag` do workspace com cor e contagem de membros
- Botão "Nova Tag" → abre `EditUserTag.svelte`
- Click em tag → expande lista de usuários com aquela tag
- Cada tag: botão editar, botão deletar (com confirmação + aviso de impacto)
- Requer `AccountRole.Maintainer` ou superior

### `EditUserTag.svelte` (Modal)
- Campos: Nome (obrigatório), Descrição (opcional), Cor (color picker com 10 opções)
- `client.createDoc(tagSharing.class.UserTag, ...)` ou `client.update(...)`
- Validação: nome não vazio, nome único no workspace

### `UserTagSelector.svelte` (Popup reutilizável)
- Lista tags com filtro por nome
- Multi-select com checkboxes
- Usado em: `UserTagsEditor`, `SpaceTagAccessEditor`

### `UserTagPresenter.svelte`
- Badge `<span>` com cor de background e texto da tag
- Prop: `tag: Ref<UserTag>`
- Usa `createQuery()` para buscar `UserTag` pelo ref

### `SpaceTagAccessEditor.svelte`
- Integra no painel de edição/criação de Space (ao lado de `SpaceMembersEditor`)
- Seção "Acesso por Tag" com `UserTagSelector` e lista de tags atuais
- Ao adicionar tag: cria `SpaceTagAccess` AttachedDoc + trigger denormaliza membros
- Ao remover tag: deleta `SpaceTagAccess` + trigger remove membros que não têm acesso direto

### `UserTagsEditor.svelte`
- Inline no perfil do usuário (Settings → Edit Profile)
- Tags atribuídas ao usuário logado (read-only para User, editável para Maintainer/Owner)
- Também presente em Settings → Members → row de cada membro

### Modificação em `SpaceMembersEditor.svelte`
- Adicionar seção "Tags com Acesso" abaixo da lista de membros diretos
- Renderizar com `SpaceTagAccessEditor`

### Modificação em `EditMember.svelte` (Settings → Members)
- Adicionar linha "Tags:" com `UserTagsEditor` inline

---

## Passo a Passo de Implementação (Ordenado)

### Fase 1 — Modelo e Plugin Base (sem UI, sem server)

**1.1** Criar `plugins/tag-sharing/src/index.ts`
- Definir `tagSharingId = 'tag-sharing' as Plugin`
- Declarar IDs: `class.UserTag`, `class.AccountTagAssignment`, `class.SpaceTagAccess`, `mixin.TaggedProfile`
- Declarar strings: `UserTag`, `UserTags`, `AddTag`, `RemoveTag`, `TagColor`, `TagMembers`
- Declarar ícones: `UserTag`

**1.2** Criar `models/model-tag-sharing/src/types.ts`
- Interfaces `UserTag extends Doc`, `AccountTagAssignment extends AttachedDoc`, `SpaceTagAccess extends AttachedDoc`, `TaggedProfile`

**1.3** Criar `models/model-tag-sharing/src/index.ts`
- `TUserTag`: @Model, @Prop(TypeString) title, @Prop(TypeString) description, @Prop(TypeNumber) color
- `TAccountTagAssignment`: @Model, attachedTo AccountUuid reference, @Prop(TypeRef UserTag) tag, @Prop(TypeRef Account) assignedBy
- `TSpaceTagAccess`: @Model, attachedTo Space, @Prop(TypeRef UserTag) tag, @Prop(TypeRef Role?) role
- `TTaggedProfile`: @Mixin sobre `contact.mixin.Employee`, @Prop(ArrOf TypeRef UserTag) userTags

**1.4** Registrar em `models/all/src/index.ts`
- Import e call de `createModel` do model-tag-sharing

**1.5** Registrar pacotes no `rush.json`
- `plugins/tag-sharing`, `models/model-tag-sharing`, `server-plugins/tag-sharing`, `plugins/tag-sharing-resources`

**1.6** Criar `models/model-tag-sharing/src/migration.ts`
- `const tagSharingMigrations: MigrateOperation[]` com `up: async () => {}` (vazio por ora)

---

### Fase 2 — Server Trigger (denormalização)

**2.1** Criar `server-plugins/tag-sharing/src/index.ts`

Trigger `onTagAssignedOrRemoved`:
```
Dispara quando: TxCreateDoc<AccountTagAssignment> ou TxRemoveDoc<AccountTagAssignment>
Ação:
  1. Busca todos SpaceTagAccess com tag == event.tag
  2. Para cada Space encontrado:
     - Se assign: Space.members.push(accountUuid) se não estiver
     - Se remove: verifica se account tem outra razão de acesso (membro direto ou outra tag)
                  se não tiver: Space.members.remove(accountUuid)
```

Trigger `onSpaceTagAccessChanged`:
```
Dispara quando: TxCreateDoc<SpaceTagAccess> ou TxRemoveDoc<SpaceTagAccess>
Ação:
  1. Busca todos AccountTagAssignment com tag == event.tag → resolve lista de AccountUuids
  2. Para cada AccountUuid:
     - Se SpaceTagAccess criado: adiciona em Space.members se não estiver
     - Se SpaceTagAccess removido: verifica se ainda tem acesso por outra via; remove se não tiver
```

**2.2** Registrar triggers no plugin server (similar a `server-plugins/tracker-resources/src/index.ts`)

---

### Fase 3 — UI Resources

**3.1** Criar `plugins/tag-sharing-resources/src/plugin.ts`
- `mergeIds` com novos component slots

**3.2** Criar componentes na ordem:
1. `UserTagPresenter.svelte` (mais simples, sem dependência)
2. `EditUserTag.svelte` (modal CRUD)
3. `UserTagSelector.svelte` (popup reutilizável)
4. `UserTagsEditor.svelte` (editor inline de tags por usuário)
5. `SpaceTagAccessEditor.svelte` (editor de tags por Space)
6. `UserTagsPanel.svelte` (painel admin completo)

**3.3** Criar `plugins/tag-sharing-resources/src/index.ts`
- Exportar `Resources` com todos os componentes

---

### Fase 4 — Integração no Settings

**4.1** Adicionar refs no `plugins/setting/src/index.ts`

**4.2** Adicionar `WorkspaceSettingCategory` em `models/setting/src/index.ts`
```typescript
builder.createDoc(setting.class.WorkspaceSettingCategory, core.space.Model, {
  name: 'user-tags',
  label: tagSharing.string.UserTags,
  icon: tagSharing.icon.UserTag,
  component: tagSharing.component.UserTagsPanel,
  group: 'workspace',
  role: AccountRole.Maintainer,
  order: 4500
}, setting.ids.UserTags)
```

**4.3** Registrar componentes em `plugins/setting-resources/src/index.ts`

---

### Fase 5 — Integração nas telas existentes

**5.1** Modificar `plugins/contact-resources/src/components/EditMember.svelte`
- Importar `UserTagsEditor`
- Adicionar seção "Tags de Usuário" após os campos existentes

**5.2** Modificar `plugins/contact-resources/src/components/SpaceMembersEditor.svelte`
- Importar `SpaceTagAccessEditor`
- Adicionar seção "Acesso por Tag" abaixo da lista de membros

**5.3** Modificar `plugins/setting-resources/src/components/Members.svelte`
- Adicionar coluna "Tags" na tabela de membros do workspace
- Renderizar tags com `UserTagPresenter`

---

### Fase 6 — Testes e Validação

**6.1** Testar fluxo completo:
- Criar tag no painel admin
- Atribuir tag a 2 usuários
- Adicionar tag em um Space
- Verificar que os 2 usuários aparecem em `Space.members`
- Remover tag de 1 usuário → verificar que saiu do Space
- Remover tag do Space → verificar que os 2 usuários saíram (se não tinham acesso direto)

**6.2** Testar edge cases:
- Usuário com acesso direto E via tag: ao remover tag, deve manter acesso direto
- Usuário com 2 tags que dão acesso ao mesmo Space: remover uma das tags não deve revogar acesso

---

## Tela de Admin — Detalhamento

### Localização
`Settings → Workspace Settings → Tags de Usuário`

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Tags de Usuário                          [+ Nova Tag]    │
├─────────────────────────────────────────────────────────┤
│ 🟦 squad-seed          5 usuários   ✏️  🗑️             │
│   └─ Pedro B., Ana L., Carlos M., +2                    │
├─────────────────────────────────────────────────────────┤
│ 🟩 lead-designer       2 usuários   ✏️  🗑️             │
├─────────────────────────────────────────────────────────┤
│ 🟥 cliente-xyz         3 usuários   ✏️  🗑️             │
└─────────────────────────────────────────────────────────┘
```

### Modal "Nova Tag / Editar Tag"

```
┌────────────────────────────────┐
│ Nova Tag de Usuário             │
│                                 │
│ Nome *                          │
│ ┌──────────────────────────┐   │
│ │ squad-seed               │   │
│ └──────────────────────────┘   │
│                                 │
│ Descrição                       │
│ ┌──────────────────────────┐   │
│ │ Time de Performance Seed │   │
│ └──────────────────────────┘   │
│                                 │
│ Cor                             │
│ ⬜🟥🟧🟨🟩🟦🟪⬛🟫🩷         │
│                                 │
│           [Cancelar] [Salvar]   │
└────────────────────────────────┘
```

---

## Fluxo de Compartilhamento — UX

### 1. Admin cria tag
`Settings → Tags de Usuário → Nova Tag → preenche → Salvar`

### 2. Admin atribui tags a usuários
`Settings → Members → [usuário] → Tags: [+ Adicionar Tag] → seleciona tags → confirma`

### 3. Admin configura acesso no Space
`Tracker → [Projeto] → Settings → Membros → Acesso por Tag → [+ Adicionar Tag] → seleciona tag`

### 4. Sistema denormaliza automaticamente
- Trigger detecta `SpaceTagAccess` criado
- Resolve usuários com aquela tag
- Adiciona em `Space.members`
- Usuários ganham acesso sem ação adicional

### 5. Revogação por remoção de tag do usuário
- Admin vai em Members → remove tag do usuário
- Trigger detecta `AccountTagAssignment` removido
- Remove de todos os Spaces onde acesso era via essa tag
- Acesso direto (se houver) é preservado

---

## Impacto no Middleware de Permissões

A Opção A (denormalized) não requer mudanças no middleware existente — o `Space.members` já é
a fonte de verdade e será mantido atualizado pelos triggers.

Caso seja necessário auditoria ("por que esse usuário tem acesso?"), o sistema pode consultar
`SpaceTagAccess` e `AccountTagAssignment` para rastrear a origem.

**Arquivo de permissões:** `foundations/communication/packages/server/src/middleware/permissions.ts`
- **Nenhuma mudança necessária em V1** (graças à abordagem denormalized)

---

## Riscos Técnicos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Trigger lento ao atribuir tag a muitos usuários + muitos Spaces | Média | Alto | Processar em batch assíncrono, não bloquear o request |
| Race condition: 2 admins editando tag ao mesmo tempo | Baixa | Médio | Usar TxUpdateDoc com `$push`/`$pull` atômico, não substituição de array |
| Acesso residual após remoção de tag (bug no trigger de revogação) | Média | Alto | Teste de regressão obrigatório + log de auditoria |
| Conflito de upstream: Huly upstream modifica SpaceMembers pattern | Baixa | Alto | Manter trigger isolado em arquivo próprio, não modificar core Space |
| `Space.members` crescendo muito em workspaces grandes | Baixa | Médio | Monitorar; se necessário migrar para Opção B (virtual) em V2 |
| Usuário em 2 tags que apontam para mesmo Space — dupla entrada no array | Baixa | Baixo | Trigger usa `$addToSet` / `Set.has()` check antes de inserir |

---

## Estimativa de Esforço

| Fase | Tarefa | Estimativa |
|---|---|---|
| 1 | Modelo e plugin base | 4h |
| 2 | Server trigger (denormalização) | 6h |
| 3 | Componentes Svelte (6 componentes) | 10h |
| 4 | Integração no Settings | 2h |
| 5 | Integração nas telas existentes | 3h |
| 6 | Testes e validação | 4h |
| — | **Total estimado** | **~29h** |

**Complexidade:** Média-Alta  
**Principal risco:** lógica de revogação no trigger (Fase 2)  
**Pré-requisito:** nenhum — pode ser desenvolvido em paralelo com outras features

---

## Decisões de Design

| Decisão | Escolha | Alternativa descartada | Motivo |
|---|---|---|---|
| Estratégia de propagação | Denormalized (V1) | Virtual no middleware (V2) | Zero mudança no middleware; menor risco |
| Onde persistir tags de usuário | Mixin `TaggedProfile` sobre `contact.mixin.Employee` | Novo AttachedDoc separado | Mais fácil de consultar; segue padrão do HR module |
| Plugin novo ou extensão de `tags` existente | Plugin novo `tag-sharing` | Reutilizar `tags` plugin | Plugin `tags` é para Issues; semântica diferente |
| Onde colocar UI de tags por Space | `SpaceMembers.svelte` existente | Novo painel separado | UX mais coesa — membros e tags no mesmo lugar |
| Modelo: `AccountTagAssignment` como Doc separado | **Descartado** — `userTags: Ref<UserTag>[]` no mixin | Coleção de AttachedDoc | Array no mixin é suficiente para V1, mais simples |
| Permissões no middleware | **Não modificado** | Novo resolver no middleware | Approach denormalized torna desnecessário |

---

## Arquivos Reais Criados/Modificados

### Novos arquivos

| Arquivo | Descrição |
|---|---|
| `plugins/tag-sharing/src/index.ts` | IDs canônicos do plugin |
| `plugins/tag-sharing/package.json` | Package do plugin base |
| `models/model-tag-sharing/src/index.ts` | `TUserTag`, `TSpaceTagAccess`, `TTaggedProfile` + `createModel` |
| `models/model-tag-sharing/src/migration.ts` | `tagSharingOperation` (vazio, pronto para migrations futuras) |
| `models/model-tag-sharing/package.json` | Package do model |
| `server-plugins/tag-sharing/src/index.ts` | IDs dos triggers server-side |
| `server-plugins/tag-sharing/package.json` | Package do server plugin |
| `server-plugins/tag-sharing-resources/src/index.ts` | Implementação dos triggers (`OnTagAssignmentChanged`, `OnSpaceTagAccessChanged`) |
| `server-plugins/tag-sharing-resources/package.json` | Package dos server resources |
| `models/server-tag-sharing/src/index.ts` | Registra os dois triggers no builder |
| `models/server-tag-sharing/package.json` | Package do model-server |
| `plugins/tag-sharing-resources/src/index.ts` | Exporta `Resources` com os 6 componentes |
| `plugins/tag-sharing-resources/src/plugin.ts` | `mergeIds` para os component IDs |
| `plugins/tag-sharing-resources/src/components/UserTagPresenter.svelte` | Badge colorido |
| `plugins/tag-sharing-resources/src/components/EditUserTag.svelte` | Modal CRUD de tag |
| `plugins/tag-sharing-resources/src/components/UserTagSelector.svelte` | Popup multi-select |
| `plugins/tag-sharing-resources/src/components/UserTagsEditor.svelte` | Editor inline no perfil do usuário |
| `plugins/tag-sharing-resources/src/components/SpaceTagAccessEditor.svelte` | Editor de tags por Space |
| `plugins/tag-sharing-resources/src/components/UserTagsPanel.svelte` | Painel admin completo |
| `plugins/tag-sharing-resources/package.json` | Package dos UI resources |

### Arquivos modificados

| Arquivo | O que mudou |
|---|---|
| `models/all/src/index.ts` | Import + registro de `tagSharingModel` e `serverTagSharingModel` |
| `models/all/src/migration.ts` | Import + registro de `tagSharingOperation` |
| `models/model-tag-sharing/src/index.ts` | Adicionado `builder.createDoc(WorkspaceSettingCategory, ...)` |
| `models/model-tag-sharing/package.json` | Dep `@hcengineering/setting` adicionada |
| `rush.json` | 6 novos packages registrados |
| `dev/prod/src/platform.ts` | `import tagSharingId` + `addLocation(tagSharingId, ...)` |
| `dev/prod/package.json` | Deps `@hcengineering/tag-sharing` e `@hcengineering/tag-sharing-resources` |
| `plugins/contact-resources/src/components/EditPerson.svelte` | Seção `UserTagsEditor` para Employees |
| `plugins/contact-resources/src/components/SpaceMembers.svelte` | Seção `SpaceTagAccessEditor` |
| `plugins/contact-resources/package.json` | Dep `@hcengineering/tag-sharing` adicionada |

---

## Guia de Testes

### Pré-requisitos
```bash
# Na raiz do monorepo
rush install
rush build
docker compose up -d
```

### Teste 1 — Criar tag
1. Abrir `http://localhost:7000`
2. Ir em `Settings → Workspace Settings → Tags de Usuário`
3. Clicar `+ Nova Tag`
4. Preencher Nome: `squad-seed`, escolher cor azul
5. Salvar
6. **Esperado:** tag aparece na lista com badge azul

### Teste 2 — Atribuir tag a usuário
1. Ir em `Settings → Members` ou abrir perfil de um usuário
2. Na seção de tags do perfil, clicar `+`
3. Selecionar `squad-seed`
4. **Esperado:** badge `squad-seed` aparece no perfil

### Teste 3 — Conceder acesso a Space via tag
1. Ir em `Tracker → [Projeto qualquer] → Settings`
2. Na seção Membros, rolar até "Tags com Acesso"
3. Clicar `+`, selecionar `squad-seed`
4. **Esperado:** `SpaceTagAccess` criado, trigger executa, usuários com `squad-seed` aparecem em `Space.members`
5. Verificar no outro navegador (como usuário com `squad-seed`) que o projeto ficou visível

### Teste 4 — Revogação por remoção de tag do usuário
1. Remover tag `squad-seed` de um usuário específico
2. **Esperado:** trigger detecta mudança, remove o usuário de todos os Spaces onde o acesso era via `squad-seed`
3. Se o usuário tinha acesso direto ao Space, deve mantê-lo

### Teste 5 — Edge case: duas tags para o mesmo Space
1. Criar segunda tag `lead`
2. Atribuir `lead` ao mesmo usuário que já tem `squad-seed`
3. Configurar o Space para aceitar ambas as tags
4. Remover `squad-seed` do usuário
5. **Esperado:** usuário permanece no Space (via `lead`)

### Teste 6 — Revogação por remoção de tag do Space
1. Remover tag `squad-seed` da lista de tags com acesso ao Space
2. **Esperado:** todos os usuários que tinham acesso APENAS via `squad-seed` são removidos do Space
3. Usuários com acesso direto ou via outra tag devem permanecer

### Verificação de DB (para debug)
```
# Verificar Space.members após trigger
# Via MCP Huly ou console do workspace:
# findAll(core.class.Space, { _id: spaceId }) → verificar .members array
# findAll(tagSharing.class.SpaceTagAccess, { space: spaceId }) → verificar docs de acesso
```
