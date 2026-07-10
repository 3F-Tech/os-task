# INCIDENTES.md — Registro de incidentes de produção (3F Tasks)

Log cronológico (mais recente no topo). Cada entrada: o que houve, desde quando,
como foi detectado, impacto, o que foi feito e o que ficou pendente. Sem segredos.

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
