# Plano de melhoria de performance — pod-calendar

Data: 2026-07-01
Autor: análise assistida (6 investigadores em paralelo sobre `services/calendar/pod-calendar/src/**` + 4 designs adversariais)
Contexto: VPS de 2 cores, 30–40 users ativos, incidentes recentes de travamento (locks stale, `ConnectionClosed` cascade, holiday calendars fazendo full-resync).

> ⚠️ **Upgrade de hardware (2026-07-02):** a VPS passou de 2 → **4 núcleos / 16 GB RAM / 200 GB NVMe** (Hostinger KVM 4). Toda a análise abaixo foi calibrada para os **2 núcleos** antigos — as severidades de CPU agora são **menores**, mas os fixes estruturais (semáforo global de sync, debounce por workspace, `mem_limit`) continuam válidos. Trate as menções a "2 cores" no texto como o baseline histórico.

Correlato: `3f-docs/pod-calendar-issues.md` (findings pontuais anteriores), memories `calendar_sync_eventid_n1_freeze`, `transactor_restart_reconnect_storm`, `redpanda_nofile_exhaustion`, `jaeger_badger_retention`.

---

## Diagnóstico (o que está travando)

Os 8 gargalos-raiz, ranqueados por impacto no travamento atual:

1. **Sync periódico é um "big bang" a cada 30 min** — `calendarController.ts:57-77, 82-92`: `startAll()` refaz o fan-out completo (todas workspaces × todos users × todos calendars) via `RateLimiter(InitLimit=50)`, sem debounce por workspace, sem detecção de idle. Em 2 cores é um pico previsível de CPU.
2. **Mutex per-user é grande demais** — `sync.ts:88` usa `${workspace}:${userId}:${email}`. Um user com 5 calendars sincroniza tudo em série; 1 calendar lento trava os outros 4 e a fila de push.
3. **Stale-lock só é detectado quando outro chega** — `mutex.ts:40-52`: se ninguém tenta pegar o mesmo lock em 2 min, ele fica preso indefinidamente. O `sync.ts:145-150` já sabe disso (é o workaround do `evictLock` que já plantamos).
4. **N+1 no incoming sync** — `sync.ts:539-542`: um `findOne(Event, {eventId, calendar})` por evento dentro de cada página de 2500 do Google. Uma página cheia = 2500 round-trips no Cockroach.
5. **/event é fire-and-forget sem cap** — `main.ts:196`: `void OutcomingClient.push(...).catch(...)` sem contador de in-flight. Um trigger do transactor com muitos eventos pode gerar dezenas de promises paralelas sem backpressure. (Nota: o `/push:173` está `await`ado — o problema dele é diferente, é a serialização O(N_workspaces) dentro de `pushHandler.push`, ver item 2.4.)
6. **RateLimiter global por email + polling** — `rateLimiter.ts:24-36, 38-47`: `while(tokens<count) setTimeout(1000ms)` cria thundering herd de wake-ups; e o mesmo email em 2 workspaces briga pelo bucket.
7. **Client pool cresce sem TTL** — `client.ts:35`: `Map<workspace, Client>` só é evictado por erro de conexão. Workspace deletada mantém socket até restart do pod.
8. **Sem limite de recurso no container, sem healthcheck, sem métricas exportadas** — `docker-compose.vps.yaml:581-604` + `main.ts:40-51` cria `createOpenTelemetryMetricsContext` mas sem `OTEL_EXPORTER_OTLP_ENDPOINT` → traces vão pro nada.

Somados: em pico de sync periódico, o pod satura os 2 cores, o event loop trava, `evictClient` em cascata derruba o pool compartilhado, e como não tem `mem_limit` isso pode até bater no transactor por contenção de recursos.

---

## Onda 0 — Kill switch do freeze recorrente (algumas horas, risco ~zero)

**Objetivo:** matar a causa direta do freeze de 30 em 30 min ANTES de qualquer outra coisa. Duas mudanças, uma tarde de trabalho, ganho enorme.

