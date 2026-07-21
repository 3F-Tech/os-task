# Teste da esteira — roteiro noturno (mail como cobaia)

> **Objetivo:** validar, com risco mínimo e à noite, que a VPS consegue puxar as
> imagens do **GHCR** (publicadas pela esteira `.github/workflows/build.yml`) em
> vez das `:3f-local` buildadas in-place. O **mail** é a cobaia (baixo blast
> radius). Nada de produção é tocado além do container do mail; a imagem
> `:3f-local` antiga permanece na VPS como rollback imediato.
>
> **Regras da noite** — valem para TODOS os passos:
> - **Nunca** `down`/`up` geral. Só `up -d --no-deps <serviço>`, um pod por vez.
> - **Nunca** tocar serviço de dado (cockroach, redpanda, minio, elastic, redis, hulykvs).
> - A imagem `hardcoreeng/<pod>:3f-local` antiga **fica na VPS** — é o rollback.
> - Comandos rodam a partir da **raiz do repositório** na VPS (ajuste o caminho
>   se o seu for diferente de `/opt/apps/os-tasks`), porque o compose v1 tira o
>   *project dir* do primeiro `-f` (`dev/`) e é de lá que carrega o `dev/.env`
>   (SERVER_SECRET etc.). Rodar de outro lugar quebra a interpolação.
> - Se a sua VPS usa **`docker compose`** (v2, espaço) em vez de `docker-compose`
>   (v1, hífen), troque o binário — o resto é idêntico.

---

## ⚠️ Antes de mais nada: a tag do GHCR tem 12 caracteres, não 7

A esteira publica a tag imutável como `${GITHUB_SHA:0:12}` (**12 chars** hex —
ver `build.yml`). O `bc8614c` que você anotou é o **short-SHA do git (7 chars)**.
A tag real no GHCR é a expansão dele para 12 chars. O roteiro expande
automaticamente (`git rev-parse bc8614c | cut -c1-12`) e **confere que a tag
existe no GHCR antes de baixar** — se você digitar a tag errada, o `pull` falha
na hora e nada é deployado (falha segura).

Além da tag imutável, a esteira também move a tag `develop` para o último build.

> **Aviso de escopo:** a imagem do GHCR em `bc8614c` é o build de `develop@bc8614c`,
> que **pode não ser byte-a-byte o mesmo código** que hoje roda como `:3f-local` na
> VPS. Para o **mail** isso é irrelevante (é justamente o que queremos testar).
> Para os pods pesados (transactor/workspace/front) trocar a imagem é um **deploy
> de código de verdade** — e, se `common/scripts/version.txt` mudou entre o
> `:3f-local` rodando e `bc8614c`, vira um **upgrade de modelo coordenado** (ver
> §6, não é o teste desta noite).

---

## Pré-requisitos (uma vez, no começo da noite)

```bash
cd /opt/apps/os-tasks                      # raiz do repo na VPS (ajuste se preciso)

# 1) trazer o override + o commit bc8614c para o git local
git pull

# 2) o override existe?
ls -l dev/docker-compose.registry.yaml

# 3) o login no GHCR está ativo? (deve listar "ghcr.io" em auths)
grep -A2 'ghcr.io' ~/.docker/config.json || echo "!! faça: docker login ghcr.io"

# 4) a imagem de rollback do mail existe localmente? (é o plano B)
docker images hardcoreeng/mail:3f-local
#   -> tem que listar UMA linha. Se não listar, PARE: não há rollback local.
```

---

## 1. Backup do CockroachDB (faça primeiro, antes de qualquer troca)

Backup lógico **completo e consistente**, feature *core* do CockroachDB (não
precisa de licença enterprise para um full backup único). Escreve na pasta
`extern` do store, que é bind-mount → aparece no disco do host.

```bash
cd /opt/apps/os-tasks
TS=$(date +%Y%m%d-%H%M%S)

docker-compose -f dev/docker-compose.vps.yaml exec -T cockroach \
  ./cockroach sql --insecure --execute \
  "BACKUP INTO 'nodelocal://1/pre-esteira-$TS' AS OF SYSTEM TIME '-10s';"
```

**Onde o arquivo fica:** dentro do container em
`/cockroach/cockroach-data/extern/pre-esteira-<TS>/`, que no host é
`/opt/apps/os-tasks/data/cockroach/extern/pre-esteira-<TS>/` (uma pasta com
vários arquivos, não um arquivo único).

**Confirmar que o backup é válido (conteúdo > 0):**

```bash
# a) o cockroach enxerga o backup na coleção:
docker-compose -f dev/docker-compose.vps.yaml exec -T cockroach \
  ./cockroach sql --insecure --execute "SHOW BACKUPS IN 'nodelocal://1/';"
#   -> deve listar /pre-esteira-<TS>

# b) os arquivos existem no disco e somam > 0 bytes:
sudo du -sh  /opt/apps/os-tasks/data/cockroach/extern/pre-esteira-$TS
sudo find    /opt/apps/os-tasks/data/cockroach/extern/pre-esteira-$TS -type f | head
#   -> du deve mostrar algo tipo "12M ..." (NUNCA 0); find deve listar arquivos.
```

