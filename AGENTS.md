# AGENTS.md — VietScope facade

## Stack
- Next.js 16 + React 19 + TypeScript, Tailwind 4, drizzle-orm + Postgres
- Python retrieval brain vendored under `services/search-router/`
- npm (`package-lock.json`) — do not switch package managers

## Commands
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
- Telemetry retention (run daily in prod): `npm run telemetry:retention`
- DB: `npx drizzle-kit push`; seed: `npx tsx src/db/seed.ts`
- Telemetry retention: `npm run telemetry:retention` (schedule daily ~03:30; advisory-locked, single-run; alert nếu exit≠0). Regression test: `npm run test:retention`

## Conventions
- Facade pattern: this repo is the public API surface; retrieval contract v1 in `docs/retrieve.contract.md`
- CI: `.github/workflows/ci.yml` (lint, typecheck, build, tests, e2e smoke)
- CD: `.github/workflows/cd.yml` (Docker → GHCR, SSH deploy needs `DEPLOY_*` secrets)
- Secrets only via env vars; never commit `.env` (gitignored)