| Mudança | Onde | Ganho |
|---|---|---|
| **Skip read-only calendars do periodic sync + reconcile**: `if (calendar.accessRole === 'reader' && !calendar.selected) continue`. Gate por env `SKIP_READONLY_CALENDARS=true` (default true). | `sync.ts:431-435` + `sync.ts:reconcileCalendar` | Feriados do Google não têm push notification E full-resyncam a cada ciclo (é literalmente o incidente `calendar_sync_eventid_n1_freeze`). Sozinho, mata a causa recorrente. ~30% menos API calls. |
| **Limites de container aplicados a calendar E backup**: `cpus: '1.0'`, `mem_limit: 1G`, `oom_score_adj: 500` em ambos. Transactor recebe `oom_score_adj: -500`. | `dev/docker-compose.vps.yaml` bloco calendar (581-604) + bloco backup-cockroach (~550-565) + bloco transactor_cockroach | A lição de hoje: quem derrubou o sistema não foi o calendar, foi o backup batch sem teto de recurso. Aplicar o guardrail em TODA classe de serviço pesado, não só no calendar. Regra: "batch/sync service NUNCA pode derrubar o transactor". |

**Como validar:** subir os dois, esperar 2 ciclos de periodic sync (~60 min), verificar via `docker stats` que o pico de CPU do calendar caiu; via `docker logs dev-calendar-1 | grep 'Sync started' | wc -l` que o número de syncs por rodada diminuiu (só users interativos, sem holidays).

**Por que isso é Onda 0 e não Onda 2:**
- Custo <4 horas, gate por env var, rollback = `SKIP_READONLY_CALENDARS=false` + restart.
- É a causa direta do incidente que motivou este plano.
- Melhor custo/benefício absoluto do documento inteiro.

---

## Onda 1 — Guardrails + observability (1,5–2 dias, zero risco de código)

**Objetivo:** capar o blast radius e ganhar sinais para decidir a Onda 2 com dados.

| Mudança | Onde | Ganho |
|---|---|---|
| `cpus: '1.0'`, `mem_limit: 1G`, `oom_score_adj: 500` no calendar; `oom_score_adj: -500` no transactor | `dev/docker-compose.vps.yaml` bloco calendar (581-604) + bloco transactor_cockroach | Calendar NUNCA pode derrubar o transactor por consumo. Se OOM acontecer, o kernel escolhe calendar primeiro. |
| Healthcheck HTTP `GET /health` (verifica oldest lock, event loop lag, periodic stuck), `start_period: 120s`, `stop_grace_period: 30s` | Compose + novo endpoint em `main.ts` (reusa `getActiveLocks()`, `clients.size`, `perf_hooks.monitorEventLoopDelay`) | Restart automático quando realmente travado; MTTR ~30 min → <7 min. |
| `logging: {max-size: 50m, max-file: 5}` no compose | Compose | Log spam do `outcomingClient` para de encher disco. |
| `nginx: max_conns=32`, `limit_conn 4` por-IP, `proxy_next_upstream_tries 1`, `error_page 502 503 504 → @calendar_down` | `dev/nginx/3ftasks.conf` no location `/_calendar/` | Um pod travado devolve 503 fast em vez de piling requests no browser. |
| `GET /admin/metrics` (Prometheus text format) expondo: `calendar_locks_active`, `calendar_lock_oldest_ms`, `calendar_client_pool_size`, `calendar_rate_limiters_size`, `calendar_event_loop_lag_ms`, `calendar_process_rss_bytes`, `calendar_stale_evictions_total` | Novo endpoint em `main.ts` (~50 LOC, sem deps) | Primeira vez que a gente vai VER o pod saturando antes do user reclamar. |
| Wire `OTEL_EXPORTER_OTLP_ENDPOINT` — só se planejar religar Jaeger. Ver nota abaixo. | Compose | Traces param de ir pro vazio. |
| Backup noturno de `hulykvs/store.json` | Cron no VPS | $0 de seguro contra "perdi todos os syncTokens = re-download de meses de eventos". |
| Runbook `3f-docs/calendar/runbook.md`: passos exatos para destravar SEM restartar transactor | Novo doc | Codifica a lição do `transactor_restart_reconnect_storm`. |

**Nota Jaeger:** foi removido em 2026-06-09 (memory `jaeger_badger_retention` — badger sem TTL encheu 39 GB). Só religar se subir de novo com `BADGER_SPAN_STORE_TTL`. Alternativa recomendada: expor tudo via `/admin/metrics` e scrapear com Prometheus quando existir.

**Como validar:** depois do deploy, rodar `curl /admin/metrics` e ver os números; matar o pod artificialmente (SIGSTOP) e ver o `/health` virar 503 em <30s.

