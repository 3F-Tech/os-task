# Relatório — Estratégia de CI/CD para `huly-3f`

> **Status:** diagnóstico + proposta. Esta análise **não alterou nenhum arquivo de aplicação nem executou deploys**.
> **Data:** 2026-06-23 · **Autor:** Pedro Bartelle (análise assistida) · **Repo:** `github.com/3F-Tech/huly-3f` (branch `develop`)
>
> Todas as afirmações de diagnóstico citam o arquivo que as prova.

---

## (a) Cenário e estado atual

### 1. Que tipo de fork é este? → **Fork do `platform` (código-fonte), com uma camada de deploy 3F própria por cima**

Não é o `huly-selfhost`. As provas:

| Evidência de **`platform`** (código-fonte) | Arquivo |
|---|---|
| Monorepo Rush + pnpm | `rush.json`, `common/config/rush/pnpm-lock.yaml`, `common/scripts/` |
| Código dos pods/serviços | `pods/server`, `pods/front`, `pods/account`, `pods/workspace`, `pods/collaborator`, `services/worker`, `services/calendar`… |
| Plugins/models/server-plugins compiláveis | `plugins/*`, `models/*`, `server-plugins/*` |
| Build a partir do fonte | `3f-build.sh` roda `rush build` → `webpack` → `rushx bundle` → `docker build` |

O `huly-selfhost` teria `compose.yml` + `setup.sh` + `nginx.conf` + `.template` puxando **imagens prontas** do Docker Hub e **nenhum** `rush.json`/`pods/`/`plugins/`. Aqui é o oposto: existe a árvore de fonte inteira **e** uma camada de operação criada pela 3F:

- `3f-build.sh` — orquestrador de build/restart (não existe no upstream)
- `dev/docker-compose.vps.yaml` — compose de produção
- `dev/nginx/3ftasks.conf` — reverse proxy/TLS de produção
- `3f-docs/` — documentação 3F (`BUILD_AND_DEPLOY.md`, `AGENT_RULES.md`, features F01–F11)

**Conclusão:** é um fork de `hcengineering/platform` que **builda o próprio código** e adiciona um *runbook* de self-hosting artesanal. Isso muda tudo no desenho de CI/CD: o pipeline precisa **compilar o monorepo**, não só dar `docker pull`.

### 2. O que diverge do upstream

**Código 3F (≈11 projetos Rush novos + extensões):**

| Feature | O que é | Onde |
|---|---|---|
| F02 Tag Sharing | plugin completo (client+server+model) | `plugins/tag-sharing`, `-resources`, `models/model-tag-sharing`, `server-plugins/tag-sharing(-resources)` |
| F10 Operational Dashboard | plugin completo | `plugins/operational-dashboard(-resources/-assets)`, `models/model-operational-dashboard` |
| F01 Completion Validation | mixin `IssueCompletionConfig` em Issue | `models/tracker/src/types.ts` |
| F04 PDCA | campos `pdcaCycle*` em Issue | `models/tracker/src/types.ts` |
| F09 Client Fields | `clientName`, `clientStage` | `models/tracker/src/types.ts` + presenters em `tracker-resources` |
| F11 Login Universal | delega senha à 3F Core API | `server/account/src/threefcore.ts` (arquivo novo) + `plugin.ts` |
| Worker/Digest | "time-machine" (digest diário) | `services/worker` |

**Pontos de registro 3F** (onde o fork "se pluga" no upstream): `dev/prod/src/platform.ts` e `server/server-pipeline/src/serverPlugins.ts`.

**Versões fixadas (e um descasamento a registrar):**
- `common/scripts/version.txt` (**MODEL_VERSION**) = `0.7.359` → controla migrations
- `common/scripts/tag.txt` (**VERSION**) = `0.7.413` → release do código
- Imagens upstream no compose VPS pinadas em `hardcoreeng/*:v0.7.413` (+ `hulypulse:v0.7.423`)
- ✅ `3f-docs/BUILD_AND_DEPLOY.md` já foi atualizado para `0.7.359` (antes dizia `0.7.344`).

### 3. Stack e build

