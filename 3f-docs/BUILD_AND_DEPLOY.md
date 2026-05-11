# 3F Hub — Build, Deploy e Troubleshooting

Guia técnico completo para build, deploy na VPS e resolução de problemas.
Escrito para agentes IA ou desenvolvedores que precisam diagnosticar falhas.

---

## 1. Arquitetura de Versionamento

O Huly usa **dois números de versão distintos e independentes**:

| Variável | O que representa | Fonte | Onde aparece |
|---|---|---|---|
| `MODEL_VERSION` | Versão do modelo de dados (schema) | `common/scripts/version.txt` | `process.env.MODEL_VERSION` nos bundles Node.js |
| `VERSION` | Versão do release do software | `common/scripts/tag.txt` | `process.env.VERSION` nos bundles Node.js |

**Valores atuais:**
- `common/scripts/version.txt` → `"0.7.344"` (aspas fazem parte do valor — é uma string JS literal)
- `common/scripts/tag.txt` → `"0.7.413"` (aspas fazem parte do valor)

### Como os valores são injetados nos bundles

O `esbuild` **bake** os valores em tempo de build — eles não são lidos do ambiente em runtime:

```
rushx bundle
  → chama common/scripts/esbuild.js
    → chama show_version.js  → lê version.txt  → MODEL_VERSION="0.7.344"
    → chama show_tag.js      → lê tag.txt       → VERSION="0.7.413"
    → esbuild substitui process.env.MODEL_VERSION e process.env.VERSION no bundle.js
```

O `bundle.js` gerado contém literalmente `"0.7.344"` hardcoded. Mudar variáveis de ambiente no Docker não afeta esses valores — é preciso **rebuildar**.

### Por que version.txt/tag.txt em vez de git tags

O fork não tem as tags git do upstream (ex: `v0.7.413`). Os scripts originais (`show_version.js`, `show_tag.js`) usavam `git describe --tags` como fonte primária e caíam para `"0.6.0"` se falhasse. Isso causava todos os serviços reportarem `0.6.0` mesmo num fork do `0.7.413`.

**Fix aplicado:** ambos os scripts agora tentam `version.txt`/`tag.txt` **antes** de chamar o git. Se o arquivo existir, usa seu valor sem depender de tags git.

---

## 2. Serviços Custom vs Oficiais

O fork mantém **imagens customizadas** (`:3f-local`) para todos os serviços que têm código modificado ou precisam de MODEL_VERSION correto:

| Serviço | Imagem Docker | Por que custom |
|---|---|---|
| `front` | `hardcoreeng/front:3f-local` | Bundle baked com MODEL_VERSION correto + código customizado |
| `account` | `hardcoreeng/account:3f-local` | Fix do `withRetryUntilTimeout` + MODEL_VERSION |
| `collaborator` | `hardcoreeng/collaborator:3f-local` | Código customizado do fork |
| `workspace_cockroach` | `hardcoreeng/workspace:3f-local` | Migrations do fork (clientName, clientStage, WorkspaceMemberStatus) |
| `transactor_cockroach` | `hardcoreeng/transactor:3f-local` | MODEL_VERSION deve bater com a workspace DB |

Serviços que continuam usando imagens oficiais (sem código modificado):
`stream`, `fulltext`, `datalake`, `stats`, `rekoni`, `elastic`, `minio`, `cockroach`, `redpanda`, `redis`

---

## 3. Script de Build: `3f-build.sh`

### Uso

```bash
# Build completo (tudo)
./3f-build.sh --vps

# Só um pod (mais rápido)
./3f-build.sh --vps --pod front
./3f-build.sh --vps --pod server       # = transactor
./3f-build.sh --vps --pod account
./3f-build.sh --vps --pod collaborator
./3f-build.sh --vps --pod workspace

# Multiplos pods
./3f-build.sh --vps --pod "front account"

# Pular rush build (quando só empacotamento/docker mudou)
./3f-build.sh --vps --pod front --skip-rush

# Forçar rebuild total (limpa cache do rush)
./3f-build.sh --vps --clean --no-cache
```

### O que cada flag faz

