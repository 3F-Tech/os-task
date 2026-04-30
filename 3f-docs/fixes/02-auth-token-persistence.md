# Fix 02 — Auth Token Persistence (logout on F5)

## Causa raiz

O usuário era deslogado a cada F5/reload porque o cookie de autenticação
(`account-metadata-Token`) não era enviado nas requisições subsequentes à
recarga da página.

### Fluxo após login

1. `logIn()` → PUT `/cookie` no account server (`huly.local:3000`)
2. Servidor define cookie: `account-metadata-Token=<jwt>; HttpOnly; SameSite=Lax; Domain=huly.local`
3. Token também salvo em memória (`presentation.metadata.Token`)

### Problema no F5

1. Memória limpa → `presentation.metadata.Token = undefined`
2. `connect.ts` chama `selectWorkspace(wsUrl, undefined)`
3. Request POST com `credentials: 'include'` para `huly.local:3000`
4. **Cookie NÃO enviado** — `SameSite: lax` bloqueia cookies cross-site
   - Browser em `localhost:8087` → request para `huly.local:3000`
   - `localhost` ≠ `huly.local` = origens diferentes (cross-site)
   - POST cross-site com `SameSite=Lax` → cookie bloqueado pelo browser
5. Servidor recebe request sem cookie → token vazio → `TokenError` → 401
6. Client recebe Unauthorized → navega para `/login/login`

### Por que surgiu este problema

O commit `5d9b2895d` adicionou `sameSite: 'lax'` explicitamente ao cookie.
Antes, sem a declaração, Chrome 80+ já aplicava Lax como default — então
o comportamento cross-site já era bloqueado. O problema existia antes, mas
o commit anterior em connect.ts comentou o redirect de debug mascarando o sintoma.

## Solução implementada

### Variável `ACCOUNTS_URL_CLIENT`

Adicionada nova env var `ACCOUNTS_URL_CLIENT` para separar:
- `ACCOUNTS_URL` — URL interna Docker (`huly.local:3000`), usada server-to-server
- `ACCOUNTS_URL_CLIENT` — URL pública (`localhost:3000`), enviada ao browser via `/config.json`

O account server já expõe a porta `3000:3000` no docker-compose, então
`localhost:3000` é acessível diretamente do host.

Com `ACCOUNTS_URL_CLIENT=http://localhost:3000`:
- Browser em `localhost:8087` → request para `localhost:3000`
- MESMO HOST → cookie enviado sem restrições de SameSite ✓

### Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `server/front/src/starter.ts` | Lê `ACCOUNTS_URL_CLIENT` do ambiente |
| `server/front/src/index.ts` | `/config.json` usa `accountsUrlClient` quando disponível |
| `dev/docker-compose.yaml` | Adiciona `ACCOUNTS_URL_CLIENT=http://localhost:3000` ao serviço `front` |
| `plugins/workbench-resources/src/connect.ts` | Reverte debug hack; restaura `logOut()` no caso de falha |
| `plugins/login-resources/src/utils.ts` | Remove logs de debug do `getAccount()` |

## Fluxo corrigido

```
Login
  └─→ PUT /cookie → localhost:3000 → Set-Cookie: ...; Domain=localhost
  └─→ Navega para workbench

F5 / Reload
  └─→ Token em memória = undefined
  └─→ connect.ts → selectWorkspace(wsUrl, undefined)
  └─→ POST localhost:3000 com credentials: include
  └─→ Browser envia cookie (mesmo host: localhost) ✓
  └─→ Servidor valida cookie → retorna WorkspaceLoginInfo
  └─→ Sessão restaurada ✓
```

## Como testar

1. Fazer login → verificar Network tab: PUT /cookie retorna 204 com Set-Cookie
2. Verificar Application → Cookies → `account-metadata-Token` existe com domain `localhost`
3. Pressionar F5 → verificar que permanece logado
4. Abrir nova aba → verificar que permanece logado
5. Fechar browser → reabrir → deve pedir login (sessionStorage não persiste)

## Deploy

Requer rebuild do pod `front` e restart dos containers:

```bash
./3f-build.sh --skip-rush --skip-webpack --pod front
```

## Notas de segurança

- Cookie continua `HttpOnly` (não acessível via JS)
- Cookie continua `SameSite=Lax` (proteção CSRF mantida)
- Mudança é somente na URL usada pelo browser (localhost vs huly.local)
- Sem mudanças no modelo de dados ou no sistema de permissões
