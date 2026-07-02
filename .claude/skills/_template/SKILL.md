---
name: fNN-nome-da-feature
description: >-
  Use ao trabalhar na feature <FNN — Nome> (<capacidade em 1 linha>). Liste aqui
  os SINTOMAS / PALAVRAS-CHAVE que devem ativar esta skill numa sessão futura —
  ex.: "adicionar campo X", "debugar por que Y não aconteceu", "onde fica Z".
  Quanto mais específico o QUANDO, melhor a seleção automática pelo Claude Code.
---

# FNN — <Nome da Feature>

<!--
  MOLDE de skill de navegação por feature do 3F Tasks.
  Como replicar:
    1. Copie a pasta `.claude/skills/_template/` para `.claude/skills/fNN-nome/`.
    2. Preencha o frontmatter (name = nome da pasta; description = QUANDO usar).
    3. Preencha as seções abaixo a partir do CÓDIGO REAL (não dos docs, que podem
       estar desatualizados). Use `Grep`/`Glob` pra confirmar paths e nomes.
    4. Apague estes comentários HTML.
  Objetivo: uma sessão futura acha arquivos + arquitetura + regras em segundos.
  Regra de ouro: seja denso e curto. Paths clicáveis > prosa.
-->

## O que é
<1–2 frases: a capacidade de negócio. Sem enrolação.>

## Estado atual
<Implementada? Em produção ou só local? Atrás de flag? Fase/escopo?
 Aponte divergências com `3f-docs/features/` — os docs às vezes ficam para trás.>

## Arquitetura / fluxo
<Como funciona em 3–6 linhas: gatilho → processamento → efeito.
 Diga em que PROCESSO roda (transactor `server`? pod `worker`? `front`? `account`?).>

## Arquivos-chave
<Agrupe por camada, paths relativos à raiz e clicáveis (com `:linha` quando útil).>

- **Tipos/IDs** — `plugins/<x>/src/index.ts`
- **Schema/migration** — `models/<x>/src/types.ts`, `models/<x>/src/migration.ts`
- **Server/trigger** — `server-plugins/<x>/src/index.ts` (+ registro em `models/server-<x>/src/index.ts`)
- **UI** — `plugins/<x>-resources/src/components/<...>.svelte`
- **Registro** — `server/server-pipeline/src/serverPlugins.ts`, `dev/prod/src/platform.ts`, `models/all/src/index.ts`

## Regras de negócio
<Bullets curtos com as regras REAIS extraídas do código.>

## Gotchas / debug
- **Qual pod rebuildar** — `./3f-build.sh ...` (ver mapa arquivo→pod no `CLAUDE.md`).
- **Como verificar que funcionou** — log a grepar / container / estado no banco.
- **Armadilhas conhecidas** — <...>.

## Docs & testes
- Spec: `3f-docs/features/FNN-.../context.md`
- Casos de teste: `3f-docs/features/FNN-.../tests.md`
