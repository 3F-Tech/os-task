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
#   ./3f-build.sh --pod server       # reconstrói só o transactor
#   ./3f-build.sh --pod front        # reconstrói só o front
#   ./3f-build.sh --pod account      # reconstrói só o account
#   ./3f-build.sh --pod "front account"  # dois pods
#   ./3f-build.sh --clean --no-cache --skip-webpack --pod server  # combinado
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
PODS="server front account"

# ── Parse de argumentos ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-cache)      NO_CACHE=true ;;
    --skip-rush)     SKIP_RUSH=true ;;
    --skip-webpack)  SKIP_WEBPACK=true ;;
    --clean)         CLEAN=true ;;
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
echo -e "  ${GRAY}Pods: $PODS${NC}"
echo ""

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
  ./node_modules/.bin/cross-env NODE_ENV=production ./node_modules/.bin/webpack --progress --stats-error-details || fail "webpack"
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

done_step $T

# ── Passo 4: Docker build ─────────────────────────────────────────────────────
step "4/5 — Docker build das imagens"
T=$(date +%s)

[[ "$NO_CACHE" == true ]] && export DOCKER_EXTRA="--no-cache" || export DOCKER_EXTRA=""

if [[ "$PODS" == *"server"* ]]; then
  info "Buildando imagem: hardcoreeng/transactor"
  cd "$ROOT_DIR/pods/server"
  bash ../../common/scripts/docker_build.sh hardcoreeng/transactor || fail "docker build transactor"
fi

if [[ "$PODS" == *"front"* ]]; then
  info "Buildando imagem: hardcoreeng/front"
  cd "$ROOT_DIR/pods/front"
  bash ../../common/scripts/docker_build.sh hardcoreeng/front || fail "docker build front"
fi

if [[ "$PODS" == *"account"* ]]; then
  info "Buildando imagem: hardcoreeng/account"
  cd "$ROOT_DIR/pods/account"
  bash ../../common/scripts/docker_build.sh hardcoreeng/account || fail "docker build account"
fi

done_step $T

# ── Passo 5: Restart dos containers ──────────────────────────────────────────
step "5/5 — Reiniciando containers"
T=$(date +%s)

cd "$ROOT_DIR"

SERVICES=""
[[ "$PODS" == *"server"* ]] && SERVICES="$SERVICES transactor_cockroach"
[[ "$PODS" == *"front"*   ]] && SERVICES="$SERVICES front"
[[ "$PODS" == *"account"* ]] && SERVICES="$SERVICES account"

info "Serviços: $SERVICES"
docker compose -f dev/docker-compose.yaml up -d --no-deps $SERVICES || fail "docker compose up"

info "Status dos containers:"
docker compose -f dev/docker-compose.yaml ps --format "table {{.Name}}\t{{.Status}}" \
  | grep -E "Name|front|account|transactor"

done_step $T

# ── Resumo final ──────────────────────────────────────────────────────────────
TOTAL=$(( $(date +%s) - TOTAL_START ))
echo -e "\n${BOLD}${GREEN}╔══════════════════════════════════════════╗"
echo -e "║  ✓ Build concluído em ${TOTAL}s"
printf  "║  %-42s\n" "Acesse: http://localhost:8087"
echo -e "╚══════════════════════════════════════════╝${NC}\n"
