# INCIDENTES.md — Registro de incidentes de produção (3F Tasks)

Log cronológico (mais recente no topo). Cada entrada: o que houve, desde quando,
como foi detectado, impacto, o que foi feito e o que ficou pendente. Sem segredos.

---

## 2026-11-01 — Duplicação mensal do PDCA gerou 136 cópias no QG Criativo 🟠 — limpo

**Resumo.** Entre 00:00 e 03:59 BRT de 01/11, o worker rodou a duplicação mensal das tarefas
do PLAN e do VIDEO que estavam em modo duplicar: **136 cópias** (+32 sub-tarefas) e **136
originais** com o PDCA desligado e status movido para "Aprovado" (Won). Não foi falha: era
o risco apontado na entrada de 16/10 ("antes de 01/11"), e o alinhamento com o QG Criativo
não aconteceu a tempo. O time cria as tarefas mensais à mão, então as cópias (quase todas
com o mês antigo no título) eram ruído; o dano real foram **66 tarefas em andamento**
(ex.: "[DEZEMBRO] Planejamento" em "Reunião Agendada") marcadas como aprovadas.

**Detecção.** O usuário, em 03/11. Pessoas já tinham começado a limpar à mão às 07:46.

**Correção (03/11).** `automation/pdca-replay-cleanup.ts --from 2026-11-01T02:55:00Z --to
2026-11-01T07:05:00Z`, por projeto (PLAN e depois VIDEO): **115 cópias + 32 sub-tarefas
apagadas, 65 originais com o status restaurado**, 0 falhas; dry-run de conferência zerado.
Ficaram de fora 21 cópias que pessoas já tinham mexido e 1 original (VIDEO-577) que a
própria pessoa restaurou.

**Decisão (03/11).** O QG Criativo não usa PDCA. `automation/pdca-disable-projects.ts
--projetos PLAN,VIDEO,BRAND,SITE --apply --templates` desligou o PDCA de **33 tarefas**
(incluindo as 20 cópias em revisão, que disparariam em 01/12) e do template "[SETEMBRO]
Planejamento de Conteúdo" do PLAN; conferência = 0 ativas nos 4 projetos.

**Pendência.** O template "[MÊS] Planejamento de Conteúdo" da BOMMA segue em modo duplicar
mensal. O projeto está arquivado e o worker não cicla projeto arquivado, então só volta a
importar se a BOMMA for desarquivada.

---

## 2026-10-16 — PDCA parado por ~2 meses e rajada de 618 ciclos no reboot da VPS 🔴 — mitigado

**Resumo.** Às 10:45 BRT de 2026-10-16, o worker do PDCA reexecutou **618 ciclos de uma
vez em 18 minutos** (10:45:34 → 11:03:26): **217 duplicações** e **401 resets**. Eram ciclos
"órfãos", que vinham falhando desde pelo menos 01/09 e tinham saído da agenda. O gatilho
foi um **reboot da VPS iniciado pela Hostinger**. Na prática o PDCA estava **parado**: de
01/09 a 15/10 só 67 ciclos funcionaram (todos resets), contra 522 desistências, e
**nenhuma duplicação** funcionou no período.

**Detecção.** Usuários viram tarefas "reiniciadas do nada" que pareciam fora do PDCA (ex.:
PLAN-22, com o comentário "Ciclo PDCA reiniciado" e o toggle desligado). O toggle
desligado é o próprio modo duplicar: o worker desativa a original e cria uma cópia.

**Linha do tempo (BRT).**

