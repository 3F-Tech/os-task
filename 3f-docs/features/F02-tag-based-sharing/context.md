# F02 — Compartilhamento por Tags (Tag-Based Sharing)

## Visão Geral

Permite criar etiquetas (`UserTag`) e atribuí-las a colaboradores via mixin `TaggedProfile`. Espaços/projetos podem ser configurados para conceder acesso automático a todos os membros que possuem uma determinada tag. Quando a tag é atribuída ou removida de um colaborador, dois triggers no servidor atualizam automaticamente a lista de membros dos espaços afetados.

**Branch:** `feature/tag-based-sharing`  
**Status:** Implementado e mergeado em `develop`  
**Prioridade original:** Alta  
**Relacionado a:** `feature/bu-access-control` (versão mais ampla com BUs)

---

## Problema que resolve

Na 3F Venture, cada BU (Seed, Bomma, Impulse, Tecnologia) tem múltiplos projetos. Adicionar/remover membros manualmente em cada projeto ao onboarding de um novo colaborador é trabalhoso e propenso a erros. Com tags, define-se a tag do colaborador uma vez e o acesso é propagado automaticamente.

---

## Arquitetura

### Pacotes criados

| Pacote | Caminho | Função |
|---|---|---|
| `@hcengineering/tag-sharing` | `plugins/tag-sharing/` | Interfaces e IDs do plugin |
| `@hcengineering/tag-sharing-resources` | `plugins/tag-sharing-resources/` | Componentes Svelte (UI) |
| `@hcengineering/model-tag-sharing` | `models/model-tag-sharing/` | Classes de modelo (decorators) |
| `@hcengineering/server-tag-sharing` | `server-plugins/tag-sharing/` | Resource IDs dos triggers |
| `@hcengineering/server-tag-sharing-resources` | `server-plugins/tag-sharing-resources/` | Implementação dos triggers |
| `@hcengineering/model-server-tag-sharing` | `models/server-tag-sharing/` | Registro dos triggers no modelo |

### Modelo de dados
**Arquivo:** `plugins/tag-sharing/src/index.ts`

```typescript
// Etiqueta criada pelo admin
export interface UserTag extends Doc {
  title: string
  description?: string
  color: number
}

// Associação entre uma tag e um espaço (cada doc = "tag X dá acesso ao espaço Y")
export interface SpaceTagAccess extends Doc {
  tag: Ref<UserTag>
  // space: herdado de Doc — o doc vive no espaço que ele representa
}

// Mixin aplicado sobre Employee para armazenar as tags do colaborador
export interface TaggedProfile extends Doc {
  userTags: Ref<UserTag>[]
}
```

**Model classes** (`models/model-tag-sharing/src/index.ts`):
- `TUserTag` — domain `tag-sharing`, full-text index no `title`
- `TSpaceTagAccess` — indexed em `space` e `tag` para lookups eficientes
- `TTaggedProfile` — mixin de `contact.mixin.Employee`

### Fluxo de acesso automático

```
Admin cria Tag "Seed"
        │
        ▼
Admin configura SpaceTagAccess: tag="Seed" → projeto "Seed - Performance"
        │
        ▼
Trigger OnSpaceTagAccessChanged dispara
        │
        └─▶ Busca todos os Employees com tag "Seed"
             └─▶ Adiciona cada um ao space.members do projeto

Admin atribui tag "Seed" ao colaborador João
        │
        ▼
Trigger OnTagAssignmentChanged dispara
        │
        └─▶ Busca todos os espaços com SpaceTagAccess para tag "Seed"
             └─▶ Adiciona João ao space.members de cada espaço
```

### Triggers de servidor
**Arquivo:** `server-plugins/tag-sharing-resources/src/index.ts`

#### `OnTagAssignmentChanged` (L.71–153)
Dispara em `TxMixin` sobre `TaggedProfile`. Lida com 3 cenários:

1. **`$push` atômico** (L.84–97) — uma tag foi adicionada: adiciona o colaborador aos espaços da tag
2. **`$pull` atômico** (L.99–115) — uma tag foi removida: remove o colaborador dos espaços **se não tiver mais acesso via outra tag** (chama `hasTagAccess()`)
3. **Array completo** (L.119–149) — UI envia o array inteiro sem `$push/$pull`: reconcilia para todos os espaços comparando tags novas vs antigas

#### `OnSpaceTagAccessChanged` (L.159–215)
Dispara em criação/remoção de `SpaceTagAccess`:

