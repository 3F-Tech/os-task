#!/usr/bin/env bash
# =============================================================================
# 3f-build.sh — Build completo do 3F Hub e atualização dos containers Docker
# =============================================================================
# Uso:
#   ./3f-build.sh                    # build completo
#   ./3f-build.sh --no-cache         # Docker build sem cache
#   ./3f-build.sh --clean            # rush rebuild (força recompilação total)
#   ./3f-build.sh --skip-rush        # pula rush build (só bundle + docker)
#   ./3f-build.sh --skip-webpack     # pula webpack (quando só backend mudou)
#   ./3f-build.sh --vps              # usa docker-compose.vps.yaml (para VPS)
#   ./3f-build.sh --pod server        # reconstrói só o transactor
#   ./3f-build.sh --pod front         # reconstrói só o front
#   ./3f-build.sh --pod account       # reconstrói só o account
#   ./3f-build.sh --pod collaborator  # reconstrói só o collaborator
#   ./3f-build.sh --pod worker        # reconstrói só o time-machine/worker
#   ./3f-build.sh --pod workspace     # reconstrói só o workspace_cockroach
#   ./3f-build.sh --pod preview           # reconstrói só o preview
#   ./3f-build.sh --pod github            # reconstrói só o github service
#   ./3f-build.sh --pod mail              # reconstrói só o mail service
#   ./3f-build.sh --pod calendar          # reconstrói só o calendar service
#   ./3f-build.sh --pod fulltext          # reconstrói só o fulltext (indexação/busca)
#   ./3f-build.sh --pod datalake          # reconstrói só o datalake (storage de blobs)
#   ./3f-build.sh --pod "front account"  # dois pods
#   ./3f-build.sh --clean --no-cache --skip-webpack --pod server  # combinado
#   ./3f-build.sh --vps --clean --no-cache  # rebuild completo na VPS
# =============================================================================
set -euo pipefail

# ── Cores ────────────────────────────────────────────────────────────────────
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

# ── Defaults ─────────────────────────────────────────────────────────────────
NO_CACHE=false
SKIP_RUSH=false
SKIP_WEBPACK=false
CLEAN=false
VPS=false
# fulltext e worker carregam o modelo → precisam ser rebuildados junto num version
# bump, senão ficam stale (ex.: fulltext em 0.7.356 vs workspace 0.7.358 → busca morre).
PODS="server front account collaborator workspace fulltext worker"

# ── Parse de argumentos ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-cache)      NO_CACHE=true ;;
    --skip-rush)     SKIP_RUSH=true ;;
    --skip-webpack)  SKIP_WEBPACK=true ;;
    --clean)         CLEAN=true ;;
    --vps)           VPS=true ;;
    --pod)           PODS="$2"; shift ;;
    --help|-h)
      sed -n '/^# Uso/,/^# ====/p' "$0" | grep -v "^# ===="
      exit 0
      ;;
    *)
      echo -e "${RED}Opção desconhecida: $1${NC}"
      echo "Use ./3f-build.sh --help para ver as opções."
      exit 1
      ;;
  esac
  shift
done

# ── Helpers ───────────────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL_START=$(date +%s)

step() {
  echo -e "\n${BOLD}${BLUE}┌─ $1${NC}"
}

done_step() {
  local start=$1
  local elapsed=$(( $(date +%s) - start ))
  echo -e "${GREEN}└─ ✓ concluído em ${elapsed}s${NC}"
}

skip_step() {
  echo -e "${YELLOW}└─ ⏭  pulado${NC}"
}

info() {
  echo -e "${GRAY}   $1${NC}"
}

fail() {
  echo -e "\n${RED}${BOLD}✗ ERRO no passo: $1${NC}"
  echo -e "${RED}  Verifique o output acima para detalhes.${NC}"
  exit 1
}

# ── Cabeçalho ─────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════╗"
echo "║          3F Hub — Docker Build           ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