**Levar para fora do disco (recomendado — o backup fica no MESMO NVMe dos dados;
ver INFRA §2.3):** empacote num arquivo único e copie para outra máquina.

```bash
sudo tar czf /opt/apps/os-tasks/cockroach-backup-$TS.tgz \
  -C /opt/apps/os-tasks/data/cockroach/extern pre-esteira-$TS
ls -lh /opt/apps/os-tasks/cockroach-backup-$TS.tgz      # tamanho > 0
# depois, do seu laptop:  scp usuario@vps:/opt/apps/os-tasks/cockroach-backup-$TS.tgz .
```

> **Restaurar (1 linha, se precisar):** num cluster **vazio**,
> `RESTORE FROM LATEST IN 'nodelocal://1/pre-esteira-<TS>';` (restore de cluster
> inteiro exige cluster limpo; para recuperar só uma tabela use
> `RESTORE TABLE <db>.<tabela> FROM LATEST IN 'nodelocal://1/pre-esteira-<TS>';`).
> Como reforço de disaster-recovery, tire também um **snapshot pelo painel da
> Hostinger** antes da sessão.

---

## 2. Pull do mail (zero downtime — só baixa, não sobe nada)

```bash
cd /opt/apps/os-tasks

# expande o short-SHA de 7 -> 12 chars (a tag REAL publicada no GHCR):
export IMAGE_TAG="$(git rev-parse bc8614c | cut -c1-12)"
echo "tag GHCR = $IMAGE_TAG"

# confere que a tag existe no GHCR SEM baixar layers (usa o docker login):
docker manifest inspect ghcr.io/3f-tech/os-task/mail:$IMAGE_TAG >/dev/null \
  && echo "OK: tag existe no GHCR" \
  || { echo "ERRO: tag não existe no GHCR — confira o valor de IMAGE_TAG"; }

# baixa SÓ a imagem do mail (nenhum container é criado/reiniciado):
docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml pull mail
```

**Confirmar que baixou:**

```bash
docker images ghcr.io/3f-tech/os-task/mail
#   -> deve listar a linha com a TAG = <IMAGE_TAG> e um tamanho > 0.
```

> Neste passo os containers **não** são tocados: o mail em produção segue rodando
> a `:3f-local`. Só criamos a imagem nova no cache local do Docker.

---

## 3. Subir SÓ o mail com a imagem do GHCR

`IMAGE_TAG` já está exportado do passo 2 (se abriu um shell novo, re-exporte). O
`rm` antes do `up` evita o bug `KeyError: 'ContainerConfig'` do docker-compose v1
ao recriar (documentado em BUILD_AND_DEPLOY §5.6). Blip de alguns segundos no
mail (stateless; no máximo se perde um e-mail em trânsito).

```bash
cd /opt/apps/os-tasks

docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml rm -sf mail
docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml up  -d --no-deps mail
```

---

## 4. Verificação (mail rodando a imagem do GHCR e saudável)

O mail **não tem healthcheck** (INFRA §2.1) — validamos por *image ref* + status
+ logs + um probe de liveness HTTP.

```bash
cd /opt/apps/os-tasks
MAILID=$(docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml ps -q mail)

# a) qual imagem o container está rodando + status:
docker inspect "$MAILID" --format 'IMG={{.Config.Image}}  STATUS={{.State.Status}}  RESTARTS={{.RestartCount}}'
#   ESPERADO: IMG=ghcr.io/3f-tech/os-task/mail:<IMAGE_TAG>  STATUS=running  RESTARTS=0

# b) logs recentes:
docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml logs --tail=50 mail

# c) probe de liveness (o servidor HTTP responde na 8092? qualquer status = vivo):
docker exec "$MAILID" node -e "require('http').get('http://localhost:8092/',r=>{console.log('mail HTTP status',r.statusCode);process.exit(0)}).on('error',e=>{console.log('ERRO',e.message);process.exit(1)})"
#   ESPERADO: "mail HTTP status 404" (o 404-handler prova que subiu). Qualquer
#   número = servidor no ar. "ERRO ..." = não subiu -> rollback (§5).
```

**Log normal vs erro de boot:**
- ✅ **Normal:** container `STATUS=running`, `RESTARTS=0`, logs com a linha de que
  subiu/está escutando na 8092, **sem** stack trace repetido.
- ❌ **Erro de boot:** `STATUS=restarting`/`exited`, `RestartCount` subindo, ou
  logs com exceção repetida (típico: credenciais SMTP ausentes vindas do
  `.env.secrets`, erro de `require`/módulo, crash no boot). → **Rollback (§5).**

**Teste funcional opcional** (só se quiser confirmar envio real): dispare uma
ação no app que mande e-mail (ex.: convite/notificação) e cheque nos logs do mail
a tentativa de envio. ⚠️ O mail **engole erros de envio** (loga e responde 200 —
INFRA §2.1), então "sem erro" nos logs não garante entrega; confirme na caixa.