- **Linguagens:** TypeScript (strict) + Svelte 4; Node ≥20 <25; pnpm 10.15.1 via **Rush**.
- **Build:** `rush build` (TS) → `webpack` (bundle do front, `--max-old-space-size=4096`, "5–15 min") → `rushx bundle` (esbuild por pod) → `docker build`. Tudo em `3f-build.sh`.
- **Imagens** (`common/scripts/docker_build.sh`): `docker build -t "$1" -t "$1:$version"`. Com `DOCKER_VERSION=3f-local`, gera `hardcoreeng/<pod>:3f-local` **+ `:latest`**. **Não há `docker push` em lugar nenhum.**
- **Estratégia mista de imagens** no `dev/docker-compose.vps.yaml`:
  - **Buildadas localmente (`:3f-local`):** transactor, front, account, workspace, collaborator, github, fulltext, mail, calendar, preview (+ `worker` **sem tag** → `:latest`, inconsistente).
  - **Upstream pinadas (`v0.7.413`):** stream, stats, rekoni, print, sign, analytics, export, datalake, backup, love; `hulypulse:v0.7.423`; infra: `cockroachdb/cockroach:latest-v24.3`, `redpanda:v24.3.6`, `elasticsearch:7.14.2`, `redis:8.0.2`, `minio/minio` (**latest, não pinado**), `livekit:latest` (**não pinado**).
- **Serviços/containers em produção (VPS):** ~30 (front, transactor, account, workspace, collaborator, github, fulltext, mail, calendar, datalake, preview, stream, stats, rekoni, print, sign, analytics, export, backup, love, livekit(+egress), hulypulse, hulykvs, time-machine/worker, cockroach, redpanda, minio, elastic, redis). Vários upstream estão **desligados** com comentário "not yet published to Docker Hub" (hulylake, hulygun, process, payment, link-preview, backup-api).

### 4. Como o deploy é feito hoje

**Manual, por SSH, build-in-place na VPS.** Não há CD.

- **Host:** Ubuntu VPS, projeto em **`/opt/apps/os-tasks`**, **`docker-compose` v1 (1.29.2)** (hífen — `docker compose` não existe lá; `3f-build.sh:344-347` contorna o bug `KeyError: ContainerConfig` removendo containers antes do `up`).
- **Domínio:** `https://3ftasks.3fventure.tech` (hardcoded em `3f-build.sh:361` e no compose). **IP/provedor não estão no repo** (docs usam o placeholder `root@VPS_IP`).
- **TLS/roteamento:** **nginx no host** (`dev/nginx/3ftasks.conf`), Let's Encrypt em `/etc/letsencrypt/live/3ftasks.3fventure.tech/`. Termina TLS em :443 (front), :3000 (account), :3332 (transactor WS), :3078 (collaborator WS), :3500 (github) e roteia prefixos `/_calendar/`, `/files/`, `/image/`, `/_love/`, `/_livekit/`, `/_pulse/`. **Aplicado à mão** (`cp … sites-available && nginx -t && systemctl reload`), **fora** do `3f-build.sh`.
- **Fluxo de fato** (de `BUILD_AND_DEPLOY.md §6`): na VPS → `git pull` → `./3f-build.sh --vps` (ou `--pod X` p/ um serviço) → acompanhar logs do `workspace_cockroach` (`---UPGRADE-DONE---`).
- **Ambiguidade documentada:** `handoff_claude.md` descreve um modo alternativo "buildar no Windows + `docker save | gzip | scp | docker load`" para um pod isolado. O script **não transfere imagem** — então, se buildar fora da VPS, o `save/scp/load` é manual. Nenhum dos dois é declarado canônico.
- **Versões/migrations:** `version.txt` é compilado *dentro* do `bundle.js` (esbuild) — mudar env no Docker não adianta, tem que **rebuildar**. Migration roda só quando `MODEL_VERSION` compilado > versão no banco, no boot do `workspace_cockroach`. **Regra crítica:** o transactor recusa conexões se o `MODEL_VERSION` dele for menor que o do banco → **todo bump de `version.txt` exige rebuild de toda a frota**, não de um pod só.

### 5. Segredos e configuração