| Flag | Efeito |
|---|---|
| `--vps` | Usa `dev/docker-compose.vps.yaml` em vez de `dev/docker-compose.yaml` |
| `--pod <nome>` | Limita o build ao(s) pod(s) indicado(s) (padrão: todos) |
| `--skip-rush` | Pula `rush build` (só bundle + docker build + restart) |
| `--skip-webpack` | Pula webpack (só necessário quando front mudou) |
| `--clean` | Usa `rush rebuild` em vez de `rush build` incremental |
| `--no-cache` | Passa `--no-cache` para `docker build` |

### Passos executados

1. `rush build` (ou `rush rebuild` com `--clean`) — compila TypeScript de todo o monorepo
2. Webpack — bundle do frontend Svelte (só se `front` estiver nos pods)
3. `rushx bundle` — empacota cada pod com esbuild
4. `docker build` — cria imagem Docker do pod
5. `docker-compose up -d` — reinicia o container

### Permissão de execução

No Linux/VPS, se der `Permission denied`:
```bash
# Alternativa sem precisar de chmod:
bash 3f-build.sh --vps --pod server
```

---

## 4. Workspace Model Version (CockroachDB)

O número `MODEL_VERSION` também é armazenado **no banco de dados** (`workspace_status.version`).

### Como funciona o upgrade

Quando o `workspace_cockroach` inicia:
1. Lê seu próprio `MODEL_VERSION` compilado (ex: `0.7.344`)
2. Consulta o banco: qual é a versão atual do workspace?
3. Se `db_version < compiled_version` → executa migrations (`tryMigrate`, `mode: 'upgrade'`)
4. Ao terminar: registra `---UPGRADE-DONE---` no log

### Quando o upgrade NÃO é disparado

Se `version.txt` tem o mesmo valor que a versão já gravada no banco, nenhum upgrade roda.
Para forçar um upgrade (ex: adicionar novas migrations):
1. Incremente `version.txt` (ex: `"0.7.343"` → `"0.7.344"`)
2. Rebuilde workspace: `./3f-build.sh --vps --pod workspace --skip-rush --skip-webpack`
3. Reinicie o container e aguarde `---UPGRADE-DONE---` nos logs

### Regra crítica: todos os serviços devem ter o mesmo MODEL_VERSION

O transactor (servidor principal) recusa conexões se o `MODEL_VERSION` compilado nele for **menor** que a versão no banco. Resultado: tela "Preparing workspace for new version" travada.

**Qualquer vez que `version.txt` for incrementado, todos os pods devem ser reconstruídos.**

---

## 5. Problemas Frequentes e Soluções

### 5.1 "Preparing workspace for new version" trava na tela

**Sintoma:** Browser fica preso nessa mensagem. Hard refresh não resolve.

**Causa mais provável:** O `MODEL_VERSION` compilado no transactor é **menor** que a versão gravada no banco da workspace.

**Diagnóstico:**
```bash
# Na VPS — ver versão compilada no transactor
docker-compose -f dev/docker-compose.vps.yaml exec transactor_cockroach \
  node -e "const b = require('./bundle/bundle.js'); console.log('MODEL_VERSION baked')" 2>/dev/null || \
  grep -o '"MODEL_VERSION":"[^"]*"' /proc/$(docker inspect transactor_cockroach --format '{{.State.Pid}}')/cmdline 2>/dev/null

# Ver versão no banco
docker-compose -f dev/docker-compose.vps.yaml exec cockroach \
  ./cockroach sql --insecure -e \
  "SELECT workspace, version FROM huly.workspace_status LIMIT 5;"

# Ver config.json servido ao browser
curl -s http://localhost:8087/config.json
```

**Solução:** Rebuildar o transactor com MODEL_VERSION correto:
```bash
./3f-build.sh --vps --pod server --skip-rush --skip-webpack
```

---

### 5.2 VERSION ou MODEL_VERSION = "0.6.0" no bundle

**Sintoma:** `config.json` retorna `MODEL_VERSION: "0.6.0"` ou `VERSION: "0.6.0"`.

**Causa:** `show_version.js` ou `show_tag.js` não encontrou `version.txt`/`tag.txt` e caiu no fallback `"0.6.0"`.

