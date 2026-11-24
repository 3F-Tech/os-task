# RUNBOOK — "Sistema carregando eternamente" (freeze/spinner)

> Runbook operacional para quando o 3F Tasks **trava** e usuários ficam no spinner
> ("carregando eternamente"). Escrito a partir do incidente de **2026-08-26**.
> **Dono do tema:** performance/disponibilidade do transactor. Relacionados:
> `3f-docs/INFRA.md` (mapa de containers) e as memórias `huly_unbounded_query_perf`,
> `planner_freeze_ratelimit`, `transactor_restart_reconnect_storm`.

---

## TL;DR

- **Causa confirmada (2026-08-26):** uma **requisição `tx` travou** no transactor e **entupiu a fila serializada do workspace grande** (`b001f439`, ~39 usuários). Todas as requisições atrás dela — inclusive o `loadModel` de quem estava abrindo o app — ficaram presas → **todos os usuários daquele workspace congelaram**.
- **Assinatura no log:** `"request hang found"` no `dev-transactor_cockroach-1`, com o contador `sec` **subindo** (a mesma requisição presa por minutos/dezenas de minutos).
- **Pista importante:** durante a trava, **a CPU do transactor fica BAIXA (~3%)**. É bloqueio (esperando lock/cockroach), não CPU. Não adianta procurar quem está "comendo CPU".
- **Mitigação imediata:** `docker compose restart` (ou recriar só o transactor) limpa a fila presa e destrava. **Reincide** enquanto a causa (query sem limite / contenção no cockroach) não for corrigida.

---

## 1. Como reconhecer que é ESTE incidente

Sintomas típicos:
- Workbench abre o shell mas fica no **spinner infinito**; no navegador (F12 → Network) o **WebSocket (`wss …:3332`) fica "Pending"** e os dados não chegam.
- Afeta **vários usuários do mesmo workspace** ao mesmo tempo (não só um).
- Costuma bater em **horário de pico** (onda de login da manhã ~08:00–09:00 BRT, muitas vezes junto do digest das 08:30).

Confirmação em 1 comando (é a "prova"):
```bash
docker logs dev-transactor_cockroach-1 --tail 200 2>&1 | grep "request hang found"
```
Se aparecerem linhas `request hang found` com o campo `sec` alto (dezenas/centenas/ milhares de segundos) para o **mesmo `id`/`wsId`**, é este incidente.

---

## 2. PLAYBOOK — o que rodar quando congelar

Rode **nesta ordem**. Copie e cole. (Nomes de container: `dev-transactor_cockroach-1`, `dev-cockroach-1`, `dev-account-1`, `dev-time-machine-1`, `dev-front-1`.)

### Passo 1 — Confirmar o freeze e ver O QUE está preso
```bash
# requisições travadas no transactor (a assinatura do incidente)
docker logs dev-transactor_cockroach-1 --tail 300 2>&1 | grep "request hang found" | tail -20
```
Leia nas linhas: `method` (tx/loadModel/…), `measureName` (ex.: `readNotifications`), `wsId` (qual workspace) e `sec` (há quanto tempo está preso). O `wsId` que se repete é o **workspace entupido**.

### Passo 2 — Confirmar que é BLOQUEIO, não CPU
```bash
docker stats --no-stream dev-transactor_cockroach-1 dev-cockroach-1 dev-account-1
```
Esperado neste incidente: **transactor com CPU baixa** (~2–5%) mesmo com todo mundo travado. Se algum container estiver a 90%+, é outro problema (veja §5).