---

## 5. 🔴 ROLLBACK do mail (se o teste falhar)

**Volta o mail para `hardcoreeng/mail:3f-local` — que continua na VPS.** O truque:
rodar **SEM** o `-f dev/docker-compose.registry.yaml`, então o compose resolve a
imagem `:3f-local` do arquivo base.

```bash
cd /opt/apps/os-tasks

docker-compose -f dev/docker-compose.vps.yaml rm -sf mail
docker-compose -f dev/docker-compose.vps.yaml up  -d --no-deps mail

# confirmar que voltou:
MAILID=$(docker-compose -f dev/docker-compose.vps.yaml ps -q mail)
docker inspect "$MAILID" --format 'IMG={{.Config.Image}}  STATUS={{.State.Status}}'
#   ESPERADO: IMG=hardcoreeng/mail:3f-local  STATUS=running
```

Rollback é instantâneo (a imagem já está local, nada a baixar). Depois, investigue
os logs com calma antes de tentar de novo.

---

## 6. Ordem segura para os DEMAIS pods (se o mail passar)

> Mesma disciplina do mail para **cada** pod: `pull` → `rm -sf` + `up -d --no-deps`
> → verificar (image ref + status + logs) → se falhar, rollback rodando **sem** o
> override. **Um pod por vez**, confirmando antes de ir para o próximo. `IMAGE_TAG`
> continua o mesmo `bc8614c` expandido.

**Ordem recomendada (do menor para o maior blast radius):**

1. ✅ **mail** — cobaia (feito).
2. **calendar** → **github** → **preview** — integrações de borda, baixo impacto.
   Avisos: `calendar` tem o incidente N+1 conhecido (um *restart* é ok; o problema
   é carga de sync, não o restart); `preview` recomputa thumbnails após subir
   (pico de CPU passageiro); `github` fica alguns segundos sem receber webhook.
3. **collaborator** — janela de baixo tráfego: `stop_grace_period: 60s`, pode
   perder ~10s de edição de description em docs sendo editados naquele instante.
4. **fulltext** — seguro (índice mora no elastic; *restart nunca reindexa*).
   Depois de subir, confirme que a **busca** ainda retorna resultados.
5. **worker (time-machine)** — reancora PDCA + digest no boot. Bônus: a esteira
   corrige a tag (o `3f-build.sh` publicava o worker **sem tag** → `:latest`, com
   risco de um `pull` trazer a imagem upstream por cima; ver INFRA §4.1).
6. **front** — voltado ao usuário. Rollback é instantâneo (imagem só serve o
   bundle), mas um bundle ruim = tela branca → faça em janela de baixo tráfego.
7. **account** — ⚠️ **SPOF nº 2**: quase tudo depende de `ACCOUNTS_URL`, e o
   **login universal (F11) está live** — um account ruim = ninguém loga. Suba,
   e **confirme login imediatamente**; mantenha o rollback à mão.
8. **transactor_cockroach (server)** — ⚠️ **disruptivo**: restart = *reconnect
   storm* (todos os clientes reconectam de uma vez, 1–3 min de hang). Janela de
   tráfego mínimo; **garanta CPU ociosa antes**; **nunca** reinicie em loop.
9. **workspace_cockroach** — ⚠️ **por último**: roda **migrations** no boot.

> 🚨 **Caso especial — bump de `MODEL_VERSION`.** Se `common/scripts/version.txt`
> mudou entre o `:3f-local` que roda hoje e o build `bc8614c`, os quatro pods que
> **embutem o model** (**server, workspace, fulltext, worker**) **NÃO são
> independentes**: precisam ir **juntos**, na mesma versão, com o **workspace
> primeiro** e esperando `---UPGRADE-DONE---` nos logs antes de trocar o resto —
> senão o transactor recusa conexões ("Preparing workspace for new version"). Isso
> é um **upgrade coordenado**, procedimento diferente do teste per-pod desta noite.
> Antes de encostar nesse grupo, cheque:
> `git show bc8614c:common/scripts/version.txt` vs o `version.txt` do código que
> está rodando. Igual → relocação simples (ordem acima). Diferente → pare e planeje
> o upgrade coordenado.

---

### Referência rápida de comandos

| Ação | Comando (da raiz do repo) |
|---|---|
| Base + override | `docker-compose -f dev/docker-compose.vps.yaml -f dev/docker-compose.registry.yaml …` |
| Só base (rollback) | `docker-compose -f dev/docker-compose.vps.yaml …` |
| Pull de 1 pod | `… pull <serviço>` |
| Subir 1 pod | `… rm -sf <serviço> && … up -d --no-deps <serviço>` |
| Ver imagem rodando | `docker inspect $(… ps -q <serviço>) --format '{{.Config.Image}} {{.State.Status}}'` |

Nomes de **serviço** (compose) ≠ nomes de **pod** (GHCR) para 4 deles:
`transactor_cockroach`=server, `workspace_cockroach`=workspace,
`fulltext_cockroach`=fulltext, `time-machine`=worker.