| Item | Onde | Versionado? | Sensível |
|---|---|---|---|
| Google OAuth, LiveKit, GitHub App secret/PEM, SMTP, `THREEF_CORE_API_KEY` | `dev/.env.secrets` | ❌ ignorado (`.gitignore:67-68`) ✅ | **Sim** |
| GitHub App env | `dev/.env.github` | ❌ ignorado (`.gitignore:69`) ✅ | Sim |
| Templates | `dev/.env.secrets.example`, `.env.github.example` | ✅ versionado (ok) | Não |
| `dev/.env` (admin email, `minioadmin`, DB URL insegura) | `dev/.env` | ✅ **não é mais versionado (untracked)** — `dev/.env` agora está no `.gitignore` e foi removido do tracking | Baixo (não vaza mais no git) |
| `SERVER_SECRET` (segredo JWT compartilhado) | hardcoded = **`secret`** em todo o compose VPS | ✅ no git | **Crítico** |
| CockroachDB | `--insecure`, `root@…sslmode=disable`; MinIO `minioadmin/minioadmin` | ✅ no git | **Crítico** |

### 6. Automação que já existe

- **CI upstream herdada e ainda ativa** (`.github/workflows/main.yml`): roda em `push` para `develop` e em PRs → `build` (`rush install/check/build/bundle/validate`), `svelte-check`, `formatting`, `test` (`rush test` com Cockroach/Elastic/Mongo efêmeros), `uitest`/`uitest-pg`/`uitest-qms`/`uitest-workspaces` (Playwright). **Dá validação de PR de graça.**
  - ⚠️ Porém o `docker-build`/push é **tag-gated** (`v*`/`s*`) e empurra para o Docker Hub **`hardcoreeng`** usando `secrets.DOCKER_ACCESS_TOKEN` — **o fork não cria essas tags nem tem esse token → metade de CD está dormente/inútil para a 3F.** `baseimage.yaml`/`publish-npm.yml` idem (upstream). `integrations._yml` está **desativado** (extensão `._yml`).
- **Testes:** Jest difundido (muitos com `--passWithNoTests`, cobertura real irregular) + e2e Playwright em `tests/sanity`, `qms-tests/sanity`, `ws-tests/sanity`.
- **Health endpoints reais** no transactor (`pods/server/src/server_http.ts`): `GET /api/v1/version` → `{version}`, `GET /api/v1/health` → `healthy/unhealthy` (200/503), `/api/v1/statistics`, `PUT /api/v1/manage`. ✅ Ótimo para health-gate. Account/front só têm check TCP.
- **Backup:** pod `backup-cockroach` (intervalo 60 min) grava no **MinIO local** (bucket `backups`, **mesmo disco** da VPS). `backup-api` **desligado** → restore in-app não funciona. **Restore não documentado, sem cópia off-site.**
- **Observabilidade em produção:** ~nenhuma. Jaeger **removido em 2026-06-09** (badger encheu 39 GB). Sobra `stats` (interno) + logs de container. Sem Sentry/Prometheus.

---

## (b) Gaps e riscos