| Quando | O quê |
|---|---|
| 10/08 | Deploy do worker `29515ceef0ce`, a versão que rodou até 16/10 (o log do container só vai até 01/09) |
| ≥ 01/09 → 15/10 | Ciclos falham com `Cannot read properties of null (reading '#<Object>')`; 3 retries (5min/30min/2h) e desiste **sem reagendar** → tarefa ativa sem evento no TimeMachine. Desistências: 351 em 01/09, 22 em 14/09, 119 em 01/10, 17 em 12/10, outras soltas |
| 16/10 10:39:35 | `qemu-ga: guest-shutdown called` → `System is powering down (hypervisor initiated shutdown)`. Não foi SSH nem unattended-upgrades (`Automatic-Reboot` está desligado) |
| 16/10 10:44:34 | VPS liga (kernel novo 6.8.0-147). O worker sobe antes do cockroach, cai com `ECONNREFUSED`, o Docker o religa às 10:45:01 (`restarts=1`) |
| 16/10 10:45 → 11:03 | `bootstrapPdcaSchedules` reagenda toda tarefa ativa com o `pdcaNextCycleDate` gravado; as vencidas disparam na hora. Com o modelo do transactor limpo pelo reboot, desta vez todas passaram |
| 16/10 18:06Z | Correção do worker em produção (`worker:1b93eb15575c`) |

**Impacto.**
- **217 originais** (quase todas "[MÊS] Planejamento de Conteúdo" e "ANÚNCIO TRÁFEGO" de
  PLAN/VIDEO/BOMMA) foram para `tracker:status:Done` — status que **nem existe no fluxo
  desses projetos** — e tiveram o PDCA desligado. Várias pessoas, depois, mudaram parte
  delas à mão para "A fazer".
- **217 cópias** com títulos de meses passados (+ sub-tarefas), criadas pelo Sistema e
  atribuídas aos responsáveis.
- **401 resets** fora de hora (status → reset, tempo zerado, datas recalculadas). Estavam
  semanas atrasados, então **não foram revertidos**.
- Por projeto (ciclos): SEED_ 269 · PLAN 122 · BOMMA 70 · SMBOM 57 · VIDEO 37 · IMPER 28 ·
  BUGTM 24 · G3F 7 · SUPOR 3 · TECH_ 1. **SEED_, BOMMA, SMBOM e IMPER são projetos
  arquivados.**
- Antes disso: ~2 meses sem PDCA. As equipes passaram a criar as tarefas do mês à mão.

**Causa raiz (confirmada no código e ao vivo).**
1. **O transactor suja o modelo em memória.** Ao abrir uma sub-tarefa, a UI pede
   `lookup: { status: [IssueStatus, { category: StatusCategory }] }`
   (`plugins/tracker-resources/src/components/issues/edit/SubIssueSelector.svelte:80`;
   também `SetParentIssueActionPopup.svelte:31`). O adaptador postgres resolve o status
   pela **referência** devolvida por `modelDb.findAllSync` (que não clona) e grava
   `$lookup = { category }` **dentro do status do modelo**
   (`foundations/server/packages/postgres/src/storage.ts:682-694` + `getLookupValue`
   `:859-860`). Bug herdado do upstream. Em 16/10 à tarde já havia 9 status sujos,
   entre eles "A fazer" (`69fcdb47…`).
2. **A leitura REST desses status quebra.** O servidor serializa `lookupMap: null`
   (`rpcJSONReplacer` faz `value ?? null`), e o api-client testa `!== undefined` e
   indexa `null[$lookup.category]`
   (`foundations/core/packages/api-client/src/rest/rest.ts:125-131`) →
   `Cannot read properties of null (reading '#<Object>')`.
3. **O worker transformava isso em tarefa órfã.** O modo duplicar lia **todos** os status
   (bastava um sujo para falhar sempre); o reset lia o status atual da tarefa (falhava
   quando era um sujo, ex. "A fazer"). O erro era classificado como transitório → 3
   retries → desistia **sem agendar o próximo ciclo**.
4. **O boot reexecutava tudo de uma vez.** O bootstrap reagendava as órfãs com a data
   vencida e elas disparavam juntas no primeiro restart.

> **Corrige a análise de 28/08** (memória `status_corrupt_object_field`): **não** há dado
> corrompido no banco. É estado em memória — some quando o transactor reinicia e volta
> assim que alguém abre uma sub-tarefa. Por isso o erro parecia "intermitente".

