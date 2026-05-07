# Huly VPS Troubleshooting - Handoff Document
**Context:** This document serves as a bridge between Antigravity and Claude to coordinate the troubleshooting of the Huly "Workspace stuck at 0%" issue on a self-hosted VPS.

**Última atualização:** 2026-05-06 (sessão 3)

---

## System Architecture & Current State
- **Application:** Huly (custom fork "3F Hub") deployed via Docker Compose on an Ubuntu VPS.
- **Project path on VPS:** `/opt/apps/os-tasks`
- **Frontend/Proxy:** Nginx handles SSL termination and routes traffic to internal high-range ports mapped to Docker containers.
- **Network Routing:** The VPS host has native apps running on standard ports (e.g., 3000). To avoid conflicts, `huly.local` references inside Docker have been mostly migrated to use internal Docker service hostnames.
- **Docker Compose:** VPS has **docker-compose v1 (1.29.2)** installed (not the v2 plugin). `docker compose` (with space) is NOT available. All commands must use `docker-compose` (hyphen).
- **Current Issue:** When a user clicks "Create workspace" in the frontend, the UI hangs at 0% indefinitely. There are **no console errors** and **no WebSocket disconnects** in the browser.

---

## What is Working Perfectly
1. **Frontend to API:** The UI successfully hits the `account` container API to register the user.
2. **Account Creation:** The `account` container logs `Creating workspace record done` without any errors. It successfully writes to CockroachDB.
3. **Redpanda (Kafka):** Redpanda is up and healthy. The topic `cockroach.workspace` exists. The `transactor_cockroach` successfully joins the consumer group.
4. **WebSocket Connection:** The browser maintains a healthy, open WebSocket connection to `transactor_cockroach` waiting for progress events (0% -> 100%).
5. **workspace_cockroach handshake:** `workspace_cockroach` boots and logs `Successfully connected to the account service`.
6. **DB record confirmed:** SQL query confirmed 4 workspaces exist with `mode = 'pending-creation'`, `region = 'cockroach'`, `processing_attempts = 0`, `last_processing_time = 0`.
7. **`_pending_workspace_lock` table:** Confirmed has `id = 1` row — this is NOT the problem.

---

## IMPORTANT CORRECTION to Gemini's Analysis

Gemini stated: *"It never logs `consumer connected to queue`, meaning it never connects to Redpanda to receive the workspace creation event."*

**This is incorrect.** `workspace_cockroach` does NOT use Redpanda/Kafka to receive workspace creation events. It works by **HTTP polling**: it calls `getPendingWorkspace` as an RPC call (POST to `http://account:3000/` with JSON body `{ method: "getPendingWorkspace" }`) every 5 seconds. The Redpanda consumer in `workspace_cockroach` is for a different purpose (transaction log following), not workspace creation pickup.

The endpoint `/workspace/pending` (tested by Gemini and returning `Not Found`) does NOT exist. This test was a false clue.

---

## All Fixes Applied (Sessions 1–3)

### Fixes by Gemini (session 1)
1. **Host Port Conflicts (`Unexpected token '<'`):**
   - *Problem:* Services were trying to talk to `huly.local:3000` which resolved to the VPS host's native Node.js app returning HTML instead of JSON.
   - *Fix:* Replaced `huly.local:3000` → `account:3000` and `huly.local:4030` → `datalake:4030` across `docker-compose.yaml` and `.env`.

2. **Missing `ACCOUNTS_URL` in workspace_cockroach:**
   - *Fix:* Added `ACCOUNTS_URL=http://account:3000` to the `workspace_cockroach` environment block.

3. **YAML Syntax & Duplicate env vars:**
   - *Problem:* `sed` commands duplicated `ACCOUNTS_URL` across 11 services, causing Docker Compose YAML validation errors.
   - *Fix:* Perl script to deduplicate environment blocks.

4. **Branding Domain Mismatch:**
   - *Problem:* `branding.json` only contained `huly.local`, backend didn't recognize requests from `3ftasks.3fventure.tech`.
   - *Fix:* Updated `branding.json` with `protocol: https` and correct domain mapping.