**⚠️ Ordem crítica com Onda 0:** o healthcheck que **restarta** automaticamente só pode ser ligado DEPOIS da Onda 0 (skip read-only). Sem isso, cada boot do calendar refloodda o resync de feriados — um healthcheck agressivo vira loop de restart que amplifica o problema. Duas opções:
1. Ship a Onda 0 primeiro. Só então ligar `restart: unless-stopped` + healthcheck com `interval: 30s / retries: 4`.
2. Se quiser desacoplar: colocar o healthcheck **apenas em modo observação** (loga status, não restarta) até a Onda 0 estar deployada. Depois flipa para restart.

**Rollback:** cada mudança é <20 linhas em compose/nginx. `git revert` + `docker compose up -d calendar` + `nginx -s reload`. <5 min pra desfazer tudo.

---

## Onda 2 — Otimização vertical (4–6 dias)

**Objetivo:** cortar 40–60% do CPU e 50% das chamadas ao Google sem mexer em containers.

Ranqueado por payoff:

| # | Mudança | Onde | Ganho estimado |
|---|---|---|---|
| 2.1 | **Mutex por calendar em vez de por user**: mudar chave de `${workspace}:${userId}:${email}` para `${workspace}:${userId}:${email}:${calendarId}` | `sync.ts:88`, `mutex.ts` | User com 5 calendars: sync serial 15s → paralelo 4s. É o unlock mais barato. |
| 2.2 | **Kill N+1**: preload de existentes por página via `findAll({eventId: {$in: pageIds}, calendar: _calendar._id})` (chunkar em 200 pra segurança do adapter Cockroach). **Caveat do índice**: `eventId` vive dentro de `data` (JSONB), não é coluna própria — cada `findAll` continua sendo um scan por `data->>'eventId'`. Depois que a Onda 0 (skip read-only) encolhe o pool de eventos, provavelmente é barato o suficiente. Se um `EXPLAIN` ainda mostrar plano ruim, criar índice de expressão em `(calendar, data->>'eventId')` como follow-up. | `sync.ts:539-542` + `sync.ts:226-305` (reconcile); índice em `foundations/server/postgres` se necessário | 2500 findOne → 1 findAll. Elimina o head-of-line blocking no incoming sync. |
| 2.3 | **Global sync semaphore**: `GLOBAL_SYNC_CONCURRENCY=8` que TODOS os paths (periodic, push, forceSyncUser, startAll) precisam pegar antes de trabalhar | `calendarController.ts` (novo) | Bounda o CPU do pod independente do trigger. Fim do burst descoordenado. |
| 2.4 | **Backpressure**: (a) contador de in-flight no `/event` — 503 quando > 32; (b) fan-out cap em `pushHandler.push` com `p-limit(4)` no `for-await` sequencial. Nota: `/push:173` já é `await`ado, então backpressure lá é no fan-out interno; `/event:196` é `void ... .catch(...)`, precisa de gate próprio antes do fire-and-forget. | `main.ts:196` (/event), `pushHandler.ts:69-75` (fan-out) | User federado em 100 workspaces para de bloquear event loop; trigger de outgoing sync com muitos eventos deixa de rodar unlimited concurrent. |
| 2.5 | ~~Skip read-only calendars~~ — **promovido para Onda 0**. | | |
| 2.6 | **TTL/LRU no client pool + endpoint cache**: evictar entradas idle > 30 min, reaper background a cada 5 min. Endpoint cache com TTL 5 min. | `client.ts:22, 35` | Memória bounded, e transactor pode ser reagendado sem restart do calendar. |
| 2.7 | **TTL no RateLimiter map** + **event-driven wait** em vez de polling `setTimeout(1000ms)` | `rateLimiter.ts:24-36, 38-47` | Sem thundering herd; sem RAM leak. |
| 2.8 | **Cache `getMyCalendars()` por user por 5 min** | Novo em `calendarController.ts` | 100 users × 48 syncs/dia = 4800 chamadas Google inúteis/dia eliminadas. |
| 2.9 | **Skip outgoing `events.get()` antes de update/delete** — confiar no `Event.access` local, fallback só em 404 | `outcomingClient.ts:173-216, 392-421` | ~50% menos API calls no outgoing sync. |
| 2.10 | **Coalescer os 8 INFO logs por diff de campo em 1 log agregado** | `outcomingClient.ts:223-362` | ~80% menos log volume em reconcile. |
| 2.11 | **Debounce por workspace no periodic sync**: se workspace sincronizou nos últimos 20 min, pula esta rodada | `calendarController.ts:runPeriodicSync` | Sync periódico deixa de repetir trabalho de push notifications recentes. |
| 2.12 | **Node flags**: `NODE_OPTIONS=--max-old-space-size=768`, `UV_THREADPOOL_SIZE=8`, `INIT_LIMIT=10` (de 50), `PERIODIC_SYNC_INTERVAL=45` | Compose | Menos context switching em 2 cores; boot mais suave. |