**Por que ficou invisível por ~2 meses.**
- A falha só aparecia no log do worker (`giving up after retries`); nenhum alerta.
- O `automation/pdca-audit.ts` mostrava as tarefas "em dia": o worker avança o
  `pdcaNextCycleDate` **antes** do trabalho, então um ciclo que falhou parece cumprido
  até a próxima data passar.
- O servidor **esconde projeto arquivado** das consultas comuns (`shouldShowArchived`,
  `foundations/core/packages/core/src/storage.ts:306`), mas o worker (conta de sistema)
  ciclava essas tarefas. Eram **602 das 982** tarefas com PDCA ativo.

**Diagnóstico (na VPS, a partir de `/opt/apps/os-tasks`).**
```bash
# ciclos que funcionaram vs desistiram, por dia
docker logs -t dev-time-machine-1 2>&1 | grep -E "PDCA cycle: (status reset|new issue created as duplicate)" \
  | awk '{print substr($1,1,10), ($0 ~ /duplicate/ ? "duplicar" : "reset")}' | sort | uniq -c
docker logs -t dev-time-machine-1 2>&1 | grep "giving up after retries" | cut -c1-10 | sort | uniq -c
# origem do reboot (boot anterior)
journalctl -b -1 --no-pager | grep -iE "reboot|shutdown|power|qemu-ga|logind" | tail -20
# agenda do PDCA: vencidos agora (deve ser 0)
docker exec -i dev-cockroach-1 cockroach sql --insecure -d defaultdb -e \
  "SELECT count(*) FILTER (WHERE target_date <= (extract(epoch FROM now())*1000)::INT8) AS vencidos, count(*) AS total
   FROM time_machine.delayed_events WHERE id LIKE 'pdca_%';"
```

**Correção.**
1. **Limpeza dos dados** — `automation/pdca-replay-cleanup.ts` (dry-run por padrão; olha só
   o que o System gravou na janela 10:45–11:05; usa `showArchived`):
   - **170 cópias + 150 sub-tarefas apagadas** (apagar cancela o timer de cada cópia);
   - **216 originais** devolvidas ao status de antes do incidente (histórico de Tx conferido
     com o "Status anterior" do comentário do worker), PDCA continua desligado;
   - **não mexeu:** 47 cópias que pessoas já tinham fechado à mão (revisão manual),
     PLAN-416 (sem status anterior no histórico) e os resets.
2. **PDCA desligado em projetos arquivados** — `automation/pdca-archived-disable.ts`:
   **543 tarefas** (SEED_ 360, IMPER 103, SMBOM 70, CSBOM 5, BOMMA 5). A configuração
   (frequência etc.) ficou intacta; dá para religar no painel da tarefa.
3. **Worker** — commit `d24796f35` (`services/worker/src/pdca.ts`): status lidos do
   modelo local (nada de REST); status "concluído" vem do task type da tarefa; só erro de
   rede é transitório; desistir agenda o **próximo ciclo** (`skipToNextCycle`) em vez de
   deixar órfã; no boot, ciclo vencido há mais de **48h** pula para a próxima data em vez
   de disparar; projeto arquivado não cicla; o projeto é lido antes de qualquer escrita.
   Scripts no commit `1b93eb155`.

**Verificação.** Simulação do script após a limpeza: 0 cópias a apagar, 0 originais a
restaurar. Conferência do script de arquivados: 0 tarefas ainda ativas. Deploy:
`IMG=ghcr.io/3f-tech/os-task/worker:1b93eb15575c STATUS=running RESTARTS=0`. Boot com o
código novo: `PDCA bootstrap: scheduled … b001f439 … count=381 skippedArchived=0`,
`de-herded … deHerded=38`, **nenhum ciclo disparado**.