| # | Gap / risco | Impacto | Gravidade |
|---|---|---|---|
| R1 | **Sem registry; tag `:3f-local` mutável** (sobrescrita a cada build); a tag-SHA do `docker_build.sh` nunca é referenciada no compose | **Não existe imagem para qual voltar → rollback impossível** | 🔴 Alta |
| R2 | **Build-in-place numa VPS de 2 cores** (o compose confirma "VPS atual tem 2 cores"); webpack pede 4 GB e leva 5–15 min | Deploy lento, risco de OOM, **downtime durante o build**, "bus factor" | 🔴 Alta |
| R3 | **Bump de `version.txt` = rebuild de toda a frota**; se transactor < banco, app "trava em Preparing workspace" | Janela de inconsistência/brick se feito parcial | 🔴 Alta |
| R4 | **`SERVER_SECRET=secret`, Cockroach `--insecure`, `minioadmin`** | Segredo JWT trivial; qualquer um que alcance as portas forja token. **SERVER_SECRET rotacionado 2026-07-09 (commit `71990885e`, agora `${SERVER_SECRET}` via `dev/.env`); Cockroach/MinIO ainda pendentes.** | 🟡 Média |
| R5 | **Backups no mesmo disco, sem off-site, restore nunca testado/documentado**; histórico de disco cheio (Jaeger 39 GB) | Perda total de dados num incidente de disco | 🔴 Alta |
| R6 | **Deploy só na cabeça/SSH de uma pessoa** (Pedro = admin); processo manual com passos fáceis de esquecer (nginx, `--skip-webpack`, ordem dos pods) | Bus factor = 1; erro humano | 🟠 Média |
| R7 | **Sem CD/health-gate/rollback automático**; sem smoke test pós-deploy | Falha só aparece quando usuário reclama | 🟠 Média |
| R8 | ~~`dev/.env` versionado~~ (resolvido: agora untracked); ~~doc de versão desatualizada~~ (BUILD_AND_DEPLOY já em `0.7.359`); `worker` sem tag; `minio/livekit` em `latest` | Higiene/repetibilidade; "funciona na minha máquina" | 🟡 Baixa |
| R9 | **Sem ambiente de staging** | Migrations e mudanças vão direto pra prod | 🟠 Média |
| R10 | **TLS/cert e nginx manuais**; renovação do Let's Encrypt não documentada | Site cai quando o cert expira | 🟠 Média |

---

## (c) Desenho do pipeline + exemplo de workflow

### 8. Pipeline proposto (4 estágios)

A decisão estrutural que destrava todo o resto: **introduzir um container registry (GHCR — grátis e privado no org `3F-Tech`) com tags imutáveis por SHA**, e separar **build** (no CI) de **deploy** (na VPS = só `pull` + `up`). Isso resolve de uma vez rollback (R1), carga/downtime da VPS (R2) e bus factor (R6).

```
┌─ 1. BUILD (GitHub Actions) ──────────────────────────────────────────────┐
│  rush install (cache) → rush build → webpack → rushx bundle por pod       │
│  docker build -t ghcr.io/3f-tech/huly-3f/<pod>:<git-sha>                   │
│  push GHCR (tags: <sha> imutável  +  develop/latest móvel)                 │
└───────────────────────────────────────────────────────────────────────────┘
            │ (mesmos jobs já existentes da CI upstream, reaproveitados)
┌─ 2. TESTE / VALIDAÇÃO ────────────────────────────────────────────────────┐
│  rush validate (SUCCESS) · jest · svelte-check · format check             │
│  gitleaks (sem segredo no diff) · checagem "schema mudou? migration?"     │
│  (opcional) subset Playwright smoke                                        │
└───────────────────────────────────────────────────────────────────────────┘
┌─ 3. DEPLOY (SSH → VPS, manual/approval no início) ────────────────────────┐
│  grava IMAGE_TAG=<sha> → docker-compose pull → up -d --no-deps            │
│  guarda IMAGE_TAG anterior p/ rollback · aplica nginx se mudou            │
└───────────────────────────────────────────────────────────────────────────┘
┌─ 4. VERIFICAÇÃO PÓS-DEPLOY (health-gate + rollback) ──────────────────────┐
│  curl /api/v1/version  (== sha esperado) · /api/v1/health == healthy      │
│  front 200 · account 200 · smoke F01/F02/F04/F09                          │
│  FALHOU → re-pull IMAGE_TAG anterior + up -d → alerta                     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Para suportar tags parametrizadas** sem reescrever o compose, criar um `docker-compose.registry.yaml` (override) trocando `image: hardcoreeng/<pod>:3f-local` por `image: ghcr.io/3f-tech/huly-3f/<pod>:${IMAGE_TAG:-latest}` e subir com `-f docker-compose.vps.yaml -f docker-compose.registry.yaml`.

> **Nota de custo (R2):** a build do monorepo é pesada. Runner GitHub free (2 vCPU/7 GB, 2000 min/mês no org privado) compila, mas devagar. Se virar gargalo, **runner self-hosted na própria VPS/uma VM de build** ou *larger runners* resolvem — e ainda assim a VPS deixa de compilar (só `pull`).

### 9. Exemplo de workflow (GitHub Actions) — adaptado ao stack

> Esboço para discussão (não aplicar ainda). Assume GHCR + um `docker-compose.registry.yaml` + segredos configurados (ver ponto 10).

```yaml
# .github/workflows/deploy.yml
name: build-and-deploy
on:
  push: { branches: [develop] }     # build sempre; deploy só com aprovação
  workflow_dispatch:
    inputs:
      deploy: { description: "Fazer deploy na VPS?", type: boolean, default: false }
      rollback_to: { description: "(rollback) SHA da imagem p/ voltar", default: "" }