[[ "$CLEAN"        == true ]] && echo -e "  ${YELLOW}⚑ Modo: rebuild completo (--clean)${NC}"
[[ "$NO_CACHE"     == true ]] && echo -e "  ${YELLOW}⚑ Docker: sem cache (--no-cache)${NC}"
[[ "$SKIP_RUSH"    == true ]] && echo -e "  ${YELLOW}⚑ Rush build: pulado (--skip-rush)${NC}"
[[ "$SKIP_WEBPACK" == true ]] && echo -e "  ${YELLOW}⚑ Webpack: pulado (--skip-webpack)${NC}"
[[ "$VPS"          == true ]] && echo -e "  ${YELLOW}⚑ Modo VPS: docker-compose.vps.yaml${NC}"
echo -e "  ${GRAY}Pods: $PODS${NC}"
echo ""

# ── Detectar docker compose vs docker-compose ─────────────────────────────────
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
else
  COMPOSE_CMD="docker-compose"
fi

if [[ "$VPS" == true ]]; then
  COMPOSE_FILE="dev/docker-compose.vps.yaml"
else
  COMPOSE_FILE="dev/docker-compose.yaml"
fi

# ── Passo 1: Rush build ───────────────────────────────────────────────────────
step "1/5 — Rush build (TypeScript)"
T=$(date +%s)

if [[ "$SKIP_RUSH" == true ]]; then
  skip_step
else
  cd "$ROOT_DIR"
  if [[ "$CLEAN" == true ]]; then
    info "Modo: rush rebuild (força recompilação total)"
    rush rebuild || fail "rush rebuild"
  else
    info "Modo: rush build (incremental)"
    rush build || fail "rush build"
  fi
  done_step $T
fi

# ── Passo 2: Webpack (frontend bundle) ────────────────────────────────────────
step "2/5 — Webpack (frontend bundle)"
T=$(date +%s)

if [[ "$SKIP_WEBPACK" == true ]] || [[ "$PODS" != *"front"* ]]; then
  skip_step
else
  info "Compilando com webpack... (pode levar 5–15 min, terminal fica quieto)"
  cd "$ROOT_DIR/dev/prod"
  node -e "try{require('fs').rmSync('./dist',{recursive:true,force:true})}catch(e){}"
  WEBPACK_MINIMIZE="${WEBPACK_MINIMIZE:-false}" NODE_OPTIONS="--max-old-space-size=4096" ./node_modules/.bin/cross-env NODE_ENV=production ./node_modules/.bin/webpack --progress --stats-error-details || fail "webpack"
  done_step $T
fi

# ── Passo 3: Bundle dos pods ──────────────────────────────────────────────────
step "3/5 — Bundle dos pods"
T=$(date +%s)

if [[ "$PODS" == *"server"* ]]; then
  info "Bundlando transactor (server)..."
  cd "$ROOT_DIR/pods/server"
  rushx bundle || fail "bundle transactor"
fi

if [[ "$PODS" == *"account"* ]]; then
  info "Bundlando account..."
  cd "$ROOT_DIR/pods/account"
  rushx bundle || fail "bundle account"
fi

if [[ "$PODS" == *"worker"* ]]; then
  info "Bundlando worker (time-machine)..."
  cd "$ROOT_DIR/services/worker"
  rushx bundle || fail "bundle worker"
fi

if [[ "$PODS" == *"front"* ]]; then
  info "Bundlando front..."
  cd "$ROOT_DIR/pods/front"
  rushx bundle || fail "bundle front"
  info "Copiando assets do webpack para o front..."
  node -e "try{require('fs').rmSync('./dist',{recursive:true,force:true})}catch(e){}"
  cp -r "$ROOT_DIR/dev/prod/dist" .
  cp -r "$ROOT_DIR/dev/prod/public/"* ./dist/
  rm -f ./dist/config.json
fi

if [[ "$PODS" == *"collaborator"* ]]; then
  info "Bundlando collaborator..."
  cd "$ROOT_DIR/pods/collaborator"
  rushx bundle || fail "bundle collaborator"
fi

if [[ "$PODS" == *"workspace"* ]]; then
  info "Bundlando workspace..."
  cd "$ROOT_DIR/pods/workspace"
  rushx bundle || fail "bundle workspace"
fi