**Pegadinha no deploy.** O primeiro deploy caiu com `error from registry: denied` no pull
da VPS: o PAT `vps-ghcr-readonly-projeto-faixa-azul` (conta PedroBartelle3F, só
`read:packages`), usado pelo `docker login ghcr.io` da VPS, **venceu em 12/10**.
Regenerado + `docker login` na VPS → deploy verde. Ver memória `ghcr_vps_pat_expiry`.

**Pendências.**
- **Seg 19/10 após 04:00 BRT — validar:**
  `docker logs -t dev-time-machine-1 --since 2026-10-19T03:00:00Z 2>&1 | grep -cE "reading '#<Object>'|giving up|processing error"` → esperado **0**.
- **Antes de 01/11:** é a primeira duplicação mensal que vai funcionar desde julho. As 47
  cópias em revisão (34 delas no PLAN com PDCA ligado) e as tarefas "[MÊS] Planejamento
  de Conteúdo" em modo duplicar vão gerar cópias — alinhar com o QG Criativo o que deve
  continuar no PDCA.
- **PLAN-416:** acertar o status à mão.
- **Fix na raiz:** clonar o doc de modelo antes de anexar lookup aninhado no adaptador
  postgres (pod server); e o `!= null` no api-client (rebuilda a frota inteira — janela
  planejada). Os dois protegem também os scripts de automação e o MCP do 3F OS.
- **Observabilidade:** alerta para `giving up` / `processing error` no worker e uma
  auditoria que detecte tarefa ativa **sem evento** no TimeMachine (o `pdca-audit` atual
  não pega órfã com data futura).
- **Deploy:** `deploy.yml` fazer `docker login ghcr.io` na VPS a cada execução com o
  `GITHUB_TOKEN` do job, eliminando o PAT de vida longa.
- **Investigar:** quem/o que pediu o desligamento na Hostinger (histórico do hPanel /
  chamado); e a troca de status em lote às 11:06 gravada pela conta `1173405233065492481`
  (aparece como Pedro, que diz não ter sido ele — possível integração usando o token dele).
- Menores: `getActiveWorkspaces` (`services/worker/src/db.ts:125`) incluir só workspaces
  ativas (some o ruído de `Forbidden` da "Gestão de Tráfego", em `pending-deletion`); o
  trigger `OnPdcaCycleToggle` calcular o próximo ciclo **com jitter**, como o worker.

**Contexto relacionado.** Memórias `pdca_orphan_replay_on_boot`,
`status_corrupt_object_field` (análise de 28/08 corrigida), `pdca_worker_unauthorized_secret`
(outra parada do PDCA, julho/agosto), `ghcr_vps_pat_expiry`; skill `f04-pdca-cycle`.

---

## 2026-09-03 — E-mails pararam de sair (senha de app do Gmail revogada) 🟠 — resolvido

**Resumo.** Desde ~08:30 BRT de 2026-09-03, **nenhum e-mail saiu** do 3F Tasks (digest
diário, notificações "atribuído a você", convites de workspace). O Gmail passou a
recusar a autenticação SMTP da conta `adm@3fventure.com.br` com
`535-5.7.8 Username and Password not accepted` (`BadCredentials`) — a **senha de app**
(app password) usada em `SMTP_PASSWORD` foi **revogada/expirou silenciosamente** pelo
Google. **Recorrente** (já tinha acontecido antes com a mesma conta).

**Detecção.** Usuário notou que não recebia e-mails. Confirmado no log do pod mail:
dezenas de linhas `Failed to send email (from: adm@3fventure.com.br, to: …): Invalid
login: 535-5.7.8 … BadCredentials`.

**Impacto.** Todo envio entre ~08:30 e o fix falhou, para todos os destinatários (3F +
BUs). O pod mail **não tem fila** → os e-mails que falharam **não são reenviados**; só
valem os novos após a correção.

**Por que ficou invisível (causa da demora na detecção).** O pod `mail`
(`services/mail/pod-mail`) **sempre responde HTTP 200** a quem chama, mesmo quando o
envio falha:
- `handleSendMail` (`src/main.ts`) engole o erro num `try/catch` (só `ctx.error`) e faz
  `res.send()` incondicional;