### Passo 3 — Achar a query presa / contenção no CockroachDB
```bash
# statement rodando/preso há mais tempo
docker exec dev-cockroach-1 cockroach sql --insecure -e \
 "SELECT (now()-start) AS idade, application_name, substring(query,1,160) AS q \
  FROM crdb_internal.cluster_queries ORDER BY idade DESC LIMIT 20;"

# linhas quentes (contenção de lock) — normalmente no workspace grande
docker exec dev-cockroach-1 cockroach sql --insecure -e \
 "SELECT count(*) AS n, substring(key,1,48) AS key \
  FROM crdb_internal.cluster_contention_events GROUP BY key ORDER BY n DESC LIMIT 15;" \
  2>/dev/null || echo "(sem contention events)"
```
A query mais antiga em `cluster_queries` (idade de minutos) é a candidata a culpada. Anote o SQL — em geral é um `SELECT … FROM task … ORDER BY … ` **sem `LIMIT`** (caminho de inbox/notifications, "my issues", activity).

### Passo 4 — Snapshot completo (guarde para o post-mortem)
```bash
cat > /tmp/freeze-snap.sh <<'EOF'
echo "== $(date -u +%FT%T) =="
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' \
  dev-cockroach-1 dev-account-1 dev-transactor_cockroach-1 dev-time-machine-1
echo "-- transactor: hangs --"; docker logs dev-transactor_cockroach-1 --tail 60 2>&1 | grep "request hang found" | tail -15
echo "-- transactor: erros --"; docker logs dev-transactor_cockroach-1 --tail 80 2>&1 | grep -iE "error|57P01|not accepting|timeout|rate|limit"
echo "-- account --";           docker logs dev-account-1 --tail 60 2>&1 | grep -iE "error|timeout|core|validate|econnrefused|connection"
EOF
chmod +x /tmp/freeze-snap.sh
bash /tmp/freeze-snap.sh
```
No navegador travado: **F12 → Console** (erros?) e **Network** (qual request/WS fica "Pending" e por quanto tempo).

### Passo 5 — Destravar (mitigação)
```bash
# Reinicia só o transactor (mesma imagem) → limpa a fila presa
docker restart dev-transactor_cockroach-1

# NÃO use `docker compose -f docker-compose.vps.yaml up/--force-recreate` sozinho:
# a produção roda imagens do GHCR via o overlay dev/docker-compose.registry.yaml +
# IMAGE_TAG (ver deploy.yml); só com o vps.yaml o compose procura
# hardcoreeng/<pod>:3f-local, que não existe, e falha ("not found").
# Reiniciar o docker inteiro também religa o calendar — se a causa for ele, trava de novo.
```
> ⚠️ Recriar/reiniciar o transactor causa **reconnect storm** (todos reconectam de uma vez → 1–3 min de lentidão). Assenta sozinho se a CPU estiver livre. **Nunca reinicie em loop** (ver memória `transactor_restart_reconnect_storm`). O restart **não corrige a causa** — só limpa a fila; vai reincidir sob a mesma carga.

---

## 3. Causa-raiz (incidente 2026-08-26)

Evidência direta no `dev-transactor_cockroach-1`:
- Uma requisição `tx` (`TxApplyIf`, `measureName:"readNotifications"`, marcando `ActivityInboxNotification` como `isViewed:true`) ficou **`request hang found` por 27+ minutos** (`sec` 600 → 1620), no `wsId=b001f439-0561-4eea-b40d-5d6df7972a79`.
- `total:21` requisições penduradas no mesmo workspace, incluindo um **`loadModel` preso** (= gente abrindo o app e travando).
- No fim, `PostgresError 57P01 "server is not accepting clients"` (cockroach em shutdown/restart) e um `findAll` em `task` **sem `LIMIT`** (`ORDER BY modifiedOn DESC`).

Mecânica: o processamento de `tx` de um workspace é **serializado**. Uma requisição presa (esperando o cockroach responder um write / soltar um lock) **bloqueia toda a fila daquele workspace** → os ~39 usuários do `b001f439` congelam. Como fica **bloqueada esperando**, o transactor aparece com **CPU baixa**. Não se auto-recupera; o restart limpa a fila.

Encaixa no padrão já documentado de **query sem limite em conta de volume alto** (`b001f439` = workspace do bommamkt + BUs) — ver memória `huly_unbounded_query_perf`. Os caminhos de **inbox/notifications, "my issues" e activity** têm pontos de query não-limitada ainda pendentes de correção; sob pico, um deles satura o cockroach e wedge-a o pipeline.

