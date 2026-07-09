# Relatório — `3f-build.sh`

> Script orquestrador de build/deploy do 3F Hub (Huly).
> **Repo:** `github.com/3F-Tech/huly-3f` · **Local do script:** raiz do repo (`./3f-build.sh`)

Pega o código-fonte do monorepo, compila, empacota cada pod, builda as imagens Docker `hardcoreeng/<pod>:3f-local` e reinicia os containers — local ou na VPS. Roda com `set -euo pipefail` (para no primeiro erro) e cronometra cada passo.

## Visão geral — as 5 etapas

| # | Etapa | O que faz | Como pular |
|---|-------|-----------|-----------|
| 1 | **Rush build** | Compila o TypeScript (`rush build` incremental, ou `rush rebuild` com `--clean`) | `--skip-rush` |
| 2 | **Webpack** | Gera o bundle do frontend em `dev/prod` (pesado, 5–15 min) | `--skip-webpack` **ou** se `front` não estiver nos pods |
| 3 | **Bundle dos pods** | `rushx bundle` (esbuild) em cada pod selecionado; no `front` copia o dist do webpack | — (segue a lista de pods) |
| 4 | **Docker build** | `common/scripts/docker_build.sh` → imagem `hardcoreeng/<pod>:3f-local` | — |
| 5 | **Restart** | `docker compose up -d --no-deps <serviços>` no compose certo | — |

> No fim imprime a URL de acesso: `http://localhost:8087` (local) ou `https://3ftasks.3fventure.tech` (com `--vps`).

## Variações (flags)

| Flag | Efeito | Quando usar |
|------|--------|-------------|
| *(nenhuma)* | Build completo **só dos pods padrão** | Mudança ampla no conjunto padrão |
| `--clean` | Troca `rush build` por **`rush rebuild`** (recompila tudo do zero) | Build incremental "sujo"/comportamento estranho |
| `--no-cache` | `docker build --no-cache` | Imagem com camadas corrompidas/desatualizadas |
| `--skip-rush` | Pula a etapa 1 (TS) | Só rebundlar/rebuildar Docker sem recompilar |
| `--skip-webpack` | Pula a etapa 2 (front bundle) | **Só backend mudou** (models, server-plugins, server) |
| `--vps` | Usa `dev/docker-compose.vps.yaml` (produção) em vez do local | Deploy na VPS |
| `--pod "X Y"` | Define **quais** pods buildar/reiniciar | Deploy cirúrgico de 1+ serviços |
| `--help` / `-h` | Mostra o bloco de uso e sai | — |

**Padrão de `--pod`** (se você não passar nada):
```
server front account collaborator workspace fulltext worker
```
`fulltext` e `worker` **entram** no build padrão: ambos embutem o model, então precisam
ser rebuildados junto num version bump (senão ficam stale — ex.: fulltext em versão antiga
→ busca morre).
⚠️ **`calendar`, `github`, `mail`, `datalake`, `preview` NÃO entram no build padrão** — precisam ser pedidos explicitamente com `--pod`.

## Pods suportados (arg → imagem → container → pasta de bundle)

| `--pod` | Imagem | Container (compose) | Pasta |
|---------|--------|---------------------|-------|
| `server` | `hardcoreeng/transactor:3f-local` | `transactor_cockroach` | `pods/server` |
| `front` | `hardcoreeng/front:3f-local` | `front` | `pods/front` |
| `account` | `hardcoreeng/account:3f-local` | `account` | `pods/account` |
| `collaborator` | `hardcoreeng/collaborator:3f-local` | `collaborator` | `pods/collaborator` |
| `workspace` | `hardcoreeng/workspace:3f-local` | `workspace_cockroach` | `pods/workspace` |
| `worker` | `hardcoreeng/worker` *(sem tag → `:latest`)* | `time-machine` | `services/worker` |
| `preview` | `hardcoreeng/preview:3f-local` | `preview` | `pods/preview` |
| `github` | `hardcoreeng/github:3f-local` | `github` | `services/github/pod-github` |
| `mail` | `hardcoreeng/mail:3f-local` | `mail` | `services/mail/pod-mail` |
| `calendar` | `hardcoreeng/calendar:3f-local` | `calendar` | `services/calendar/pod-calendar` |
| `fulltext` | `hardcoreeng/fulltext:3f-local` | `fulltext_cockroach` | `pods/fulltext` |
| `datalake` | `hardcoreeng/datalake:3f-local` | `datalake` | `services/datalake/pod-datalake` |