**Verificação:**
```bash
# Os arquivos existem?
ls common/scripts/version.txt
ls common/scripts/tag.txt

# O que contém?
cat common/scripts/version.txt   # deve ser "0.7.344" (com aspas)
cat common/scripts/tag.txt       # deve ser "0.7.413" (com aspas)
```

**Solução:** Criar/corrigir os arquivos (com aspas como parte do conteúdo):
```bash
echo '"0.7.344"' > common/scripts/version.txt
echo '"0.7.413"' > common/scripts/tag.txt
```
Depois rebuildar os pods afetados.

---

### 5.3 "version X is not in sync with server version Y"

**Sintoma:** Mensagem de erro no browser comparando versões do cliente e do servidor.

**Causa:** `VERSION` (software version) compilada no `front/bundle.js` não bate com a do `transactor/bundle.js`.

**Solução:** Garantir que `tag.txt` tem o mesmo valor em ambos os builds e rebuildar `front` e `server`:
```bash
./3f-build.sh --vps --pod "front server"
```

---

### 5.4 `ancestors not found: contact:class:WorkspaceMemberStatus`

**Sintoma:** Erro no console do browser ao editar issues. Campos `clientName`/`clientStage` ausentes.

**Causa:** O fork adicionou `WorkspaceMemberStatus` e campos customizados ao modelo. Se o `workspace_cockroach` for a imagem oficial (não a `:3f-local`), as migrations do fork nunca rodaram.

**Solução:**
1. Verificar que `dev/docker-compose.vps.yaml` usa `hardcoreeng/workspace:3f-local`
2. Rebuildar workspace com MODEL_VERSION **maior** que a versão atual do banco para forçar o upgrade:
   ```bash
   ./3f-build.sh --vps --pod workspace --skip-rush --skip-webpack
   ```
3. Aguardar nos logs: `---UPGRADE-DONE--- oldVersion=... requestedVersion=...`

---

### 5.5 `rush build` falha com "Build cache only supported in Git repository"

**Sintoma:** Erro durante `rush build` na VPS.

**Causa:** Arquivos de dados (Elasticsearch, etc.) foram rastreados pelo git, corrompendo o repositório.

**Diagnóstico:**
```bash
git status  # procurar arquivos em data/elastic/ ou data/cockroach/
```

**Solução:**
```bash
# Adicionar data/ ao .gitignore (já feito)
echo "data/" >> .gitignore

# Remover do tracking sem deletar os arquivos
git rm -r --cached data/ 2>/dev/null || true
git commit -m "chore: remove data/ from git tracking"
```

---

### 5.6 `docker-compose up` falha com `KeyError: 'ContainerConfig'`

**Sintoma:** Erro ao recriar containers na VPS com docker-compose v1.

**Causa:** docker-compose v1 (1.29.2) tem um bug ao recriar containers builados com Docker 24+.

**Solução:** Remover os containers antes de subir:
```bash
docker-compose -f dev/docker-compose.vps.yaml rm -f transactor_cockroach
docker-compose -f dev/docker-compose.vps.yaml up -d transactor_cockroach
```
O `3f-build.sh` já faz isso automaticamente quando detecta docker-compose v1.

---

### 5.7 Campos/seções customizadas não aparecem (PDCA, clientName, etc.)

**Sintoma:** Campos do fork ausentes na UI após deploy.

**Causa provável:** migrations do workspace não rodaram (ver 5.4), ou o `front` ainda está servindo um bundle antigo.

**Diagnóstico:**
```bash
# Ver qual imagem o front está usando
docker inspect front --format '{{.Config.Image}}'
# Deve ser hardcoreeng/front:3f-local

# Ver MODEL_VERSION do config.json
curl -s https://3ftasks.3fventure.tech/config.json | python3 -m json.tool
```

**Solução:** Rebuildar front e workspace:
```bash
./3f-build.sh --vps --pod "front workspace"
```

---

### 5.8 Workspace travado em `pending-creation` (nunca cria)

**Sintoma:** Usuário clica "Criar workspace", fica em 0% indefinidamente. Sem erros no console.

**Causa provável:** Incompatibilidade de versão entre `workspace_cockroach` e `account`. O serviço workspace sonda o account via HTTP (`POST account:3000/` com `getPendingWorkspace`) a cada 5s. Se as versões não batem, o account retorna `null` silenciosamente.

