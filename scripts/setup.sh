#!/usr/bin/env bash
# VietScope - one-command setup for a fresh machine (Linux/macOS).
#
#   ./scripts/setup.sh                  embedded dev stack (Postgres + facade)
#   ./scripts/setup.sh --skip-python    skip uv sync for the Python core
#   ./scripts/setup.sh --skip-docker    do not use Docker for Postgres
#   ./scripts/setup.sh --production     full retrieval stack via compose overlay
#
# Steps: verify prerequisites (node>=22, npm; optional docker, uv), copy
# .env.example -> .env, npm ci, start dev Postgres + drizzle push + seed,
# uv sync --frozen for services/search-router.
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_DOCKER=0; SKIP_PYTHON=0; PRODUCTION=0
for arg in "$@"; do
  case "$arg" in
    --skip-docker) SKIP_DOCKER=1 ;;
    --skip-python) SKIP_PYTHON=1 ;;
    --production)  PRODUCTION=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

info() { printf '\033[36m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

dotenv() { # dotenv NAME -> value (env wins, then .env file)
  local name="$1" v
  v="${!name:-}"
  if [ -z "$v" ] && [ -f .env ]; then
    v="$(grep -E "^${name}=" .env | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' | tr -d '\r')"
  fi
  printf '%s' "$v"
}

db_host_port() { # db_host_port URL -> "host port"
  printf '%s' "$1" | sed -nE 's|postgres(ql)?://([^:@/]+(:[^@/]*)?@)?([^:/@?]+)(:([0-9]+))?/.*|\4 \6|p'
}

tcp_ok() { (exec 3<>"/dev/tcp/$1/${2:-5432}") 2>/dev/null && exec 3>&- 3<&-; }

info "Checking prerequisites"
have node || die "Node.js >= 22 required. Install: https://nodejs.org"
NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js >= 22 required, found $(node --version)"
ok "node $(node --version)"
have npm || die "npm not found (comes with Node.js)"
ok "npm $(npm --version)"
have git || warn "git not found - only needed to clone/update"

HAS_DOCKER=0
if [ "$SKIP_DOCKER" -eq 0 ] && have docker && docker ps >/dev/null 2>&1; then
  HAS_DOCKER=1; ok "$(docker --version)"
elif [ "$SKIP_DOCKER" -eq 0 ]; then
  warn "docker unavailable - skipping container steps"
fi

HAS_UV=0
if have uv; then HAS_UV=1; ok "uv $(uv --version | awk '{print $2}')"
else warn "uv not found - Python core sync will be skipped (optional for embedded mode). Install: https://docs.astral.sh/uv/"; fi

info "Environment file"
if [ -f .env ]; then ok ".env already exists - left untouched"
else cp .env.example .env; ok "created .env from .env.example - review it before production use"; fi

info "Installing Node.js dependencies (npm ci)"
npm ci
ok "node_modules installed from package-lock.json"

if [ "$PRODUCTION" -eq 1 ]; then
  [ "$HAS_DOCKER" -eq 1 ] || die "--production requires a running Docker daemon"
  if [ "$(uname -s)" = "Linux" ]; then
    MMC="$(sysctl -n vm.max_map_count 2>/dev/null || echo 0)"
    if [ "$MMC" -lt 262144 ]; then
      warn "vm.max_map_count=$MMC < 262144 (OpenSearch need). Run: sudo sysctl -w vm.max_map_count=262144"
    fi
  fi
  info "Starting the full production retrieval stack (compose overlay)"
  docker compose -f docker-compose.yml -f docker-compose.production.yml \
    --profile production up -d --build --wait
  ok "stack is up: facade http://localhost:3000 | core http://127.0.0.1:8888"
else
  info "Facade database (embedded dev/reference mode)"
  DB_READY=0
  if [ "$HAS_DOCKER" -eq 1 ]; then
    docker compose up -d db
    for _ in $(seq 1 60); do
      if docker compose exec -T db pg_isready -U postgres -d app_db >/dev/null 2>&1; then DB_READY=1; break; fi
      sleep 1
    done
    [ "$DB_READY" -eq 1 ] || die "Postgres container did not become ready in 60s"
    ok "postgres:16 container healthy (localhost:5432)"
  else
    DB_URL="$(dotenv DATABASE_URL)"
    HP="$(db_host_port "$DB_URL")"
    if [ -n "$HP" ] && tcp_ok ${HP% *} ${HP#* }; then
      DB_READY=1; ok "reusing existing Postgres at $HP"
    else
      warn "no Docker and DATABASE_URL (${DB_URL:-unset}) is not reachable - schema push/seed skipped."
      warn "install Postgres or Docker, then run: npx drizzle-kit push && npx tsx src/db/seed.ts"
    fi
  fi
  if [ "$DB_READY" -eq 1 ]; then
    npx drizzle-kit push && ok "facade schema pushed"
    npx tsx src/db/seed.ts && ok "embedded reference dataset seeded"
  fi
fi

if [ "$SKIP_PYTHON" -eq 0 ]; then
  if [ "$HAS_UV" -eq 1 ]; then
    info "Syncing Python search-router core (uv sync --frozen)"
    (cd services/search-router && uv sync --frozen)
    ok "services/search-router/.venv ready"
  else
    warn "skipped Python core sync (uv missing). The facade runs without it; the production brain needs it outside Docker."
  fi
fi

echo ""
echo "Setup complete."
if [ "$PRODUCTION" -eq 1 ]; then
  echo "  Stack   : docker compose -f docker-compose.yml -f docker-compose.production.yml --profile production ps"
  echo "  Facade  : http://localhost:3000/api/health"
  echo "  Core    : http://127.0.0.1:8888/v1/health"
  echo "  Verify  : SEARCH_ROUTER_URL=http://127.0.0.1:8888 npm run test:conformance:production"
else
  echo "  Start   : ./scripts/start.sh          (or: ./scripts/start.sh --dev)"
  echo "  Verify  : ./scripts/verify.sh"
  echo "  App     : http://localhost:3000"
fi