---

## 4. Fix definitivo (o que resolve, não só mitiga)

1. **Limitar a query que trava** — adicionar `limit` no caminho de inbox/notifications e nos `findAll` de `task` sem `LIMIT` do caminho quente (mesmo padrão dos pontos já corrigidos em `huly_unbounded_query_perf`). Use o SQL capturado no Passo 3 para achar o ponto exato no código.
2. **Timeout de requisição/tx no transactor** — hoje um request preso wedge-a a fila por dezenas de minutos. Com timeout, ele **aborta e libera a fila** em vez de derrubar o workspace inteiro.
3. **CockroachDB** — single-node em 4 núcleos sob 39 usuários + digest + scans sem limite é o gargalo. Investigar contenção de lock (Passo 3) e considerar afinar recursos. `57P01` durante a trava = cockroach saturado/reiniciando.
4. **Reduzir carga concorrente do pico** — o digest das 08:30 faz `findAll(tracker.class.Issue, {})` sem limit por workspace (`services/worker/src/dailyDigest.ts:453`), batendo no transactor bem na onda de login da manhã. Limitar/paginar isso alivia o horário crítico.

---

## 5. O que NÃO é (hipóteses descartadas com evidência — não perca tempo aqui)

No incidente 2026-08-26, foram verificados e **descartados**:

| Suspeito | Por que NÃO era |
|---|---|
| **Worker / `time-machine` "com uso alto"** | Ocioso durante a trava (`0 eventos expirados` em `time_machine.delayed_events`). Pico de CPU é só a rajada do **digest das 08:30**, transitória. |
| **Modelo inchado** | `load-model` do `b001f439` = **147 KB em ~40 ms**. Os 84k `no document found` eram o worker **re-lendo** o modelo, não bloat real. |
| **Trigger ai-bot** (`OnUserStatus → fetch huly.local:4010`) | Só **1–3 erros/min**, constante o dia todo (ruído crônico), não storm. Vale tirar `AI_BOT_URL` como higiene, mas **não é a causa**. |
| **Query REST lenta** | Requisição REST mais lenta da janela = **99 ms**. A camada REST estava saudável. |
| **Crash do CockroachDB** | `RestartCount=0`, `OOMKilled=false`, disco 36%, RAM ok, sem `panic`. O `ECONNREFUSED`/`57P01` foi o cockroach **descendo durante o próprio restart manual**. |

Outros modos de "carregando eternamente" **distintos deste** (checar se a assinatura do §1 NÃO aparecer):
- **Rate-limit / poison-pill do Planner** → memória `planner_freeze_ratelimit` (grep `rate.?limit|sliding` no transactor).
- **Backup saturando a VPS** → memória `backup_interval_saturation` (lentidão GERAL + CPU ociosa; `docker stop dev-backup-cockroach-1`).
- **Calendar sync N+1** → memória `calendar_sync_eventid_n1_freeze` (`docker stop dev-calendar-1`).
- **Login F11 travado** quando a 3F Core cai (502/timeout → login estoura 500 em vez de cair no fallback local) → checar `dev-account-1` por `3F Core … failed`.

---

## 6. Referências rápidas

- Containers: `dev-transactor_cockroach-1` (Tx/WS :3332), `dev-cockroach-1` (banco :26257), `dev-account-1` (auth :3000), `dev-time-machine-1` (worker/PDCA/digest), `dev-front-1`.
- Workspace grande (bommamkt + BUs, alvo recorrente): `b001f439-0561-4eea-b40d-5d6df7972a79`.
- Compose de produção: `dev/docker-compose.vps.yaml` (rode os `docker compose` a partir de `/opt/apps/os-tasks/dev`).
- Config relevante no transactor: `RATE_LIMIT_MAX=1500`, `RATE_LIMIT_WINDOW=30000`.