### Fixes by Claude (session 2)

5. **`withRetryUntilTimeout` bug in `account-client` (CRITICAL, FIXED):**
   - **File:** `foundations/core/packages/account-client/src/client.ts`
   - *Problem:* The `withRetryUntilTimeout` function computed `const timeout = Date.now() + timeoutMs` **once at construction time** of `AccountClientImpl`. This means after 5 seconds from startup, ALL network errors stopped retrying immediately.
   - *Fix:* Moved timeout calculation inside the returned function (per-call). Fix committed locally and rebuilt into the `hardcoreeng/account` image on VPS.
   ```typescript
   // After (fixed):
   function withRetryUntilTimeout<T, F>(f: F, timeoutMs = 5000): F {
     return async function (...params) {
       const timeout = Date.now() + timeoutMs  // calculated per-call
       const shouldFail = (err) => !isNetworkError(err) || timeout < Date.now()
       return await withRetry(f, shouldFail)(...params)
     } as F
   }
   ```

6. **docker-compose v1 `KeyError: 'ContainerConfig'` error:**
   - *Problem:* docker-compose v1.29.2 throws `KeyError: 'ContainerConfig'` when recreating containers built with newer Docker image formats (Docker 24+).
   - *Workaround:* Must manually `rm -f` containers before `up`.
   - *Permanent fix in build script:* `3f-build.sh` now auto-detects docker-compose v1 and runs `rm -f` before `up`.

---

## CRITICAL DISCOVERY: Version Mismatch (Session 3)

**This is almost certainly the root cause.**

VPS logs from workspace_cockroach show:
```
Starting workspace service in region: cockroach for operation: all+backup for version: 0.6.493
```

- **`workspace_cockroach` is running the PUBLIC base image `hardcoreeng/workspace:latest` (v0.6.493)**
- **`account` is running a CUSTOM rebuilt image (v0.7.413) with the local `bundle.js`**

These two versions have an API incompatibility: `workspace_cockroach` (v0.6.493) sends a `getPendingWorkspace` RPC request that the `account` service (v0.7.413) receives but the response format or the version-matching logic has changed between 0.6.493 → 0.7.413.

### Confirmed behavior
- `workspace_cockroach` boots, handshake succeeds ("Successfully connected to the account service")
- Poll loop runs every 5s, calls `getPendingWorkspace`
- Account receives and processes the call — NO error logged in account
- `workspace_cockroach` gets `null` back — NO error logged in workspace
- Poll silently repeats forever

### Why it silently returns null (version mismatch theory)
In `server/account/src/serviceOperations.ts` → `getPendingWorkspace` (lines 259-297):
```typescript
// It calls: db.getPendingWorkspace(region, version, operation, 30000, wsLivenessMs)
// The `version` filter: workspace sends {major:0, minor:6, patch:493}
// Account v0.7.413 may filter by compatible version range and exclude 0.6.x
```

The SQL in `server/account/src/collections/postgres/postgres.ts` `getPendingWorkspace` (line 941+):
- Has a `version` compatibility check that compares the workspace_cockroach reported version against the workspace record's required version
- If v0.6.493 is below the minimum required version → returns 0 rows → null → silent no-op

---

## Current State

- 4 workspaces stuck in `pending-creation` in DB
- `workspace_cockroach` silently polls every 5s, gets null, never processes
- No errors anywhere — the silence IS the symptom

---

## Hypotheses Eliminated

| Hypothesis | Status |
|---|---|
| `_pending_workspace_lock` table empty | ❌ Eliminated — id=1 confirmed |
| `ACCOUNTS_URL` missing | ❌ Eliminated — added in session 1 |
| `withRetryUntilTimeout` bug | ❌ Eliminated — fixed in session 2 |
| Network connectivity broken | ❌ Eliminated — handshake succeeds |
| Workspace record `is_disabled` | ❌ Eliminated — query runs, lock held, no error |

---

## Root Cause Hypothesis

### Hypothesis A: Version incompatibility between workspace (0.6.493) and account (0.7.413) — MOST LIKELY