**Como validar:** rodar reconcile em user com 5 calendars, comparar tempo (target: 15s→4s); olhar `calendar_locks_active` e `calendar_lock_oldest_ms` no `/admin/metrics` durante um pico; comparar tokens no rate limiter map antes/depois.

**Todas mudanças gateadas por env var** — rollback = mudar env e restartar o pod, sem revert de código.

**Riscos monitorados:**
- `findAll({eventId: {$in: 2500}})` pode planejar mal no Cockroach. Chunkar em 200 e benchmarkar antes.
- Trust em `Event.access` pode falhar em eventos importados de fora. Fallback pra `get()` em 404/403.
- Skipping read-only calendars é config-gated (`SKIP_READONLY_CALENDARS=true`).

---

## Onda 3 — Escala arquitetural (só se Onda 1 + 2 não bastar)

**Realidade hoje:** 30–40 users ativos, alguns workspaces. A Onda 1 + 2 provavelmente resolve. Só faça Onda 3 se depois de 4 semanas de métricas você vir:
- Pico de CPU ainda > 80% em cada periodic tick, OU
- Consumer lag de push > 5 s (via `/admin/metrics`), OU
- User count > 100.

### Recomendação: queue-driven (design C) em vez de horizontal sharding (design A)

Por quê C > A pra 3F:

| Critério | Horizontal shard (A) | Queue-driven (C) — recomendado |
|---|---|---|
| Deps novas | Redis + PG advisory locks + nginx consistent-hash | Só Redpanda (já está no compose em `:9092`) |
| Padrão de repo já usado | Nenhum | `services/worker` (`pdca.ts`, `dailyDigest.ts`) — mesmo `getPlatformQueue`, mesmo `QueueTopic`, mesmo `digest_runs`-style claim table |
| SPOF do multi-writer no hulykvs | **Não resolve** — 2 pods escrevem no mesmo `store.json`, corrupção possível | Resolve naturalmente: partition-key = workspace → mesmo worker escreve pra mesma workspace |
| Rate limiter cross-workspace federado | Vira um problema novo (cada shard vira seu bucket) | Partição por workspace mantém federado no mesmo consumer |
| Rebalance risk | "1/3 dos workspaces mudam de pod" ao mudar shard count | Rebalance Kafka nativo, ordenado por partição |
| Esforço MVP | 3–4 dias | 6–9 dias |
| Encaixe cultural | Um padrão novo | Cópia do que o worker já faz |

### MVP do design C

- Split do pod em `calendar-ingress` (webhook + OAuth + admin, produz mensagens) e `calendar-worker` (consumer). Mesma imagem `hardcoreeng/calendar:3f-local`, muda MODE env var.
- 3 tópicos novos no Redpanda: `CalendarSyncRequest`, `CalendarSyncResult`, `CalendarWatchRefresh`. Partition-key = `workspaceUuid`.
- Idempotência via tabela `calendar_sync_runs` no Cockroach (copiar padrão `digest_runs` do worker).
- Compose: 1 replica de ingress + 2 replicas de worker (`cpus: '0.6'` cada).
- Watch refresh vira uma stream, não um loop diário de 5–10 min bloqueando.

### Ganhos esperados

- /push p99: 2 min (hoje, atrás do mutex) → <100 ms.
- Sync periódico deixa de ser stampede: produzem-se 30–40 mensagens em <1s e o pool consome no ritmo.
- Push handler pra user federado em 20 workspaces: 200s → 20 ms.

### Riscos que você tem que aceitar

- Redpanda vira SPOF pra sync. Já teve o incidente `redpanda_nofile_exhaustion` — validar que ulimit continua em 524288.
- Rebalance de consumer group durante deploy pausa partição alguns segundos.
- OAuth callback muda semântica: hoje browser espera o sync fazer, novo modelo redireciona imediato e o worker sincroniza async. UI precisa mostrar "sync em progresso".
- Fallback buffer em memória (5 min, 5000 msgs) se Redpanda cair — perde no restart do pod, mas mantém webhook responsivo.

---

## O que NÃO fazer (armadilhas apontadas pelos designs)

