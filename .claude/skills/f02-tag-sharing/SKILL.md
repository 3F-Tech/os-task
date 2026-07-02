---
name: f02-tag-sharing
description: >-
  Use ao trabalhar na feature F02 (Tag-Based Sharing): tags de usuário que
  concedem acesso AUTOMÁTICO a spaces/projetos. Ative ao criar/editar tags, ao
  configurar quais projetos uma tag libera, ou ao debugar por que um colaborador
  (não) foi adicionado/removido de um projeto ao ganhar/perder uma tag. Também
  serve de exemplo canônico do padrão "plugin triple + trigger em 3 camadas".
---

# F02 — Tag-Based Sharing

## O que é
Admin cria **tags de usuário** (`UserTag`), atribui a colaboradores, e configura
que uma tag concede acesso a um space/projeto (`SpaceTagAccess`). Dois triggers
sincronizam `Space.members` automaticamente quando a atribuição de tag muda ou
quando a regra de acesso muda.

## Estado atual
Implementada e mergeada em `develop`. Roda no **transactor** (pod `server`).

## Arquitetura / fluxo
Modelo:
- `UserTag` (Doc) — a tag: `title`, `description?`, `color`.
- `SpaceTagAccess` (Doc) — regra "tag → space": `{ space, tag }`.
- `TaggedProfile` (mixin em `Employee`) — `userTags: Ref<UserTag>[]`.

Fluxo: mudou a atribuição de tag OU a regra de acesso → trigger recalcula quem
deve estar em `Space.members` → emite `TxUpdateDoc` com `$push`/`$pull` de members.

## Arquivos-chave
- **Tipos/IDs** — `plugins/tag-sharing/src/index.ts` (UserTag, SpaceTagAccess, TaggedProfile, plugin IDs)
- **Schema/model + migration** — `models/model-tag-sharing/src/index.ts`, `models/model-tag-sharing/src/migration.ts`
- **Trigger — declaração** — `server-plugins/tag-sharing/src/index.ts:7` (resources `OnTagAssignmentChanged`, `OnSpaceTagAccessChanged`)
- **Trigger — implementação** — `server-plugins/tag-sharing-resources/src/index.ts` (`OnTagAssignmentChanged` :71, `OnSpaceTagAccessChanged` :159)
- **Trigger — registro no model** — `models/server-tag-sharing/src/index.ts:10` (`builder.createDoc(serverCore.class.Trigger, ...)`)
- **Registro no pipeline** — `server/server-pipeline/src/serverPlugins.ts:65` (`addLocation(serverTagSharingId, ...)`)
- **UI** — `plugins/tag-sharing-resources/src/components/`: `UserTagsPanel`, `EditUserTag`, `UserTagsEditor`, `UserTagSelector`, `UserTagPresenter`, `SpaceTagAccessEditor`
- **Hook no contato** — `plugins/contact-resources/src/components/EditPerson.svelte` (renderiza `UserTagsEditor` para Employee)

## Regras de negócio (extraídas do código)
- **Atribuir/remover tag** (`OnTagAssignmentChanged`, dispara em `TxMixin` de `TaggedProfile`):
  - `$push` de uma tag → adiciona a conta a todos os spaces com `SpaceTagAccess` dessa tag (se ainda não for membro).
  - `$pull` de uma tag → remove a conta desses spaces **só se** ela não tiver acesso por nenhuma outra tag (`hasTagAccess`).
  - Set do array inteiro (a UI manda `userTags` completo, sem `$push/$pull`) → reconcilia **todos** os spaces por diff.
- **Configurar/remover acesso** (`OnSpaceTagAccessChanged`, dispara em `TxCreateDoc`/`TxRemoveDoc` de `SpaceTagAccess`):
  - Criar regra → adiciona todos com a tag ao space.
  - Remover regra → remove todos com a tag, exceto quem ainda tem acesso por outra tag.
- A conta usada em `Space.members` é o `personUuid` do Employee. O `objectId` do
  `TxMixin` é o `_id` do Employee, então é preciso carregar o doc pra achar o
  `personUuid` (ver `resolveAccountUuid`).

## Gotchas / debug
- **Trigger em 3 camadas** (armadilha clássica): declaração (`server-plugins/tag-sharing`)
  + implementação (`server-plugins/tag-sharing-resources`) + `builder.createDoc(Trigger)`
  no model (`models/server-tag-sharing`). Faltando qualquer uma → o trigger não roda
  e **falha silenciosa** (sem erro). Padrão descrito no `3f-docs/AGENT_RULES.md`.
- **Membership em campo `ArrOf`**: a query `{ userTags: tagRef }` casa "tag pertence
  ao array" — depende do adapter (Cockroach) tratar `ArrOf` assim. Vale para
  `Space.members` também.
- **Limitação conhecida**: no caminho "set do array inteiro", se a conta tinha acesso
  direto **e** por tag ao mesmo space, ambos são removidos ao perder a tag.
- **Rebuild**: mexeu em `server-plugins/`/`models/` → `./3f-build.sh --skip-webpack --pod server`. Mexeu na UI (`*-resources`) → `./3f-build.sh --pod front`.
- **Verificar**: `docker logs -f dev-transactor_cockroach-1` e observar as `TxUpdateDoc`
  de `members` logo após atribuir/remover uma tag ou criar/remover uma regra.

## Docs & testes
- Spec: `3f-docs/features/F02-tag-based-sharing/context.md`
- Casos de teste: `3f-docs/features/F02-tag-based-sharing/tests.md`
- Plano original: `3f-docs/plans/05-tag-sharing.md`
