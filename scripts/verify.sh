#!/usr/bin/env bash
# VietScope - local verification, mirrors .github/workflows/ci.yml.
#
#   ./scripts/verify.sh                          full pass
#   ./scripts/verify.sh --skip-python --skip-db  facade-only quick pass
#   ./scripts/verify.sh --skip-build             skip next build
#
# Runs: lint, typecheck, boundary check, format check, production build,
# Python<->TS contract decode, DB-backed regression scripts (when reachable)
# and the Python core suite (when uv is installed).
set -uo pipefail
cd "$(dirname "$0")/.."

SKIP_PYTHON=0; SKIP_DB=0; SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-python) SKIP_PYTHON=1 ;;
    --skip-db)     SKIP_DB=1 ;;
    --skip-build)  SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

info() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
warn() { printf '  \033[33m[warn]\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

RESULTS=()
CURRENT=''

step() { # step NAME cmd...
  CURRENT="$1"; shift
  info "$CURRENT"
  if "$@"; then RESULTS+=("PASS  $CURRENT")
  else RESULTS+=("FAIL  $CURRENT"); report; exit 1; fi
}
skip() { info "$1"; warn "skipped - $2"; RESULTS+=("SKIP  $1 ($2)"); }

report() {
  echo ""
  echo "================ verify summary ================"
  printf '  %s\n' "${RESULTS[@]}"
}

dotenv() {
  local name="$1" v
  v="${!name:-}"
  if [ -z "$v" ] && [ -f .env ]; then
    v="$(grep -E "^${name}=" .env | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' | tr -d '\r')"
  fi
  printf '%s' "$v"
}
tcp_ok() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null && exec 3>&- 3<&-; }

step 'lint (eslint)'           npm run lint
step 'typecheck (tsc)'         npm run typecheck
step 'boundary check'          npm run check:boundaries
info 'format check (prettier) - advisory'
if npm run format:check >/dev/null 2>&1; then RESULTS+=("PASS  format check (prettier)")
else warn 'prettier drift exists (advisory - CI does not gate on it; normalize with npm run format)'
     RESULTS+=("ADVISORY FAIL  format check (prettier)"); fi
if [ "$SKIP_BUILD" -eq 1 ]; then skip 'production build' '--skip-build'
else
  if [ -z "$(dotenv DATABASE_URL)" ]; then
    export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/app_db'
    warn "DATABASE_URL unset - using a dummy DSN for build evaluation"
  fi
  step 'production build (next build)' npm run build
fi
step 'Python -> TypeScript contract decode' npx --no-install tsx scripts/test-core-port.ts

# ------------------------------------------------------------- DB group ---
DB_READY=0
if [ "$SKIP_DB" -eq 1 ]; then warn "--skip-db: database-backed tests skipped"
else
  DB_URL="$(dotenv DATABASE_URL)"
  HP="$(printf '%s' "$DB_URL" | sed -nE 's|postgres(ql)?://([^:@/]+(:[^@/]*)?@)?([^:/@?]+)(:([0-9]+))?/.*|\4 \6|p')"
  H="${HP% *}"; P="${HP#* }"; P="${P:-5432}"
  if [ -n "$H" ] && tcp_ok "$H" "$P"; then DB_READY=1
  elif have docker && docker ps >/dev/null 2>&1; then
    warn "Postgres not reachable at ${H:-?}:$P - trying docker compose up -d db"
    docker compose up -d db >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do tcp_ok "${H:-127.0.0.1}" "$P" && { DB_READY=1; break; }; sleep 1; done
  fi
fi

if [ "$DB_READY" -eq 0 ] && [ "$SKIP_DB" -eq 0 ]; then
  RESULTS+=("SKIP  DB-backed tests (no database reachable)")
elif [ "$DB_READY" -eq 1 ]; then
  step 'conformance (reference backend)' npm run test:conformance
  step 'smoke upstreams'                 npx --no-install tsx scripts/smoke-upstreams.ts
  step 'auth'                            npx --no-install tsx scripts/test-auth.ts
  step 'bad-search review workflow'      npm run test:bad-search-review
  step 'golden promotion'                npm run test:golden
fi

# --------------------------------------------------------- Python group ---
if [ "$SKIP_PYTHON" -eq 1 ]; then skip 'Python core suite' '--skip-python'
elif ! have uv; then skip 'Python core suite' 'uv not installed'
else
  step 'uv sync --frozen'        bash -c 'cd services/search-router && uv sync --frozen'
  step 'ruff (repo rules)'       bash -c 'cd services/search-router && uv run ruff check --select E4,E7,E9,F .'
  step 'ruff (P-NEXT surface)'   bash -c 'cd services/search-router && uv run ruff check api/retrieve.py core/unified_retrieve.py tests/test_retrieve_contract.py tests/test_retrieve_bindings.py tests/test_compose_mounts.py'
  step 'pyright (retrieval core)' bash -c 'cd services/search-router && uv run pyright -p pyright-pnextconfig.json'
  step 'pytest (not e2e, not live)' bash -c 'cd services/search-router && uv run pytest -q -m "not e2e and not live"'
fi

report
printf '\033[32mAll executed checks passed.\033[0m\n'
exit 0
