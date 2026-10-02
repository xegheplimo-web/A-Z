# P-NEXT — Production Retrieval Gate

## Goal

Prove that `vietscope-1` runs end to end through the real Python `search-router` retrieval brain. The embedded TypeScript engine remains a dev/reference backend and is never loaded in production mode.

## Stack

Start the production profile with:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile production up -d --build --wait
```

The profile starts:

- Next.js product facade (`RETRIEVAL_BACKEND=search-router`, no fallback);
- `search-router` (`POST /v1/retrieve`);
- separate facade Postgres and search-router PostGIS databases;
- Redis, OpenSearch, Qdrant and SearXNG;
- a one-shot facade schema migration service.

The Python API image does not install Torch/CUDA. In-process model dependencies are isolated in the optional `ml` extra and specialist embedding/reranker images. Production retrieval keeps deterministic fallbacks when those optional services are off.

## Automated gates

### Python core

```bash
cd services/search-router
uv sync --frozen
uv run ruff check --select E4,E7,E9,F .
uv run ruff check api/retrieve.py core/unified_retrieve.py \
  tests/test_retrieve_contract.py tests/test_retrieve_bindings.py \
  tests/test_compose_mounts.py
uv run pyright -p pyright-pnextconfig.json
uv run pytest -q -m "not e2e and not live"
```

The full non-live regression suite and the frozen API/schema/index contract baselines run in CI. The stricter Ruff/Pyright gate is currently scoped to the P-NEXT retrieval boundary; unrelated upstream lint/type debt is not hidden as a P-NEXT regression.

### Cross-language production conformance

```bash
SEARCH_ROUTER_URL=http://127.0.0.1:8888 npm run test:conformance:production
```

Checks the five LOCAL-1 queries against the live Python endpoint, decodes every response with the TypeScript Contract v1 validator, verifies 422 error semantics, calls through the actual adapter, and asserts that embedded was not loaded.

### Product facade E2E

```bash
VIETSCOPE_URL=http://127.0.0.1:3000 \
SEARCH_ROUTER_URL=http://127.0.0.1:8888 \
npm run test:e2e:production
```

Covers:

- direct core `/v1/retrieve`;
- facade `/v1/retrieve`, `/v1/search`, `/v1/places/search`;
- `/v1/responses` and SSE streaming;
- facade Bearer authentication;
- bounded provider degradation after SearXNG is stopped.

### Live benchmark

```bash
# Contract/backend/5-second core latency smoke, safe on an empty stack:
npm run benchmark:production -- --smoke

# Full quality gate after loading reviewed live data:
npm run benchmark:production -- --gate
```

Full thresholds:

- specialty precision@10 ≥ 0.80;
- generic noise < 10%;
- outside-area < 5%;
- local widened core P95 ≤ 5 seconds;
- contract errors = 0;
- live place results must be present.

The report sets `live=true` and `fixture_only=false`. An empty database cannot pass the quality gate; it is not converted into a fixture or a false quality claim.

## Deliberately out of scope

- nationwide crawler/data import;
- UI redesign;
- new model or framework;
- commerce/product graph;
- LLM optimization;
- public CD, deployment secrets and post-deploy rollback.

P-NEXT establishes the executable production retrieval boundary. Data coverage and public deployment remain separate gates.