- `sendMessage` (`src/mail.ts`) usa o **callback** do nodemailer (fire-and-forget), então
  o resultado real do envio (`sent:` vs `Failed to send email`) só é gravado **no log do
  próprio pod mail**, de forma assíncrona.
- Consequência: account, transactor, worker (digest) e workspace — todos via
  `MAIL_URL=http://mail:8092` — acham que enviaram. A **única fonte de verdade** é o log
  do container `mail`.

**Diagnóstico (na VPS, a partir de `/opt/apps/os-tasks`).**
```bash
# veredito: sucessos vs falhas de envio (a verdade só está aqui)
docker logs dev-mail-1 --since 48h 2>&1 \
  | grep -iE "Failed to send email|Email request.*sent:|535|Invalid login" | tail -40
# config efetiva (a senha NÃO aparece; se SMTP_HOST/USERNAME ok e dá 535, é a senha)
docker exec dev-mail-1 printenv | grep -E "SMTP_|SOURCE|REPLY_TO"
```

**Correção (sem segredos).**
1. Gerar **nova senha de app** no Google, logado como `adm@3fventure.com.br` (2FA ativo):
   https://myaccount.google.com/apppasswords — 16 caracteres, copiar **sem espaços**.
2. Atualizar `SMTP_PASSWORD=<nova>` em `dev/.env.secrets` na VPS
   (**arquivo não versionado — nunca commitar**).
3. Recriar o pod para carregar o segredo:
   `docker compose -f dev/docker-compose.vps.yaml up -d --force-recreate mail`
   (tem que ser `--force-recreate`; `restart` **não** relê o `env_file`).

**Verificação.** Envio de teste pelo próprio node do container + leitura do log:
```bash
docker exec dev-mail-1 node -e 'const http=require("http");const d=JSON.stringify({to:"SEU-EMAIL@3fventure.com.br",subject:"teste pod mail",text:"ok"});const r=http.request({host:"localhost",port:8092,path:"/send",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},res=>console.log("HTTP",res.statusCode));r.write(d);r.end();'
docker logs dev-mail-1 --since 2m 2>&1 | grep -iE "Email request.*sent:|Failed"
```
Sucesso = linha `Email request (…) sent: 250 2.0.0 OK` **e** o e-mail chega (conferir
também o spam). **Confirmado resolvido em 2026-09-03.**

**Pendências.**
- **Higiene de dados:** existe ao menos um contato com o campo de e-mail preenchido com o
  **nome** (`to: camila oliveira`) — esse envio falha independente da senha. Caçar e
  corrigir o cadastro.
- **Observabilidade (estrutural):** fazer o pod mail devolver **erro** em vez de 200 quando
  o envio falha, e/ou emitir **alerta** ao ver `535` — hoje a falha é silenciosa e só se
  descobre por reclamação de usuário.