- **Não** botar 2 réplicas do pod calendar sem trocar o hulykvs primeiro — o `store.json` é single-writer (`services/hulykvs/server.js:32-57`). Dois pods escrevendo = corrupção; syncTokens somem e todo mundo faz full re-download de meses de eventos.
- **Não** reduzir `PERIODIC_SYNC_INTERVAL` pra baixo achando que "mais sync = mais fresco". Cada rodada é um stampede. 45 min é o novo default; se push funciona, é só safety-net.
- **Não** deixar `cpus: 0.75` (o design D sugere) — é tight demais pra reconcile legítimo. Comece com `cpus: '1.0'` e aperte só depois de 1 semana de dados.
- **Não** restartar o transactor pra "consertar" calendar. Já sabemos que isso dispara a reconnect storm (`transactor_restart_reconnect_storm`). Runbook diz explicitamente: **stop calendar, nunca transactor**.
- **Não** subir `UV_THREADPOOL_SIZE` além de 8. Em 2 cores, mais threads = context switching que ativa contra você.
- **Não** ligar OTEL exporter sem alvo (Jaeger não existe mais) — os spans vão pro nada e a instrumentação custa CPU.

---

## Como medir sucesso

Todas via `/admin/metrics` da Onda 1:

| Métrica | Baseline (hoje) | Target Onda 1+2 | Target Onda 1+2+3 |
|---|---|---|---|
| `calendar_lock_oldest_ms` p99 em 24h | 120 000 (2 min stale) | < 30 000 | < 5 000 |
| `calendar_locks_active` em pico | 35+ (incidente recente) | < 10 | < 5 por replica |
| `calendar_event_loop_lag_ms` p99 | provavelmente > 500 | < 200 | < 50 |
| CPU calendar container em periodic tick | ~100% dos 2 cores por 3-5 min | ~50% por 2 min | steady state ~20% |
| `ConnectionClosed` cascades / dia | vários (por incidente) | 0 | 0 |
| Tempo médio de sync por user com 5 calendars | ~15 s | ~4 s (paralelismo) | ~2 s |
| Google 429s / dia | não medido | < 5 | 0 |
| Push reentregues por Google | não medido | < 1% | < 0,1% |

---

## Ordem de execução recomendada

1. **Onda 0 esta semana** (~4h de trabalho): skip read-only + limites de container em calendar E backup. Mata o freeze recorrente, blinda o transactor contra qualquer batch service.
2. **Onda 1** logo depois (1,5–2 dias): guardrails + `/admin/metrics` + `/health`. Auto-restart do healthcheck só depois que Onda 0 estiver estável (senão vira loop de restart).
3. Rodar 1 semana com Onda 0+1 no ar. Coletar baseline real via `/admin/metrics`.
4. **Onda 2** em ordem de payoff: 2.2 (N+1) → 2.1 (mutex por calendar) → 2.4 (backpressure em `/event`) → 2.6 (TTL client pool) → resto.
5. Cada item da Onda 2 é um commit separado, gateado por env var, testável isoladamente. Não bundle.
6. Depois de 4 semanas com Onda 2, olhar métricas. Se targets bateram, **para aí** — Onda 3 é sobre-engenharia se a Onda 2 resolveu.
7. Se precisar da Onda 3: começar pela migração hulykvs → Redis/PG (pré-requisito), depois split ingress/worker, depois cutover em shadow-mode.

---

## Referências no código

Arquivos-chave do pod (`services/calendar/pod-calendar/src/`):

- `main.ts` — HTTP surface, admin endpoints, OTEL bootstrap
- `calendarController.ts` — startAll, periodic sync, forceSyncUser
- `workspaceClient.ts` — por-workspace user fan-out
- `sync.ts` — incoming sync, reconcile, N+1
- `outcomingClient.ts` — Huly→Google, get-before-update
- `pushHandler.ts` — webhook do Google
- `client.ts` — pool de WebSocket para transactor
- `mutex.ts` — lock FIFO com stale-eviction
- `rateLimiter.ts` — token bucket por email
- `watch.ts` — refresh diário de watch channels
- `kvsUtils.ts` — persistência de syncTokens/watches em hulykvs
- `config.ts` — env vars

Infra:

- `dev/docker-compose.vps.yaml:581-604` — service block do calendar
- `dev/docker-compose.vps.yaml:569-579` — hulykvs backing store
- `services/hulykvs/server.js` — JSON file KV (single-writer)
