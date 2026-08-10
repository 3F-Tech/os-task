---
title: Build e Deploy — 3F Tasks
audience: desenvolvedores da 3F Tasks
summary: >
  Como rodar o projeto localmente e como publicar mudanças em produção pela
  esteira de CI/CD (build no GitHub Actions → imagens no GHCR → deploy por botão).
  Este é o método atual. O build-in-place antigo na VPS foi aposentado.
when_to_use: >
  Consulte este documento sempre que precisar (a) montar/atualizar o projeto na
  sua máquina, (b) publicar uma correção ou feature em produção, (c) reverter um
  deploy, ou (d) aplicar uma mudança que altera o modelo de dados (migration).
---

# Build e Deploy — 3F Tasks

> **Como funciona, em uma frase:** todo push na `develop` builda as imagens dos
> pods afetados no **GitHub Actions** e publica no **GHCR**
> (`ghcr.io/3f-tech/os-task/<pod>`); o deploy em produção é feito por **um botão**
> no GitHub (workflow *3F Deploy (GHCR → VPS)*), que puxa a imagem já pronta,
> troca o pod na VPS, verifica e registra no `CHANGELOG.md`.
>
> O build **não** roda mais na VPS. A VPS só baixa a imagem pronta e reinicia o
> container. Isso vale para os **11 pods que nós buildamos** (lista na
> [Referência rápida](#referência-rápida)); serviços de dado e de infraestrutura
> **nunca** são tocados pela esteira.

Índice:
- [1. Rodar o projeto localmente](#1-rodar-o-projeto-localmente)
- [2. Publicar uma mudança em produção (o fluxo normal)](#2-publicar-uma-mudança-em-produção-o-fluxo-normal)
- [3. Confirmar que o deploy deu certo](#3-confirmar-que-o-deploy-deu-certo)
- [4. Rollback (se algo der errado)](#4-rollback-se-algo-der-errado)
- [5. Caso especial: migration / bump de MODEL_VERSION](#5-caso-especial-migration--bump-de-model_version)
- [Referência rápida](#referência-rápida)

---

## 1. Rodar o projeto localmente

O build local continua sendo o **`3f-build.sh`** (roda na sua máquina, sobe o
`dev/docker-compose.yaml` local — **não** o de produção). Ele compila o
monorepo, empacota os pods, builda as imagens `:3f-local` e reinicia os
containers locais.

### 1.1 Primeira vez (setup do zero)

> Faça isto **uma vez** por máquina. Depois, o dia a dia é só a
> [§1.2](#12-atualizar-o-local-conforme-você-mexe-no-código). Todo o build local
> roda na sua máquina e é **isolado da produção**.

**Pré-requisitos**

| Ferramenta | Versão | Como obter |
|---|---|---|
| Node.js | 20+ (o repo fixa **v22** no `.nvmrc`; o Rush aceita `>=20 <25`) | `nvm install 22 && nvm use 22` |
| Rush | 5.158.1 (fixado via *version selector* no `rush.json`; o global se auto-ajusta) | `npm install -g @microsoft/rush` |
| pnpm | 10.15.1 — **gerenciado pelo Rush, não instale à mão** | (vem com o `rush install`) |
| Docker + Compose v2 | — | `docker compose version` tem que responder |
| Bash | `3f-build.sh` é um script bash | no Windows, rode via **Git Bash** ou WSL |

> **Regra de ouro:** nunca `pnpm install` — sempre `rush install`. O registro de
> pacotes é o npm público (`common/config/rush/.npmrc`), então **não** é preciso
> logar no GitHub Packages para instalar (ignore a seção de auth do `README.md`
> upstream — não se aplica a este fork).

**1. Clonar e instalar as dependências**

```bash
git clone <url-do-repo> huly-3f && cd huly-3f
rush install
```

**2. Criar os arquivos de ambiente locais** — todos ficam em `dev/`, todos são
git-ignored; crie a partir dos `.example`:

```bash
cp dev/.env.example         dev/.env
cp dev/.env.secrets.example dev/.env.secrets
cp dev/.env.github.example  dev/.env.github
```

| Arquivo | Para que serve | Precisa existir p/ subir o stack? |
|---|---|---|
| `dev/.env` | valores interpolados no compose (`${DB_CR_URL}`, `${STORAGE_CONFIG}`, `${QUEUE_CONFIG}`…) | **sim** — o Compose lê o `.env` da **pasta do compose** (`dev/`), não o da raiz |
| `dev/.env.secrets` | segredos injetados em `account` e `mail` via `env_file` | **sim** (mesmo vazio) |
| `dev/.env.github` | segredos do GitHub App, injetados em `github` via `env_file` | sim, **se** for subir o pod `github` |

No **`dev/.env`**, os defaults do exemplo já servem para local; ajuste só:

```bash
# Cockroach local sobe como --insecure single-node → use o usuário root, sem senha:
DB_CR_URL=postgresql://root@cockroach:26257/defaultdb?sslmode=disable
# seu e-mail com privilégio de admin da plataforma:
PLATFORM_ADMIN_EMAILS=voce@3fventure.com.br
```

Os demais (`STORAGE_CONFIG=datalake|http://datalake:4030`,
`QUEUE_CONFIG=redpanda:9092`, `BACKUP_*` com `minioadmin`/`minioadmin`,
`MONGO_URL`, `DB_URL_PG`, `POLAR_*`) podem ficar como vieram — o stack Cockroach
local não usa Mongo/PG/Polar.

O **`dev/.env.secrets`** pode ficar **em branco** só para subir e navegar (o
arquivo só precisa *existir*). Preencha depois, por feature — cada bloco do
`.example` explica como gerar a credencial: Gmail SMTP (envio de
e-mail/digest/notificações), `Credentials` (Google OAuth → calendar), `GITHUB_*`
(integração GitHub), `THREEF_CORE_API_KEY` (login universal 3F Core, F11).

**3. Buildar as imagens locais dos pods** — passo pesado (o webpack do front leva
5–15 min e o terminal fica quieto):

```bash
# na raiz do repo, no Git Bash:
./3f-build.sh --pod "server front account collaborator workspace datalake mail"
```

Isso compila o monorepo (`rush build`), roda o webpack, empacota os pods, builda
as imagens `hardcoreeng/<pod>:3f-local` e já reinicia esses containers. Na
**primeira vez**, liste esses 7 pods: são exatamente os que o compose local serve
como `:3f-local` — e o `datalake` e o `mail` **não** entram na lista padrão do
`3f-build.sh`. (Acrescente `github` se for usar a integração — exige o
`dev/.env.github` preenchido.) Os pods `fulltext` e `time-machine`/`worker`
rodam a imagem **upstream** do Docker Hub no ambiente local, então **não**
precisam de build local.

**4. Subir o stack inteiro** — os containers de dado e de infraestrutura
(Cockroach, Redpanda, MinIO, Elasticsearch, Redis, `stats`, `jaeger`, `rekoni`…)
são imagens públicas, **não** são buildados; o Compose baixa e sobe:

```bash
docker compose -f dev/docker-compose.yaml up -d
```

> **Ordem de subida:** você **não** sequencia "dado antes de app" à mão — o
> Compose resolve pelo `depends_on` + healthchecks (Cockroach/Redpanda/MinIO/
> Elastic primeiro, depois os pods). O `3f-build.sh` reinicia **só** os pods
> (`--no-deps`), assumindo que a camada de dado já está de pé; por isso, no
> primeiro boot, rode este `up -d` completo uma vez. Nos boots seguintes, o
> `3f-build.sh` sozinho já basta.

**5. Verificar o boot**

```bash
docker compose -f dev/docker-compose.yaml ps          # tudo Up / healthy?
docker logs dev-transactor_cockroach-1 2>&1 | grep -E "ERROR|NoLocation|not found" | head
docker logs dev-front-1                2>&1 | grep -E "ERROR|error" | head
```

**6. Acessar** → **http://localhost:8087** (o `front` publica `8087→8080`; é a URL
que o `3f-build.sh` imprime no fim).

> **Login no primeiro acesso.** O `account` local sobe com `DISABLE_SIGNUP=true`
> e `THREEF_CORE_ENABLED=true` (login universal F11 → a senha é validada na 3F
> Core). Para um sandbox local **sem** depender da 3F Core, edite o serviço
> `account` em `dev/docker-compose.yaml` para `THREEF_CORE_ENABLED=false` +
> `DISABLE_SIGNUP=false`, rode `./3f-build.sh --pod account`, e cadastre por
> e-mail/senha. Contas em `PLATFORM_ADMIN_EMAILS`/`ADMIN_EMAILS` têm bypass de admin.

> Para **iterar em UI com hot reload** (sem rebuildar Docker a cada mudança),
> suba o dev-server do webpack: `cd dev/prod && rushx dev-server` →
> **http://localhost:8080** (proxia API/WebSocket para o Docker em `:8087`).
> Detalhes em **`3f-docs/desenvolvimento.md`**.

### 1.2 Atualizar o local conforme você mexe no código

Depois do setup inicial, para ver suas mudanças rodando localmente:

```bash
# na raiz do repo, na sua máquina:

# rebuilda só o(s) pod(s) que você mexeu (mais rápido):
./3f-build.sh --pod front              # ex.: mexeu no frontend
./3f-build.sh --skip-webpack --pod server   # ex.: mexeu só no backend

# ou o build local completo (quando na dúvida do que mudou):
./3f-build.sh
```

Consulte o mapa **arquivo alterado → pod** no `CLAUDE.md` para saber qual `--pod`
usar. O `3f-build.sh --help` lista todas as flags.

> **Importante — seu ambiente local é isolado da produção.** O que acontece na
> sua máquina (bump de versão local, banco local dessincronizado, testes) **não**
> vai para produção: a esteira builda a imagem de produção a partir do **commit
> limpo na `develop`**, numa máquina zerada do GitHub, não do seu Docker local.
> Por isso, ao commitar, **envie só o que é a mudança de fato** (veja
> [2.1](#21-antes-de-tudo-commite-só-a-mudança)).

---

## 2. Publicar uma mudança em produção (o fluxo normal)

Este é o caminho de **99% dos deploys**: uma correção ou feature que **não muda o
modelo de dados**. Para mudanças que alteram o modelo (migration), veja a
[seção 5](#5-caso-especial-migration--bump-de-model_version).

### 2.1 Antes de tudo: commite só a mudança

A esteira builda a imagem de produção a partir do commit na `develop`. Então o
commit tem que conter **exatamente** a sua mudança — nada de arquivos de ambiente
local ou segredos.

```bash
# confira o que mudou:
git status

# adicione SÓ os arquivos da sua mudança, por nome (NUNCA git add . / git add -A):
git add caminho/do/seu/arquivo.ext

# confirme que NÃO entrou nada indevido:
git status
```

**Nunca commite:**
- `common/scripts/version.txt` — a menos que a mudança **exija** migration (seção 5). Um bump acidental transforma um deploy simples num upgrade de modelo da frota inteira.
- `.claude/settings.local.json`, `dev/.env`, `dev/.env.secrets`, `deploy_key*` — config/segredos locais. **Nunca** use `git add .` ou `git add -A` (arrasta esses arquivos).

```bash
git commit -m "fix(escopo): descrição curta do que foi corrigido"
git push origin develop
```

### 2.2 Deixe a esteira buildar a imagem

O push dispara o workflow **3F Build (GHCR)** automaticamente.

1. Vá em **GitHub → aba Actions → 3F Build (GHCR)** e acompanhe o run do seu commit.
2. A esteira detecta quais pods a sua mudança afeta (pelo mapa arquivo→pod) e builda **só esses**. Aguarde ficar **verde**.
3. Anote o **SHA do commit** (aparece no run). É o que você vai deployar.
4. (Opcional) Confirme em **GitHub → org 3F-Tech → Packages** que a imagem `os-task/<pod>` ganhou a tag do seu commit.

> Se o build detectar **frota inteira (11 pods)** para uma mudança pequena, é um
> sinal de alerta: provavelmente `common/scripts/version.txt` ou algo em
> `common/` entrou no commit sem querer. Confira antes de deployar.

### 2.3 Atualize o repositório da VPS

O deploy usa os arquivos de compose que estão na VPS, então ela precisa estar com
o commit atual:

```bash
ssh <você>@<vps>
cd /opt/apps/os-tasks
git pull
```

> Se o `git pull` reclamar de *"local changes would be overwritten"* em
> `common/config/rush/pnpm-lock.yaml`, descarte a versão local (a correta vem do
> commit): `git checkout -- common/config/rush/pnpm-lock.yaml` e repita o
> `git pull`. O `dev/.env` aparece como *untracked* — isso é esperado, **não
> mexa nele** (contém o `SERVER_SECRET`).

### 2.4 Aperte o botão

1. **GitHub → aba Actions → 3F Deploy (GHCR → VPS) → Run workflow.**
2. Preencha:
   - **Branch:** `develop`
   - **sha:** o SHA do commit (passo 2.2) — 7 ou 12 caracteres, a esteira expande.
   - **pods:** o(s) pod(s) afetado(s), separados por espaço (ex.: `front`), ou `all`.
3. **Run workflow.**

O workflow valida os nomes (recusa qualquer serviço fora dos 11 permitidos),
confirma que a imagem existe no GHCR, conecta na VPS, puxa a imagem, troca o pod
(`up -d --no-deps`), verifica e registra no `CHANGELOG.md`. **Não há rollback
automático** — se a verificação falhar, o job fica **vermelho** e imprime o
comando de rollback no log.

---

## 3. Confirmar que o deploy deu certo

1. **No run do GitHub:** o job termina **verde**, e o step *Deploy to VPS* mostra
   `✅ <pod> OK` com `IMG=ghcr.io/3f-tech/os-task/<pod>:<sha>` e `STATUS=running`.
2. **No CHANGELOG:** o deploy se registra sozinho. Confira:
   ```bash
   cd /opt/apps/os-tasks && git pull && tail -3 CHANGELOG.md
   ```
   Deve ter uma linha como `deploy <sha> → [<pods>] — ✅ sucesso`.
3. **Na VPS**, confirme que o container roda a imagem do GHCR:
   ```bash
   cd /opt/apps/os-tasks
   SVC=front   # nome do SERVIÇO (ver tabela na Referência); ex.: front, transactor_cockroach...
   docker inspect $(docker compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml ps -q $SVC) \
     --format 'IMG={{.Config.Image}}  STATUS={{.State.Status}}  RESTARTS={{.RestartCount}}'
   ```
4. **No navegador:** abra `https://3ftasks.3fventure.tech`, dê um refresh forte
   (Ctrl+Shift+R, para não pegar bundle em cache) e **confirme a mudança de fato**
   — a verificação automática só prova que o pod subiu, não que o comportamento
   esperado está lá. Isso só uma pessoa confirma.

---

## 4. Rollback (se algo der errado)

A imagem `:3f-local` anterior **permanece na VPS**, então voltar é imediato. O
truque: rodar **sem** o override de registry — o compose base resolve a imagem
`:3f-local`.

```bash
cd /opt/apps/os-tasks
SVC=front   # o serviço que você quer reverter
docker compose -f dev/docker-compose.vps.yaml rm -sf "$SVC"
docker compose -f dev/docker-compose.vps.yaml up -d --no-deps "$SVC"

# confirmar que voltou:
docker inspect $(docker compose -f dev/docker-compose.vps.yaml ps -q "$SVC") \
  --format 'IMG={{.Config.Image}}  STATUS={{.State.Status}}'
# esperado: IMG=hardcoreeng/<pod>:3f-local  STATUS=running
```

> ⚠️ **Rollback do grupo do model é diferente.** Reverter `server`, `workspace`,
> `fulltext` ou `worker` para uma versão de modelo **anterior** depois que uma
> migration já rodou **quebra o sistema** (o código antigo não conversa com o
> banco já migrado). Para esses pods, rollback não é "voltar a imagem" — é o
> procedimento coordenado da [seção 5](#5-caso-especial-migration--bump-de-model_version).

---

## 5. Caso especial: migration / bump de MODEL_VERSION

> 🚧 **Procedimento planejado, ainda NÃO exercitado em produção.** Leia inteiro e,
> na primeira vez, faça em janela de baixo uso e com backup. O `deploy.yml`
> **bloqueia** deploy pelo botão quando detecta bump de modelo — isso é
> proposital, para forçar este fluxo coordenado.

### Quando isto se aplica

Quando a sua mudança **altera o modelo de dados** (schema) e por isso o
`common/scripts/version.txt` (o `MODEL_VERSION`) precisa subir. Nesse caso o
`version.txt` **deve** ir no commit, junto com a mudança de schema — aqui ele é
intencional, não resíduo.

### Por que é diferente

- O `MODEL_VERSION` fica **embutido no bundle** de cada pod que carrega o modelo,
  então mudá-lo exige **rebuildar** as imagens (não basta env).
- Quatro pods embutem o modelo e **precisam ir juntos, na mesma versão**:
  **`server`, `workspace`, `fulltext`, `worker`** (o "grupo do modelo").
- O `workspace` roda as **migrations** no boot quando o `MODEL_VERSION` do código
  é maior que o do banco, e sinaliza `---UPGRADE-DONE---` no log ao terminar.
- O **transactor recusa conexões** enquanto o modelo dele for menor que o do banco
  (tela "Preparing workspace for new version"). Por isso **deploy parcial trava o
  sistema** — o grupo tem que subir coordenado.

### Passo a passo

1. **Commit:** inclua a mudança de schema **e** o `common/scripts/version.txt`
   bumpado no mesmo commit. Push na `develop`.
2. **Build:** o `build.yml` detecta o bump e builda a **frota inteira** (11 pods)
   no GHCR. Aguarde verde e anote o SHA.
3. **Backup antes de tocar na VPS:** snapshot da VPS (painel Hostinger) **e**
   backup do CockroachDB. Migration mexe em dados — não pule.
4. **Atualize a VPS:** `cd /opt/apps/os-tasks && git pull`.
5. **Suba o `workspace` PRIMEIRO** e espere a migration terminar:
   ```bash
   cd /opt/apps/os-tasks
   export IMAGE_TAG="<sha-de-12-chars>"
   DC="docker compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml"
   $DC pull workspace_cockroach
   $DC rm -sf workspace_cockroach && $DC up -d --no-deps workspace_cockroach
   # acompanhe até aparecer ---UPGRADE-DONE--- :
   $DC logs -f workspace_cockroach
   ```
6. **Só depois** do `---UPGRADE-DONE---`, suba os outros três do grupo (e os
   demais pods afetados), **todos na mesma tag**:
   ```bash
   for svc in transactor_cockroach fulltext_cockroach time-machine; do
     $DC pull "$svc"; $DC rm -sf "$svc"; $DC up -d --no-deps "$svc"
   done
   # depois os demais pods (front, account, etc.) normalmente
   ```
7. **Verifique** o transactor de pé (`curl -s localhost:13332/api/v1/health` → 200)
   e o site funcionando.

> Quando o cutover do grupo do modelo passar a rodar imagens do GHCR (em vez de
> `:3f-local`), o `migration guard` do `deploy.yml` conseguirá comparar as versões
> automaticamente e este procedimento poderá ser incorporado ao botão. Até lá, é
> manual.

---

## Referência rápida

### Os 11 pods que a esteira builda e deploya

`server` · `front` · `account` · `workspace` · `collaborator` · `fulltext` ·
`worker` · `preview` · `github` · `mail` · `calendar`

### Nome do POD (GHCR) × nome do SERVIÇO (compose)

A maioria é igual; **quatro divergem**:

| Pod (no botão / GHCR) | Serviço (no docker compose) |
|---|---|
| `server` | `transactor_cockroach` |
| `workspace` | `workspace_cockroach` |
| `fulltext` | `fulltext_cockroach` |
| `worker` | `time-machine` |
| (os outros 7) | mesmo nome |

### Grupo do modelo (vão SEMPRE juntos em bump de versão)

`server` · `workspace` · `fulltext` · `worker`

### O que a esteira NUNCA toca (serviços de dado e infraestrutura)

`cockroach` · `minio` · `redpanda` · `elastic` · `redis` · `hulykvs` ·
`livekit` · `livekit-egress` · e os upstream pinados (`datalake`, `stats`,
`rekoni`, `print`, `sign`, `analytics`, `export`, `love`, `hulypulse`,
`backup-cockroach`). O `deploy.yml` recusa qualquer um destes.

### Comandos-chave (na VPS, a partir de `/opt/apps/os-tasks`)

| Ação | Comando |
|---|---|
| Base + override (deploy/verify) | `docker compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml …` |
| Só base (rollback p/ `:3f-local`) | `docker compose -f dev/docker-compose.vps.yaml …` |
| Ver imagem que um serviço roda | `docker inspect $(… ps -q <serviço>) --format '{{.Config.Image}} {{.State.Status}}'` |
| Histórico de deploys | `tail CHANGELOG.md` |

### Workflows (GitHub → aba Actions)

- **3F Build (GHCR)** — automático no push da `develop`; builda e publica no GHCR.
- **3F Deploy (GHCR → VPS)** — manual (*Run workflow*); deploya na VPS por SHA + pods.