> Detalhe: o `docker_build.sh` taggeia **duas** vezes (`hardcoreeng/<pod>` = `:latest` **e** `:3f-local`). O `worker` é a exceção — não recebe `DOCKER_VERSION=3f-local`, então sai como `:latest` (inconsistente com o resto da frota).

## Receitas de uso (utilidades)

```bash
# Build local completo (pods padrão)
./3f-build.sh

# Só o front mudou (plugins/*-resources)
./3f-build.sh --pod front

# Só backend mudou (models/*, server-plugins/*) — pula webpack
./3f-build.sh --skip-webpack --pod server

# Conta/auth mudou (server/account)
./3f-build.sh --skip-webpack --pod account

# Dois pods de uma vez
./3f-build.sh --pod "front account"

# Forçar recompilação total + sem cache de Docker, só transactor
./3f-build.sh --clean --no-cache --skip-webpack --pod server

# Deploy na VPS (produção)
./3f-build.sh --vps --pod "front server"

# Rebuild completo na VPS, do zero
./3f-build.sh --vps --clean --no-cache
```

Mapeamento "arquivo alterado → pod" (consolidado no `CLAUDE.md`):

| Mudou em… | `--pod` | Extra |
|---|---|---|
| `plugins/*-resources/` | `front` | — |
| `plugins/*/src/index.ts` | `front server` | — |
| `models/*`, `server-plugins/*` | `server` | `--skip-webpack` |
| `server/account*/` | `account` | `--skip-webpack` |
| `services/worker/` | `worker` | `--skip-webpack` |
| `services/{calendar,github,mail}/` | nome do serviço | `--skip-webpack` |
| Não sabe | *(todos)* | rodar sem `--pod` (e lembrar dos serviços fora do padrão) |

## Comportamentos e pegadinhas importantes

- **Webpack só dispara se `front` estiver nos pods.** Se você usar `--skip-webpack` (ou não incluir `front`) tendo mudado o frontend, o bundle fica **velho** — a UI não reflete a mudança.
- **Etapa 3 do front** limpa `pods/front/dist`, copia `dev/prod/dist` + `dev/prod/public/*` e remove `config.json` (config vem do runtime).
- **docker-compose v1 (VPS):** o script detecta `docker compose` vs `docker-compose`; na v1 roda `rm -f` nos serviços **antes** do `up` para contornar o bug `KeyError: 'ContainerConfig'`.
- **`up -d --no-deps`:** sobe só os serviços buildados, sem mexer nas dependências (banco, redpanda etc.).
- **Bump de `version.txt` = rebuildar tudo.** A versão é compilada *dentro* do bundle; subir um pod só pode "brickar" o app (transactor recusa se o `MODEL_VERSION` dele for menor que o do banco). Nesse caso, rode **sem** `--pod` (ou liste todos).
- **`--vps` não aplica nginx nem transfere imagem.** O script builda e sobe no daemon Docker **local à máquina onde roda**. Para valer na VPS, ele precisa rodar **na própria VPS** (após `git pull`); o reverse proxy (`dev/nginx/3ftasks.conf`) é aplicado à parte.
- **`--no-cache`** afeta só o `docker build` (etapa 4), não o `rush`. Para forçar recompilação de TS use `--clean`.

---

> Documento companheiro: [`estrategia-cicd.md`](./estrategia-cicd.md) — diagnóstico e proposta de CI/CD para o `huly-3f`.
