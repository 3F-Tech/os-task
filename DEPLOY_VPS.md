# Deploy 3F Hub na VPS

> Guia completo para subir o 3F Hub (fork customizado do Huly) em uma VPS Linux.

---

## Requisitos da VPS

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 4 vCPUs | 8 vCPUs |
| RAM | 8 GB | 16 GB |
| Disco | 60 GB SSD | 100 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Docker | 24+ | 26+ |

---

## Visão Geral da Estratégia

O frontend e o account service são **imagens base do Huly com bundles customizados injetados via volume mount**. Isso significa que você não precisa buildar as imagens Docker do zero — basta:

1. **Buildar localmente** (na sua máquina Windows)
2. **Enviar os artefatos** compilados para a VPS via rsync/scp
3. **Configurar o ambiente** na VPS (trocar `huly.local` pelo IP/domínio da VPS)
4. **Subir os containers** com docker compose

---

## ETAPA 1 — Build Local (na sua máquina)

Execute no terminal do projeto:

```bash
# 1. Instalar dependências (nunca use pnpm diretamente)
rush install

# 2. Build completo (~15-20 min na primeira vez)
rush build

# 3. Gerar bundles dos pods
rush bundle

# 4. Buildar imagens Docker localmente (opcional, não necessário para esta estratégia)
# rush docker:build
```

Após o bundle, os artefatos customizados ficam em:
- `pods/front/bundle/bundle.js` — frontend compilado
- `pods/front/dist/` — assets do frontend
- `pods/account/bundle/bundle.js` — account service compilado

---

## ETAPA 2 — Preparar a VPS

### 2.1 Instalar Docker e Docker Compose

```bash
# Conectar na VPS
ssh root@SEU_IP_VPS

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Adicionar usuário ao grupo docker (se não for root)
usermod -aG docker $USER

# Verificar
docker --version
docker compose version
```

### 2.2 Criar estrutura de diretórios na VPS

```bash
mkdir -p /opt/3fhub/dev
mkdir -p /opt/3fhub/pods/front/bundle
mkdir -p /opt/3fhub/pods/front/dist
mkdir -p /opt/3fhub/pods/account/bundle
mkdir -p /opt/3fhub/services/sign/pod-sign/debug
```

---

## ETAPA 3 — Transferir Artefatos para a VPS

Execute **na sua máquina Windows** (no WSL ou Git Bash):

```bash
VPS_IP="SEU_IP_VPS"
VPS_USER="root"
VPS_DIR="/opt/3fhub"

# Enviar bundles compilados
scp pods/front/bundle/bundle.js ${VPS_USER}@${VPS_IP}:${VPS_DIR}/pods/front/bundle/
scp -r pods/front/dist/ ${VPS_USER}@${VPS_IP}:${VPS_DIR}/pods/front/
scp pods/account/bundle/bundle.js ${VPS_USER}@${VPS_IP}:${VPS_DIR}/pods/account/bundle/

# Enviar configurações do docker compose
scp dev/docker-compose.yaml ${VPS_USER}@${VPS_IP}:${VPS_DIR}/dev/
scp dev/branding.json ${VPS_USER}@${VPS_IP}:${VPS_DIR}/dev/

# Enviar certificado do sign service
scp services/sign/pod-sign/debug/certificate.p12 ${VPS_USER}@${VPS_IP}:${VPS_DIR}/services/sign/pod-sign/debug/
scp services/sign/pod-sign/debug/branding.json ${VPS_USER}@${VPS_IP}:${VPS_DIR}/services/sign/pod-sign/debug/
```

> **Dica:** Para atualizações futuras, use `rsync -avz --progress` no lugar de `scp` — ele só transfere o que mudou.

```bash
# Exemplo de atualização futura (só o front)
rsync -avz pods/front/bundle/bundle.js ${VPS_USER}@${VPS_IP}:${VPS_DIR}/pods/front/bundle/
rsync -avz pods/front/dist/ ${VPS_USER}@${VPS_IP}:${VPS_DIR}/pods/front/dist/
```

---

## ETAPA 4 — Configurar Variáveis de Ambiente na VPS

Na VPS, crie o arquivo `.env` dentro de `/opt/3fhub/dev/`:

```bash
cat > /opt/3fhub/dev/.env << 'EOF'
STORAGE_CONFIG="datalake|http://huly.local:4030"
DB_CR_URL=postgresql://root@huly.local:26257/defaultdb?sslmode=disable
QUEUE_CONFIG=redpanda:9092
BACKUP_STORAGE_CONFIG="minio|minio?accessKey=minioadmin&secretKey=minioadmin"
BACKUP_BUCKET_NAME=backups
PLATFORM_ADMIN_EMAILS=pedrobartelle@3fventure.com.br
EOF
```

> `huly.local` continua funcionando dentro dos containers pois o docker-compose usa `extra_hosts: huly.local:host-gateway` — ele resolve para o IP do host automaticamente.

---

## ETAPA 5 — Ajustar URLs Públicas no docker-compose.yaml

Na VPS, edite `/opt/3fhub/dev/docker-compose.yaml` e substitua as URLs que o **navegador do cliente** precisa acessar.

Troque `huly.local` pelo **IP público da VPS** (ou domínio, se tiver):

```bash
# Substituição em massa (troca todas as ocorrências de cliente)
sed -i 's|ACCOUNTS_URL_CLIENT=http://localhost:3000|ACCOUNTS_URL_CLIENT=http://SEU_IP_VPS:3000|g' /opt/3fhub/dev/docker-compose.yaml
sed -i 's|BRANDING_URL=http://huly.local:8087|BRANDING_URL=http://SEU_IP_VPS:8087|g' /opt/3fhub/dev/docker-compose.yaml
```

