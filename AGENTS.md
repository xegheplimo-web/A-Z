# AGENTS.md — VietScope facade

## Stack
- Next.js 16 + React 19 + TypeScript, Tailwind 4, drizzle-orm + Postgres
- Python retrieval brain vendored under `services/search-router/`
- npm (`package-lock.json`) — do not switch package managers

## Commands
- Bootstrap (fresh machine): `scripts/setup.ps1` / `scripts/setup.sh` — prereqs → `.env` → `npm ci` → Postgres (Docker) → `drizzle-kit push` + seed → `uv sync --frozen`
- Verify (CI mirror): `scripts/verify.ps1` / `scripts/verify.sh` — lint · typecheck · boundaries · build · contract + DB + Python suites (`format:check` advisory: repo-wide prettier drift is not normalized yet)
- Start: `scripts/start.ps1` / `scripts/start.sh` (`-Dev`/`--dev`, `-Production`/`--production`, `-Port`/`--port`)
- Install: `npm ci`
- Dev: `npm run dev`
- Lint: `npm run lint` (eslint flat config)
- Typecheck: `npm run typecheck`
- Build: `npm run build` (needs `DATABASE_URL` — see `.env.example`)
- Test scripts (conformance, run via tsx):
  - `node scripts/check-boundaries.mjs`
  - `npx tsx scripts/conformance.ts`
  - `npx tsx scripts/smoke-upstreams.ts`
  - `npx tsx scripts/test-auth.ts`
  - `npx tsx scripts/test-pilot.ts`
  - `npx tsx scripts/test-telemetry-retention.ts` (telemetry retention regression; needs DATABASE_URL)
  - `npm run test:bad-search-review` (P-LEARNING-5 review-state + redaction regression; needs DATABASE_URL)
- Telemetry retention (run daily in prod): `npm run telemetry:retention`
- DB: `npx drizzle-kit push`; seed: `npx tsx src/db/seed.ts`
- Format: `npm run format` / check: `npm run format:check`
- Dead code & dep hygiene: `npm run knip` (config: `knip.json`; exports/types are advisory — public contract surface)
- Audits (CI `hygiene` job): `npm audit --omit=dev --audit-level=high` (blocking, prod deps); dev-deps + `pip-audit` on `services/search-router/requirements.txt` are advisory
- Telemetry retention: `npm run telemetry:retention` (schedule daily ~03:30; advisory-locked, single-run; alert nếu exit≠0). Regression test: `npm run test:retention`

## Conventions
- Facade pattern: this repo is the public API surface; retrieval contract v1 in `docs/retrieve.contract.md`
- CI: `.github/workflows/ci.yml` (lint, typecheck, build, hygiene, tests, e2e smoke)
- CD: `.github/workflows/cd.yml` (Docker → GHCR, SSH deploy needs `DEPLOY_*` secrets)
- Secrets only via env vars; never commit `.env` (gitignored)