The `workspace_cockroach` running v0.6.493 sends `version: {major:0,minor:6,patch:493}` to account's `getPendingWorkspace`. The account service (v0.7.413) may have a version-range filter in the SQL that rejects workspaces whose recorded version doesn't match the worker's reported version.

**Fix:** Rebuild `workspace_cockroach` image from the local v0.7.413 source so both services run the same version.

```bash
# On local machine (Windows):
./3f-build.sh --vps --pod workspace --skip-rush --skip-webpack

# This will rebuild hardcoreeng/workspace:latest from local source
# Then transfer to VPS and restart workspace_cockroach
```

### Hypothesis B: Missing columns in VPS DB schema

Account v0.7.413 bundle may select columns that don't exist in the VPS DB (e.g., `usage_info` from migration v20, or `data_id`). If the SQL fails, `wrap()` catches it and returns `{error: InternalServerError}` — workspace logs "Error getting pending workspace:". We do NOT see this log, so this is less likely unless the SQL fails silently at the DB level.

**Test (check what columns exist):**
```bash
docker-compose -f /opt/apps/os-tasks/dev/docker-compose.vps.yaml exec cockroach \
  ./cockroach sql --insecure -e \
  "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'global_account' AND table_name IN ('workspace', 'workspace_status') ORDER BY table_name, column_name;"
```

---

## Recommended Fix Sequence

### Step 1 — Rebuild workspace_cockroach from local source (PRIMARY FIX)

On the local Windows machine:
```bash
./3f-build.sh --vps --pod workspace --skip-rush --skip-webpack
```

This will:
1. Bundle `pods/workspace`
2. Build `hardcoreeng/workspace:latest` Docker image from local v0.7.413 source
3. Transfer to VPS containers

**Note on transferring:** The build script builds locally. To get it to the VPS:
```bash
# Save image as tar
docker save hardcoreeng/workspace:latest | gzip > workspace-image.tar.gz

# Transfer to VPS
scp workspace-image.tar.gz root@VPS_IP:/opt/

# On VPS: load image and restart container
ssh root@VPS_IP "docker load < /opt/workspace-image.tar.gz && \
  docker stop workspace_cockroach && docker rm workspace_cockroach && \
  docker-compose -f /opt/apps/os-tasks/dev/docker-compose.vps.yaml up -d workspace_cockroach"
```

### Step 2 — Verify fix worked

After restarting, check workspace_cockroach logs:
```bash
docker-compose -f /opt/apps/os-tasks/dev/docker-compose.vps.yaml logs -f workspace_cockroach 2>&1 | head -50
```

Expected: Should now see `---CREATING----` messages instead of silent polling.

### Step 3 — If still stuck, run full diagnostic

```bash
# 1. Check if SQL returns rows manually
docker-compose -f /opt/apps/os-tasks/dev/docker-compose.vps.yaml exec cockroach \
  ./cockroach sql --insecure -e \
  "SELECT w.uuid, w.region, ws.mode, ws.processing_attempts, ws.last_processing_time FROM global_account.workspace w JOIN global_account.workspace_status ws ON w.uuid = ws.workspace_uuid WHERE ws.mode IN ('pending-creation', 'creating') AND ws.mode <> 'manual-creation' AND (ws.processing_attempts IS NULL OR ws.processing_attempts <= 3) AND (ws.last_processing_time IS NULL OR ws.last_processing_time < 9999999999999) AND w.region = 'cockroach' ORDER BY ws.last_visit DESC LIMIT 1;"

# 2. Check DB schema
docker-compose -f /opt/apps/os-tasks/dev/docker-compose.vps.yaml exec cockroach \
  ./cockroach sql --insecure -e \
  "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'global_account' AND table_name IN ('workspace', 'workspace_status') ORDER BY table_name, column_name;"

# 3. Test getPendingWorkspace via curl (generate JWT inside account container)
docker-compose -f /opt/apps/os-tasks/dev/docker-compose.vps.yaml exec account \
  node -e "
const crypto = require('crypto');
const h = Buffer.from(JSON.stringify({typ:'JWT',alg:'HS256'})).toString('base64url');
const p = Buffer.from(JSON.stringify({extra:{service:'workspace'},account:'1749089e-22e6-48de-af4e-165e18fbd2f9'})).toString('base64url');
const s = crypto.createHmac('sha256','secret').update(h+'.'+p).digest('base64url');
const token = h+'.'+p+'.'+s;
console.log('TOKEN:', token);
const http = require('http');
const body = JSON.stringify({method:'getPendingWorkspace',params:{region:'cockroach',version:{major:0,minor:7,patch:413},operation:'all+backup'}});
const opts = {host:'localhost',port:3000,method:'POST',path:'/',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'Content-Length':Buffer.byteLength(body)}};
const req = http.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log('RESPONSE:', d)); });
req.write(body); req.end();
"
```