> **Atenção:** As URLs `http://huly.local:XXXX` nos serviços que comunicam **entre containers** podem ficar como estão — elas resolvem via `extra_hosts`. Só mude as que o navegador acessa diretamente (`ACCOUNTS_URL_CLIENT`, `BRANDING_URL`, `FRONT_URL` se for usar domínio).

### Se tiver domínio (ex: hub.3fventure.com.br)

Troque as URLs públicas pelo domínio:
```bash
# No front service
ACCOUNTS_URL_CLIENT=https://hub.3fventure.com.br:3000
BRANDING_URL=https://hub.3fventure.com.br/branding.json
FRONT_URL=https://hub.3fventure.com.br
```

---

## ETAPA 6 — Subir os Serviços

```bash
cd /opt/3fhub/dev

# Subir tudo em background
docker compose up -d

# Acompanhar os logs
docker compose logs -f

# Verificar se todos estão rodando
docker compose ps
```

### Ordem de inicialização esperada

Os containers sobem em paralelo mas aguardam dependências via `healthcheck`. A ordem lógica é:

1. `cockroach`, `redpanda`, `minio`, `elastic`, `redis` — infraestrutura
2. `stats`, `account` — serviços base
3. `transactor_cockroach`, `workspace_cockroach`, `collaborator` — core
4. `front`, `fulltext_cockroach`, demais serviços — camada de aplicação

Aguarde ~2-3 minutos para todos ficarem `healthy`.

---

## ETAPA 7 — Verificar Funcionamento

```bash
# Checar status
docker compose ps

# Testar account service
curl -s http://localhost:3000/api/v1/statistics | head -5

# Testar front
curl -s http://localhost:8087 | head -5
```

Acesse no navegador: `http://SEU_IP_VPS:8087`

---

## ETAPA 8 — Configurar Nginx (Opcional mas Recomendado)

Se quiser acessar via porta 80 / 443 com domínio:

```bash
# Instalar nginx
apt install -y nginx

# Criar configuração
cat > /etc/nginx/sites-available/3fhub << 'EOF'
server {
    listen 80;
    server_name hub.3fventure.com.br;  # ou SEU_IP_VPS

    location / {
        proxy_pass http://localhost:8087;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
EOF

ln -s /etc/nginx/sites-available/3fhub /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### HTTPS com Let's Encrypt (se tiver domínio)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d hub.3fventure.com.br
```

---

## ETAPA 9 — Criar Workspace Inicial

Na primeira vez, o workspace precisa ser criado. Acesse `http://SEU_IP_VPS:8087` e:

1. Clique em **Create workspace**
2. Crie o workspace **3FVenture**
3. Faça login com o email admin configurado em `PLATFORM_ADMIN_EMAILS`

---

## Processo de Atualização (Deploy de Novas Versões)

Quando fizer mudanças no código local:

```bash
# 1. Build local
rush build && rush bundle

# 2. Enviar para VPS
VPS_IP="SEU_IP_VPS"
rsync -avz pods/front/bundle/bundle.js root@${VPS_IP}:/opt/3fhub/pods/front/bundle/
rsync -avz pods/front/dist/ root@${VPS_IP}:/opt/3fhub/pods/front/dist/
rsync -avz pods/account/bundle/bundle.js root@${VPS_IP}:/opt/3fhub/pods/account/bundle/

# 3. Reiniciar apenas os containers afetados na VPS
ssh root@${VPS_IP} "cd /opt/3fhub/dev && docker compose restart front account"
```

> O restart do `front` e `account` é suficiente para a maioria das mudanças de frontend e lógica de autenticação. Para mudanças no `transactor` ou `workspace`, reinicie esses containers também.

---

## Portas Abertas no Firewall da VPS

Configure o firewall para liberar:

| Porta | Serviço | Necessário externamente? |
|---|---|---|
| 80 / 443 | Nginx (frontend) | Sim |
| 8087 | Frontend (direto, sem nginx) | Opcional |
| 3000 | Account service | Sim (API de autenticação) |
| 3332 | Transactor (WebSocket) | Sim |
| 3078 | Collaborator (WebSocket) | Sim |
| 4030 | Datalake (arquivos) | Sim |
| 4040 | Preview service | Sim |
| 8096 | HulyLake | Sim |
| 8099 | HulyPulse (WebSocket) | Sim |

```bash
# UFW (Ubuntu)
ufw allow 80
ufw allow 443
ufw allow 3000
ufw allow 3332
ufw allow 3078
ufw allow 4030
ufw allow 4040
ufw allow 8087
ufw allow 8096
ufw allow 8099
ufw enable
```

---

## Troubleshooting

### Container não sobe / fica reiniciando
```bash
docker compose logs nome-do-container --tail=50
```

### CockroachDB com problema de permissão
```bash
docker compose exec cockroach ./cockroach sql --insecure -e "CREATE DATABASE IF NOT EXISTS defaultdb;"
```

### Front não carrega após atualização
```bash
# Verificar se o bundle chegou
docker compose exec front ls -la /app/bundle.js

# Forçar rebuild do container
docker compose up -d --force-recreate front
```

### Elasticsearch com erro de memória
Adicione no host da VPS:
```bash
echo "vm.max_map_count=262144" >> /etc/sysctl.conf
sysctl -p
```

### Ver todos os logs em tempo real
```bash
docker compose logs -f --tail=100
```