permissions: { contents: read, packages: write }
env:
  REGISTRY: ghcr.io/3f-tech/huly-3f
  PODS: "server front account collaborator workspace worker fulltext github mail calendar datalake preview"

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: '' }   # cache do Rush abaixo
      - name: Cache Rush/pnpm
        uses: actions/cache@v4
        with:
          path: |
            common/temp/pnpm-store
            common/temp/build-cache
          key: rush-${{ hashFiles('common/config/rush/pnpm-lock.yaml') }}
      - run: node common/scripts/install-run-rush.js install
      - run: node common/scripts/install-run-rush.js build
      - run: node common/scripts/install-run-rush.js validate     # GATE TS (ponto 11)
      - run: node common/scripts/install-run-rush.js test          # GATE jest
      - name: Webpack (front)
        working-directory: dev/prod
        run: WEBPACK_MINIMIZE=true NODE_OPTIONS=--max-old-space-size=6144 \
             ./node_modules/.bin/cross-env NODE_ENV=production ./node_modules/.bin/webpack
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - name: Bundle + build + push por pod
        run: |
          set -euo pipefail
          SHA="${GITHUB_SHA::12}"
          for pod in $PODS; do
            ./scripts/ci-bundle.sh "$pod"          # (extrai a lógica de bundle/copy do 3f-build.sh)
            dir=$(./scripts/pod-dir.sh "$pod")      # ex.: pods/server, services/worker
            docker build -t "$REGISTRY/$pod:$SHA" -t "$REGISTRY/$pod:develop" "$dir"
            docker push "$REGISTRY/$pod:$SHA"
            docker push "$REGISTRY/$pod:develop"
          done
          echo "image_tag=$SHA" >> "$GITHUB_OUTPUT"
    outputs: { image_tag: ${{ steps.build.outputs.image_tag }} }

  deploy:
    needs: build
    if: ${{ github.event.inputs.deploy == 'true' || github.ref == 'refs/heads/develop' }}
    runs-on: ubuntu-latest
    environment: production            # exige aprovação manual (ponto 12)
    steps:
      - name: Deploy via SSH (pull + up + health-gate + rollback)
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          command_timeout: 30m
          script: |
            set -euo pipefail
            cd /opt/apps/os-tasks
            TAG="${{ inputs.rollback_to != '' && inputs.rollback_to || needs.build.outputs.image_tag }}"
            PREV=$(cat .deploy/current_tag 2>/dev/null || echo "")
            echo "IMAGE_TAG=$TAG" > .env.deploy
            git pull --ff-only
            export $(cat .env.deploy)
            docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml pull
            docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml up -d
            # ---- health-gate (verificação pós-deploy) ----
            ok=0
            for i in $(seq 1 30); do
              v=$(curl -fsS https://3ftasks.3fventure.tech:3332/api/v1/version || true)
              h=$(curl -fsS https://3ftasks.3fventure.tech:3332/api/v1/health  || true)
              f=$(curl -fsS -o /dev/null -w '%{http_code}' https://3ftasks.3fventure.tech || true)
              if [ "$h" = "healthy" ] && [ "$f" = "200" ]; then ok=1; break; fi
              sleep 10
            done
            if [ "$ok" != "1" ]; then
              echo "HEALTH FALHOU → rollback para $PREV"
              [ -n "$PREV" ] && { echo "IMAGE_TAG=$PREV" > .env.deploy; export $(cat .env.deploy); \
                docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml up -d; }
              exit 1
            fi
            echo "$TAG" > .deploy/current_tag
            date -u +"%Y-%m-%dT%H:%M:%SZ $TAG OK" >> .deploy/history.log   # base p/ métricas (ponto 13)
```

> **Observação importante:** a tag-SHA imutável **é** o alvo de rollback que hoje não existe (R1). `inputs.rollback_to` permite reverter para qualquer SHA já publicado **sem rebuild**.

### 10. Segredos no pipeline (sem expor nada)

- **Segredos de runtime (Google/LiveKit/GitHub/SMTP/3F Core) NÃO entram no CI.** Eles ficam só em `dev/.env.secrets` **na VPS** (já é o modelo atual e é o de menor superfície). O CI nunca os vê.
- **Segredos que o CI precisa** → **GitHub Secrets** (org/repo) ou *Environments*:
  - `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (chave dedicada de **deploy**, não a pessoal; idealmente um usuário `deployer` com sudo restrito, não `root`).
  - GHCR usa o `GITHUB_TOKEN` automático (`packages: write`) — zero segredo extra.
- **`gitleaks`/`trufflehog` como gate** no PR para impedir que segredo entre no diff.
- **Hardening de fundo (núcleo, fora do pipeline):** ✅ `SERVER_SECRET` já trocado (2026-07-09, agora `${SERVER_SECRET}` forte vindo de `dev/.env`); ainda pendente: subir Cockroach com TLS/usuário; trocar `minioadmin`. Mascarar tudo no log do Actions (`add-mask`).
- **Tirar `dev/.env` do versionamento** (descomentar `.env` no `.gitignore`, `git rm --cached dev/.env`, e versionar só `dev/.env.example`).

### 11. Definition of Done — "pronto pra deploy" (gates do pipeline)

- [ ] `rush validate` → **SUCCESS** em todos os pacotes alterados (gate de tipos)
- [ ] `rush test` (jest) verde · `svelte-check` sem erro · `format` sem diff
- [ ] `gitleaks` sem segredo no diff
- [ ] **Schema mudou? → migration presente** (`tryMigrate`/`tryUpgrade` com `state` único) **e** decisão de bump de `version.txt` registrada no PR
- [ ] Imagens buildadas e **pushadas por SHA** no GHCR (todas as dos pods alterados)
- [ ] Pós-deploy: `/api/v1/health == healthy`, `/api/v1/version == SHA esperado`, front 200, account 200
- [ ] **Smoke de regressão** (do próprio `CLAUDE.md`): F01 (bloqueio sem spent time), F02 (tag adiciona ao projeto), F04 (campo PDCA salva), F09 (campos de cliente aparecem)
- [ ] Rollback testado/possível (SHA anterior disponível no registry)
- [ ] `nginx -t` ok se `3ftasks.conf` mudou

---

## (d) Plano em fases (~2 meses) — 🟩 núcleo / 🟦 extra

**Fase 0 — Higiene e segurança (semana 1) 🟩**
- Tirar `dev/.env` do git; rotacionar `SERVER_SECRET`; documentar/automatizar renovação do Let's Encrypt (`certbot renew` via systemd-timer). Pinar `minio`/`livekit`. Corrigir tag do `worker`.
- Atualizar `BUILD_AND_DEPLOY.md` (0.7.344→0.7.359) — fonte única de verdade. ✅ feito.

**Fase 1 — Tornar o manual seguro e repetível, com rollback (semanas 2–3) 🟩**
- `deploy.sh` na VPS que: snapshot `docker tag <pod>:3f-local <pod>:rollback` **antes** de buildar → `git pull` → build → **health-gate** (`/api/v1/health`) → **restaura `:rollback` se falhar** → grava `.deploy/history.log`. (Dá rollback **sem** registry ainda.)
- Ativar a CI upstream como **gate de PR obrigatório** em `develop` (já roda; só exigir no branch protection). DoD do ponto 11 vira checklist do PR.

**Fase 2 — Registry + build no CI (semanas 4–6) 🟩**
- GHCR + `docker-compose.registry.yaml` + tags por SHA. CI buildá e pusha; VPS passa a `pull` + `up` (acaba o build-in-place, R2). Rollback = re-pull do SHA anterior.

**Fase 3 — CD com health-gate e rollback automático (semanas 6–7) 🟩**
- Workflow `deploy.yml` (ponto 9) com `environment: production` (aprovação manual de 2 pessoas). Smoke F01/F02/F04/F09 automatizado (Playwright a partir dos `tests.md` de `3f-docs/features/`).

**Fase 4 — Resiliência e ambientes (semana 8) 🟦/🟩**
- 🟩 **Backup off-site** (sync do bucket MinIO para storage externo) + **teste de restore documentado** (R5).
- 🟦 **Staging** (workspace/compose separado) p/ validar migrations antes da prod (R9).
- 🟦 Observabilidade leve (Sentry no front/account, ou OTEL→Grafana Cloud free) + alerta de disco (o incidente do Jaeger).

### 12. Para mais de uma pessoa conseguir deployar

- **Runbook único e versionado** (consolidar `BUILD_AND_DEPLOY.md` + `handoff_claude.md` em um, marcando o fluxo canônico).
- **Acesso compartilhado controlado:** usuário `deployer` na VPS com chaves por pessoa (não compartilhar a chave de `root`); registrar quem tem acesso.
- **Deploy pela UI do GitHub Actions** (`workflow_dispatch` + `environment` com aprovação) → qualquer pessoa autorizada deploya/rollback **sem SSH e sem buildar local**. É o maior destravador do bus factor.
- Segredos da VPS documentados em **um local** (ex.: gerenciador de segredos do time) com o `.env.secrets.example` como índice.

### 13. Métricas (DORA) — o que dá pra medir aqui e como

| Métrica | Como coletar com o que existe |
|---|---|
| **Frequência de deploy** | Contar entradas em `.deploy/history.log` (Fase 1) ou *runs* do job `deploy` / GitHub **Deployments API** (Fase 3). |
| **Lead time (commit→prod)** | `timestamp do deploy` − `git show -s --format=%cI <sha>` do SHA implantado (o `history.log` guarda o SHA). |
| **Change failure rate** | nº de deploys que dispararam rollback ou hotfix em <24h ÷ total (flag no `history.log`). |
| **MTTR** | Δt entre deploy falho (health-gate vermelho) e o deploy/rollback que restaura `healthy` (timestamps do log). |

Baseline antes/depois: começar o `history.log` **já na Fase 1** dá a linha de base manual; a Fase 3 passa a alimentar tudo automaticamente via Actions.

---

## Perguntas em aberto (não dá pra descobrir só pelo código)

1. **Onde a produção roda?** Provedor e **IP/hostname** da VPS (o repo só tem `root@VPS_IP` e o domínio). Specs reais (cores/RAM/disco — o compose sugere **2 cores**; relevante p/ decidir build no CI vs self-hosted).
2. **Modelo de acesso SSH:** hoje é só `root`? Quem tem chave? Pode existir um usuário `deployer`?
3. **A 3F Core (`3f-core.3fventure.tech`) roda na mesma VPS?** (há indício, não confirmação.) Compartilha recursos/disco?
4. **DNS:** registrador/provedor de `3fventure.tech` (p/ automatizar cert/registros).
5. **Renovação do Let's Encrypt:** existe `certbot renew` agendado, ou é manual?
6. **Existe ambiente de staging** ou tudo vai direto pra prod?
7. **Backups:** há cópia off-site hoje? Restore já foi testado alguma vez? Qual retenção/RPO/RTO aceitável?
8. **Janela de manutenção / downtime aceitável** para deploys (define se precisamos de zero-downtime).
9. **Org `3F-Tech` no GitHub:** plano (minutos de Actions disponíveis) e se GHCR está liberado para uso privado.
10. **Quem, além do Pedro, deve poder deployar/aprovar?** (define os aprovadores do `environment: production`.)

---

## Próximos passos sugeridos (ainda sem aplicar nada em produção)

- **(i)** Escrever o `deploy.sh` da Fase 1 com rollback por `docker tag` (sem registry).
- **(ii)** Rascunhar o `docker-compose.registry.yaml` + workflow `deploy.yml` completos.
- **(iii)** Montar o runbook consolidado de deploy (substitui `BUILD_AND_DEPLOY.md` + `handoff_claude.md`).