---

## Key Source Code References

| File | Relevance |
|---|---|
| `foundations/core/packages/account-client/src/client.ts:307` | `AccountClientImpl` constructor — builds `this.rpc` with retry wrapper |
| `foundations/core/packages/account-client/src/client.ts` (withRetryUntilTimeout) | FIXED: timeout now per-call, not at construction |
| `server/workspace-service/src/service.ts:184` | Main poll loop — calls `getPendingWorkspace` every 5s |
| `server/workspace-service/src/index.ts:48` | `REGION=cockroach`, `WS_OPERATION=all+backup`, version read from package.json |
| `server/account/src/serviceOperations.ts:259` | `getPendingWorkspace` handler — verifies `extra.service==='workspace'` token claim |
| `server/account/src/serviceOperations.ts:447` | `workerHandshake` — logs "Worker handshake happened" |
| `server/account/src/collections/postgres/postgres.ts:941` | SQL implementation of `getPendingWorkspace` — uses version filter and `_pending_workspace_lock FOR UPDATE` |
| `server/account/src/utils.ts:174` | `wrap()` — catches all errors, returns `{error: status}` on failure |
| `foundations/core/packages/token/src/token.ts` | JWT generation/verification; `systemAccountUuid = '1749089e-22e6-48de-af4e-165e18fbd2f9'` |
| `dev/docker-compose.vps.yaml` | `workspace_cockroach` service: `REGION=cockroach`, `WS_OPERATION=all+backup`, `SERVER_SECRET=secret` |

---

## Important Technical Notes

### How `getPendingWorkspace` works (NOT Kafka)
`workspace_cockroach` polls via HTTP RPC: `POST http://account:3000/` with body `{method: "getPendingWorkspace", params: {...}}` every ~5s. Uses `_pending_workspace_lock FOR UPDATE` to serialize concurrent workers.

### JWT Token format for workspace service
The workspace service sends a JWT with claim `extra.service = 'workspace'` and `account = systemAccountUuid`. Secret is `SERVER_SECRET` env var (default: `'secret'`). The `decodeTokenVerbose` in account uses `noVerify=true` for the inner fallback decode — a syntactically invalid JWT silently fails.

### `processingTimeoutMs`
Hardcoded to `30 * 1000` (30 seconds) in `serviceOperations.ts:81`. After 30s without an update, a workspace is considered abandoned and can be re-picked.

### `last_processing_time` type
Stored as `BIGINT DEFAULT 0` in `workspace_status` — integer milliseconds, NOT a TIMESTAMPTZ. The SQL filter is `last_processing_time < Date.now() - processingTimeoutMs`.

### docker-compose v1 on VPS
Always use `docker-compose` (hyphen), never `docker compose` (space). `docker-compose rm -f` only removes **stopped** containers — if a container is still running it won't be removed. Always use `docker stop <name> && docker rm <name>` (or `docker stop $(docker ps -q) && docker rm $(docker ps -aq)` for all) before any `up` that recreates containers, to avoid `KeyError: 'ContainerConfig'` bug with Docker 24+ images.

### VPS docker-compose file location
Project lives at `/opt/apps/os-tasks` on the VPS. The compose file for all VPS operations is:
`/opt/apps/os-tasks/dev/docker-compose.vps.yaml`