**Contexto relacionado.** `INFRA.md` §2.1 (ficha do pod mail: "erros de envio são
engolidos", "app password do Gmail pode revogar silenciosamente"); memória
`mail_gmail_app_password_revoked`.

---

## 2026-07-10 — Portas de dado e app expostas à internet 🔴 CRÍTICO — contido

**Resumo.** Todas as portas publicadas no `dev/docker-compose.vps.yaml` bindavam em
`0.0.0.0` (nenhuma com `127.0.0.1:`), ficando **acessíveis pela internet**. O Docker
publica portas via iptables **por baixo do ufw** — o ufw estava ativo e não listava
essas portas, mas elas abriam mesmo assim.

**O que estava exposto (confirmado de fora, via `Test-NetConnection` do PC do Pedro):**

| Porta | Serviço | Gravidade |
|---|---|---|
| `26257` | CockroachDB SQL (`--insecure`, **sem senha**) | 🔴 leitura/escrita do banco inteiro |
| `6379` | Redis (**sem senha**) | 🔴 |
| `9200` | Elasticsearch (**sem auth**) | 🔴 ler/apagar índice |
| `9002/9003` | MinIO (`minioadmin/minioadmin`) | 🔴 blobs + backups |
| `19092/19644/18081/18082` | Redpanda (Kafka + admin API) | 🟠 |
| `8089` | Console do CockroachDB | 🟠 |
| `4005` | print — `ALLOWED_HOSTNAMES` não setado = **SSRF aberto** | 🟠 |
| `1080 4900 4004 4702 4006 4017 4009` + backends `13000/13332/13078/13500/8087/8088/14040/4031/8099/18095/8097` | apps (token fraco / bypass do nginx+TLS) | 🟡 |

**Desde quando:** **incerto**. As portas nasceram em `0.0.0.0` junto com o compose; não
há registro de firewall no repo. Não há evidência de acesso não autorizado, e
**seguimos assumindo que ninguém acessou** (decisão consciente, risco residual aceito).

**Detecção:** o Pedro testou as portas de fora da VPS (do próprio PC, IP externo) e viu
que abriam, apesar do ufw ativo.

**Correção — 2 camadas:**

1. **iptables (mitigação imediata, sem recriar container, sem downtime).** 29 portas
   bloqueadas para origem externa (interface `eth0`); **livekit fica público**
   (WebRTC exige: 7880/7881 + UDP 50000-50100).
   - IPv4 → cadeia `DOCKER-USER` (roda **após o DNAT**, então casa a porta do host por
     `-m conntrack --ctorigdstport`, não `--dport`).
   - IPv6 → cadeia `INPUT` (o `docker-proxy` atende `[::]` como socket local; a VPS tem
     IPv6 público). Casa `--dport`.
   - Não afeta o funcionamento: o nginx entra por loopback (`lo`) e os containers falam
     entre si pela rede Docker (nome de serviço), não pela porta do host.
   - **Persistido** com `netfilter-persistent` (serviço habilitado → sobrevive reboot).
     Verificação: `DROP` count = **29** em `DOCKER-USER` (v4) e em `INPUT` (v6).

2. **compose `127.0.0.1:` (fix durável).** Prefixado nas 29 portas (livekit não),
   commit `b4d0d6edf` na `develop`. Backstop para o caso das regras iptables se
   perderem. Só materializa quando a clone da VPS (`/opt/apps/os-tasks`) faz `git pull`
   e os pods são recriados; até lá o iptables cobre.

**Verificação:** após a correção, `Test-NetConnection` de fora retornou
`TcpTestSucceeded = False` em todas as portas testadas (incl. 26257, 4005, 13000,
13332); site normal no browser; transactor `/api/v1/health` = 200.

**Pegadinha registrada:** numa etapa intermediária as regras iptables "sumiram" porque
o `netfilter-persistent` não estava habilitado (o `save` não era recarregado no boot).
Recriar containers / rodar `3f-build.sh` **não** apaga o `DOCKER-USER`, mas um reboot
sem persistência habilitada zera tudo. Sempre conferir o `grep -c DROP` = 29.

**Pendências de hardening (não bloqueiam; incidente contido):**
- Rotacionar credencial do **MinIO** (`minioadmin/minioadmin`, ainda default mesmo agora
  que é só interno).
- Avaliar **senha/TLS no CockroachDB** (hoje `--insecure`): exige modo secure (certs) +
  trocar a connection string de ~10 pods + restart com reconnect storm. Deliberado, em
  janela.
- Fazer o compose `127.0.0.1` valer na VPS (`git pull` + recreate) para não depender só
  do iptables.

**Contexto relacionado:** rotação do `SERVER_SECRET` (2026-07-09, commit `71990885e`) —
ver `3f-docs/INFRA.md` §2.1 e a estratégia de CI/CD em
`3f-docs/features/projeto-pedro/estrategia-cicd.md`.
