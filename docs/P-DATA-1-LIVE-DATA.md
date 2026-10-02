# P-DATA-1 — Live Vietnam Places & Quality Gate

P-NEXT proved the production retrieval boundary (`/v1/retrieve` → real
`search-router` core, embedded never loaded). P-DATA-1 puts real data
through that boundary and turns on the quality gate — on a pilot area,
not the whole country.

Pilot scope: **Yên Dũng / Neo / Tân An (Bắc Giang)** plus the surrounding
area, then the five LOCAL-1 queries from `scripts/production-benchmark.ts`
under `--gate` (precision@10 ≥ 0.80, generic noise < 10%, outside-area
< 5%, live results present).

## What already exists (do not rebuild)

| Stage | Component |
|---|---|
| Raw ingest (P15.1) | `ingestion/` — stream → validate → DLQ → anchor → COPY → merge → observe. Tables: `ingestion_runs`, `place_source_records`, `place_source_observations`, `place_source_errors`. |
| Adapters | `osm_pbf` (stdlib + optional pyosmium, `bbox` crop), `gmaps` (gosom NDJSON), `web_corpus`, `ndjson` (`operator_pilot`) |
| Admin graph (P14) | `db/seed_admin.py` + bundled `db/seeds/vn_admin_units.json`; runs as the `search-seed` one-shot in the production profile |
| Resolution (P16) | `scripts/resolve.py` → `canonical_places` + field provenance; `source_category_mappings` / `unknown_source_categories` drive category normalization |
| Serving (P17) | `scripts/index_places.py` → OpenSearch `places` index; `PlaceService` falls back to PostGIS when the index is empty |
| Quality gate | `npm run benchmark:production -- --gate` |

## Ops flow

```bash
# 1. Bring the stack up — `search-seed` applies migrations and loads the
#    admin graph before search-router starts.
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile production up -d --build --wait

# 2. Download the OSM extract on the host (lands in ./data, gitignored).
curl -L -o data/vietnam-latest.osm.pbf \
  https://download.geofabrik.de/asia/vietnam-latest.osm.pbf

# 3. Stage raw records — bbox crops to the pilot area (Bắc Giang-ish box;
#    adjust to the actual AOI). Records without coordinates are dropped
#    when bbox is set.
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile data-ops run --rm data-ops -m scripts.ingest \
  --provider osm --file /data/vietnam-latest.osm.pbf \
  --param bbox=105.85,21.0,106.95,21.65

#    Optional: reviewed business rows (one JSON object per line — see
#    ingestion/adapters/ndjson.py for the shape).
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile data-ops run --rm data-ops -m scripts.ingest \
  --provider operator_pilot --file /data/pilot-places.ndjson

# 4. Resolve staged records → canonical places (provenance kept per field).
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile data-ops run --rm data-ops -m scripts.resolve

# 5. Sync the OpenSearch `places` index (first run: full rebuild).
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile data-ops run --rm data-ops -m scripts.index_places --mode full

# 6. Real quality gate.
VIETSCOPE_URL=http://127.0.0.1:3000 \
SEARCH_ROUTER_URL=http://127.0.0.1:8888 \
BENCH_RUNS=10 npm run benchmark:production -- --gate
```

The `data-ops` profile is a manual shell over the same image — it starts
`search-db`/`opensearch` transitively and exits after each command.
Run it on the host instead when iterating: `uv run python -m scripts.ingest ...`
inside `services/search-router` with `HUB_DATABASE_URL` set.

## Iterating on categories

After each ingest, unresolved provider labels accumulate in
`unknown_source_categories`. Add rows to `source_category_mappings`
(provider `*` covers all sources) and re-run `scripts.resolve` — no code
change needed. Hard-coded *query-time* vocabulary (`_SPECIALTY_LEXICON`,
`_CATEGORY_EXPANSIONS`, `unified_retrieve` maps) is scheduled for the
taxonomy-as-data step, not this stage.

## Honest expectations

OSM coverage in rural Vietnam is thin: specialty queries ("giò chả")
will likely stay below the 0.80 precision gate until operator-curated
rows and `web_corpus` observations supplement OSM. A failing `--gate`
here is the measurement working — it is not a retrieval bug.

## Still open (later stages)

- VN100 independently-labeled benchmark (graded relevance 0–3, P@10 /
  R@20 / MRR / nDCG@10, cold vs warm latency).
- `coverage.gap` persistence → acquisition-job suggestion loop.
- Dense/RRF/reranker A/B once the VN100 baseline exists.
- CI data job (nightly/manual) — the deterministic production gate stays
  on the empty-stack contract.