if [[ "$PODS" == *"preview"* ]]; then
  info "Bundlando preview..."
  cd "$ROOT_DIR/pods/preview"
  rushx bundle || fail "bundle preview"
fi

if [[ "$PODS" == *"github"* ]]; then
  info "Bundlando github service..."
  cd "$ROOT_DIR/services/github/pod-github"
  rushx bundle || fail "bundle github"
fi

if [[ "$PODS" == *"mail"* ]]; then
  info "Bundlando mail service..."
  cd "$ROOT_DIR/services/mail/pod-mail"
  rushx bundle || fail "bundle mail"
fi

if [[ "$PODS" == *"calendar"* ]]; then
  info "Bundlando calendar service..."
  cd "$ROOT_DIR/services/calendar/pod-calendar"
  rushx bundle || fail "bundle calendar"
fi

if [[ "$PODS" == *"fulltext"* ]]; then
  info "Bundlando fulltext..."
  cd "$ROOT_DIR/pods/fulltext"
  rushx bundle || fail "bundle fulltext"
fi

if [[ "$PODS" == *"datalake"* ]]; then
  info "Bundlando datalake..."
  cd "$ROOT_DIR/services/datalake/pod-datalake"
  rushx bundle || fail "bundle datalake"
fi

done_step $T

# ── Passo 4: Docker build ─────────────────────────────────────────────────────
step "4/5 — Docker build das imagens"
T=$(date +%s)

[[ "$NO_CACHE" == true ]] && export DOCKER_EXTRA="--no-cache" || export DOCKER_EXTRA=""

if [[ "$PODS" == *"server"* ]]; then
  info "Buildando imagem: hardcoreeng/transactor:3f-local"
  cd "$ROOT_DIR/pods/server"
  DOCKER_VERSION=3f-local bash ../../common/scripts/docker_build.sh hardcoreeng/transactor || fail "docker build transactor"
fi

if [[ "$PODS" == *"worker"* ]]; then
  info "Buildando imagem: hardcoreeng/worker"
  cd "$ROOT_DIR/services/worker"
  bash ../../common/scripts/docker_build.sh hardcoreeng/worker || fail "docker build worker"
fi

if [[ "$PODS" == *"front"* ]]; then
  info "Buildando imagem: hardcoreeng/front:3f-local"
  cd "$ROOT_DIR/pods/front"
  DOCKER_VERSION=3f-local bash ../../common/scripts/docker_build.sh hardcoreeng/front || fail "docker build front"
fi

if [[ "$PODS" == *"account"* ]]; then
  info "Buildando imagem: hardcoreeng/account:3f-local"
  cd "$ROOT_DIR/pods/account"
  DOCKER_VERSION=3f-local bash ../../common/scripts/docker_build.sh hardcoreeng/account || fail "docker build account"
fi

if [[ "$PODS" == *"collaborator"* ]]; then
  info "Buildando imagem: hardcoreeng/collaborator:3f-local"
  cd "$ROOT_DIR/pods/collaborator"
  DOCKER_VERSION=3f-local bash ../../common/scripts/docker_build.sh hardcoreeng/collaborator || fail "docker build collaborator"
fi

if [[ "$PODS" == *"workspace"* ]]; then
  info "Buildando imagem: hardcoreeng/workspace:3f-local"
  cd "$ROOT_DIR/pods/workspace"
  DOCKER_VERSION=3f-local bash ../../common/scripts/docker_build.sh hardcoreeng/workspace || fail "docker build workspace"
fi

if [[ "$PODS" == *"preview"* ]]; then
  info "Buildando imagem: hardcoreeng/preview:3f-local"
  cd "$ROOT_DIR/pods/preview"
  DOCKER_VERSION=3f-local bash ../../common/scripts/docker_build.sh hardcoreeng/preview || fail "docker build preview"
fi

if [[ "$PODS" == *"github"* ]]; then
  info "Buildando imagem: hardcoreeng/github:3f-local"
  cd "$ROOT_DIR/services/github/pod-github"
  DOCKER_VERSION=3f-local bash ../../../common/scripts/docker_build.sh hardcoreeng/github || fail "docker build github"