**Diagnóstico:**
```bash
# Ver logs do workspace_cockroach
docker-compose -f dev/docker-compose.vps.yaml logs -f workspace_cockroach 2>&1 | tail -30

# Versão reportada deve ser >= 0.7.413
# Se mostrar "0.6.x" → imagem errada (oficial em vez de :3f-local)
```

**Solução:** Garantir que workspace usa imagem `:3f-local` e rebuildar.

---

### 5.9 URL interna retornando HTML em vez de JSON (`Unexpected token '<'`)

**Sintoma:** Serviços retornam HTML (página de erro do Nginx) em vez de JSON.

**Causa:** Serviço tentando conectar em `huly.local:3000` que resolve para o app nativo da VPS na porta 3000, não para o container.

**Solução:** Substituir referências `huly.local:<porta>` pelos nomes internos do Docker Compose:
- `huly.local:3000` → `account:3000`
- `huly.local:4030` → `datalake:4030`

Verificar todas as entradas `environment:` no `docker-compose.vps.yaml`.

---

## 6. Checklist de Deploy Completo (VPS)

Usar quando a VPS estiver desatualizada ou apresentar erros persistentes:

```bash
# 1. Atualizar código
git pull

# 2. Verificar arquivos de versão
cat common/scripts/version.txt  # "0.7.344"
cat common/scripts/tag.txt      # "0.7.413"

# 3. Build completo de todos os pods customizados
./3f-build.sh --vps

# 4. Aguardar upgrade do workspace nos logs
docker-compose -f dev/docker-compose.vps.yaml logs -f workspace_cockroach 2>&1 | grep -E "UPGRADE|version"
# Esperado: ---UPGRADE-DONE---

# 5. Verificar config.json
curl -s https://3ftasks.3fventure.tech/config.json | python3 -m json.tool
# MODEL_VERSION deve bater com version.txt
# VERSION deve bater com tag.txt

# 6. Verificar todos os containers rodando
docker-compose -f dev/docker-compose.vps.yaml ps
```

---

## 7. Estrutura de Arquivos Críticos para Build

```
huly-3f/
├── common/scripts/
│   ├── esbuild.js          ← orchestrador do bundle (lê show_version.js e show_tag.js)
│   ├── show_version.js     ← retorna MODEL_VERSION (lê version.txt primeiro)
│   ├── show_tag.js         ← retorna VERSION (lê tag.txt primeiro)
│   ├── version.txt         ← "0.7.344" — versão do modelo de dados (com aspas)
│   └── tag.txt             ← "0.7.413" — versão do release (com aspas)
├── dev/
│   ├── docker-compose.vps.yaml   ← compose da VPS (imagens :3f-local)
│   └── docker-compose.yaml       ← compose local
├── pods/
│   ├── front/              ← frontend server (serve /config.json)
│   ├── server/             ← transactor (servidor principal de dados)
│   ├── account/            ← autenticação e workspaces
│   ├── collaborator/       ← edição colaborativa (Yjs)
│   └── workspace/          ← migrations e upgrade do workspace
├── models/
│   └── tracker/src/migration.ts  ← migrations do fork (clientName, clientStage, etc.)
└── 3f-build.sh             ← script de build e deploy
```

---

## 8. Referências de Logs

### Upgrade de workspace bem-sucedido
```
workspace_cockroach | Starting workspace service ... for version: 0.7.344
workspace_cockroach | upgrading job='xxxx' force=false currentVersion='0.7.343' toVersion='0.7.344'
workspace_cockroach | ---UPGRADE-DONE--- job='xxxx' oldWorkspaceVersion={...343} requestedVersion={...344} time=619
```

### Transactor pronto para conexões
```
transactor_cockroach | started transactor on port 3332
```

### Erro de versão (transactor rejeita workspace)
```
transactor_cockroach | workspace version X.Y.Z is incompatible with server version A.B.C
```
Solução: rebuildar transactor com MODEL_VERSION = versão do banco.

### Migrations do fork (workspace)
```
workspace_cockroach | Running migration: clientFields
workspace_cockroach | clientFields migration complete
```
Se não aparecer após upgrade, verificar `models/tracker/src/migration.ts`.
