#!/bin/sh
set -eu

# A configured production database is part of readiness, not a background
# best-effort task. The migration runner is idempotent and advisory-lock safe.
if [ -n "${HUB_DATABASE_URL:-}" ]; then
  python -m db.migrate --dsn "$HUB_DATABASE_URL"
fi

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8888}"