fi

if [[ "$PODS" == *"mail"* ]]; then
  info "Buildando imagem: hardcoreeng/mail:3f-local"
  cd "$ROOT_DIR/services/mail/pod-mail"
  DOCKER_VERSION=3f-local bash ../../../common/scripts/docker_build.sh hardcoreeng/mail || fail "docker build mail"
fi

if [[ "$PODS" == *"calendar"* ]]; then
  info "Buildando imagem: hardcoreeng/calendar:3f-local"
  cd "$ROOT_DIR/services/calendar/pod-calendar"
  DOCKER_VERSION=3f-local bash ../../../common/scripts/docker_build.sh hardcoreeng/calendar || fail "docker build calendar"
fi

if [[ "$PODS" == *"fulltext"* ]]; then
  info "Buildando imagem: hardcoreeng/fulltext:3f-local"
  cd "$ROOT_DIR/pods/fulltext"
  DOCKER_VERSION=3f-local bash ../../common/scripts/docker_build.sh hardcoreeng/fulltext || fail "docker build fulltext"
fi

if [[ "$PODS" == *"datalake"* ]]; then
  info "Buildando imagem: hardcoreeng/datalake:3f-local"
  cd "$ROOT_DIR/services/datalake/pod-datalake"
  DOCKER_VERSION=3f-local bash ../../../common/scripts/docker_build.sh hardcoreeng/datalake || fail "docker build datalake"
fi

done_step $T

# ── Passo 5: Restart dos containers ──────────────────────────────────────────
step "5/5 — Reiniciando containers"
T=$(date +%s)

cd "$ROOT_DIR"

SERVICES=""
[[ "$PODS" == *"server"*       ]] && SERVICES="$SERVICES transactor_cockroach"
[[ "$PODS" == *"front"*        ]] && SERVICES="$SERVICES front"
[[ "$PODS" == *"account"*      ]] && SERVICES="$SERVICES account"
[[ "$PODS" == *"collaborator"* ]] && SERVICES="$SERVICES collaborator"
[[ "$PODS" == *"worker"*       ]] && SERVICES="$SERVICES time-machine"
[[ "$PODS" == *"workspace"*    ]] && SERVICES="$SERVICES workspace_cockroach"
[[ "$PODS" == *"preview"*      ]] && SERVICES="$SERVICES preview"
[[ "$PODS" == *"github"*       ]] && SERVICES="$SERVICES github"
[[ "$PODS" == *"mail"*         ]] && SERVICES="$SERVICES mail"
[[ "$PODS" == *"calendar"*     ]] && SERVICES="$SERVICES calendar"
[[ "$PODS" == *"fulltext"*     ]] && SERVICES="$SERVICES fulltext_cockroach"
[[ "$PODS" == *"datalake"*     ]] && SERVICES="$SERVICES datalake"

info "Serviços: $SERVICES"

# docker-compose v1 tem bug KeyError:'ContainerConfig' ao recriar containers
# builados com Docker moderno — precisa remover antes de subir
if [[ "$COMPOSE_CMD" == "docker-compose" ]]; then
  info "docker-compose v1 detectado: removendo containers antes de recriar..."
  $COMPOSE_CMD -f $COMPOSE_FILE rm -f $SERVICES 2>/dev/null || true
fi

$COMPOSE_CMD -f $COMPOSE_FILE up -d --no-deps $SERVICES || fail "docker compose up"

info "Status dos containers:"
$COMPOSE_CMD -f $COMPOSE_FILE ps

done_step $T

# ── Resumo final ──────────────────────────────────────────────────────────────
TOTAL=$(( $(date +%s) - TOTAL_START ))
echo -e "\n${BOLD}${GREEN}╔══════════════════════════════════════════╗"
echo -e "║  ✓ Build concluído em ${TOTAL}s"
if [[ "$VPS" == true ]]; then
  printf  "║  %-42s\n" "Acesse: https://3ftasks.3fventure.tech"
else
  printf  "║  %-42s\n" "Acesse: http://localhost:8087"
fi
echo -e "╚══════════════════════════════════════════╝${NC}\n"