- **Criação:** adiciona todos os colaboradores com aquela tag ao espaço
- **Remoção:** remove colaboradores que não têm mais acesso via outra tag

**Registro dos triggers** (`models/server-tag-sharing/src/index.ts`):
```typescript
// Trigger 1: mudança de tags em colaborador
txMatch: { _class: core.class.TxMixin, mixin: tagSharing.mixin.TaggedProfile }

// Trigger 2: criação/remoção de SpaceTagAccess
txMatch: { objectClass: tagSharing.class.SpaceTagAccess }
```

### Componentes de UI

| Componente | Caminho | Função |
|---|---|---|
| `UserTagsPanel.svelte` | `plugins/tag-sharing-resources/src/components/` | Painel admin: lista, cria, edita e exclui tags |
| `EditUserTag.svelte` | `plugins/tag-sharing-resources/src/components/` | Modal criar/editar tag (título, descrição, cor) |
| `UserTagsEditor.svelte` | `plugins/tag-sharing-resources/src/components/` | Editor inline no perfil do colaborador |
| `SpaceTagAccessEditor.svelte` | `plugins/tag-sharing-resources/src/components/` | Configuração de tags com acesso a um espaço |
| `UserTagSelector.svelte` | `plugins/tag-sharing-resources/src/components/` | Popup seletor de tags (multi-select) |
| `UserTagPresenter.svelte` | `plugins/tag-sharing-resources/src/components/` | Badge visual de uma tag (readonly) |

**Ponto de integração no perfil:**
`plugins/contact-resources/src/components/EditPerson.svelte` — renderiza `UserTagsEditor` condicionalmente quando o perfil tem mixin `Employee`.

### Settings no workspace
Registrado em `models/model-tag-sharing/src/index.ts` como categoria de setting:
- **Nome:** "userTags"
- **Label:** `tagSharing.string.UserTags`
- **Ícone:** `tagSharing.icon.TagSharing`
- **Papel mínimo:** Maintainer
- **Ordem:** 5100

Acessível em: **Settings → User Tags**

---

## Integração com o servidor pipeline
**Arquivo:** `server/server-pipeline/src/serverPlugins.ts`

```typescript
import { serverTagSharingId } from '@hcengineering/server-tag-sharing'
addLocation(serverTagSharingId, ...)
```

Sem esse `addLocation`, o transactor lança `NoLocationForPlugin: server-tag-sharing` e os triggers nunca disparam.

---

## Decisões de implementação

### Por que `SpaceTagAccess.space` = `Doc.space`?
`SpaceTagAccess` representa "esta configuração de acesso pertence ao espaço X". Usar `Doc.space` diretamente (em vez de um campo separado) simplifica queries e evita redundância. O modelo usa `declare space` para anotar o tipo sem criar nova propriedade.

### Por que não usar o sistema de permissões nativo?
O sistema nativo do Huly exige adição/remoção manual de membros. A abordagem de tags foi escolhida para manter compatibilidade com o upstream enquanto adiciona automação. A feature `feature/bu-access-control` futuramente substituirá por um controle mais granular baseado em BUs.

### Reconciliação completa do array (cenário 3)
A UI do Huly às vezes envia o array completo de tags em vez de operações atômicas `$push/$pull`. O trigger detecta isso (quando nem `$push` nem `$pull` estão presentes mas `userTags` é um array) e reconcilia o acesso para todos os espaços, evitando estados inconsistentes.

---

## Limitações conhecidas (Bugs documentados no código)

| Bug | Descrição | Localização |
|---|---|---|
| Bug 1 | `objectId` no `TxMixin` é o `_id` do Employee, não o `AccountUuid` — precisa fazer lookup via `findAll` | `resolveAccountUuid()` L.52–62 |
| Bug 2 | UI às vezes envia array completo sem `$push/$pull` — tratado pelo cenário 3 | `OnTagAssignmentChanged` L.119–149 |
| Bug 3 | Se colaborador tem acesso direto + via tag, remover a tag remove ambos | `OnTagAssignmentChanged` L.141 |

---

## Pendências / TODOs

- [ ] Integração com `feature/bu-access-control` — tags serão o mecanismo de base para BUs
- [ ] UI para visualizar quais membros têm acesso via tag vs acesso direto
- [ ] Proteção no Bug 3: não remover acesso direto ao remover acesso via tag
- [ ] Suporte a tags em `Teamspace` (Documentos) — atualmente só funciona em `Space` base

---

## Como testar

Ver `tests.md` nesta mesma pasta.
