#!/usr/bin/env bash
# VietScope - start the facade (Linux/macOS).
#
#   ./scripts/start.sh                 build if needed, serve on :3000
#   ./scripts/start.sh --dev           next dev (hot reload)
#   ./scripts/start.sh --port 3001     custom port
#   ./scripts/start.sh --production    full retrieval stack via compose overlay
#   ./scripts/start.sh --skip-docker   do not touch the db container
set -euo pipefail
cd "$(dirname "$0")/.."

DEV=0; PRODUCTION=0; SKIP_DOCKER=0; PORT=3000
while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DEV=1 ;;
    --production) PRODUCTION=1 ;;
    --skip-docker) SKIP_DOCKER=1 ;;
    --port) PORT="$2"; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

info() { printf '\033[36m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$PRODUCTION" -eq 1 ]; then
  have docker || die "--production requires Docker"
  docker ps >/dev/null 2>&1 || die "Docker daemon is not running"
  info "Starting production retrieval stack"
  docker compose -f docker-compose.yml -f docker-compose.production.yml \
    --profile production up -d --build --wait
  ok "facade http://localhost:$PORT  |  core http://127.0.0.1:8888"
  exit 0
fi

if [ "$SKIP_DOCKER" -eq 0 ] && have docker && docker ps >/dev/null 2>&1; then
  info "Ensuring dev Postgres is up"
  docker compose up -d db
  for _ in $(seq 1 30); do
    if docker compose exec -T db pg_isready -U postgres -d app_db >/dev/null 2>&1; then break; fi
    sleep 1
  done
  ok "postgres up"
elif [ "$SKIP_DOCKER" -eq 0 ]; then
  warn "Docker not available - assuming DATABASE_URL points at a reachable Postgres"
fi

if [ "$DEV" -eq 1 ]; then
  info "next dev on http://localhost:$PORT"
  exec npm run dev -- -p "$PORT"
fi

if [ ! -f .next/BUILD_ID ]; then
  info "No production build found - running npm run build"
  npm run build
fi

info "next start on http://localhost:$PORT"
exec npm start -- -p "$PORT"
