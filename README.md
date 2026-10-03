# VietScope · `vietscope-1` — Production Candidate (Next.js facade + search-router core)

Vietnam-first Search & Answer Engine — một model public (`vietscope-1`), một retrieval brain.
Xem `VISION.md` (North Star + kiến trúc đóng băng), `docs/retrieve.contract.md`, `docs/PORTING-TO-SEARCH-ROUTER.md`, `docs/P-NEXT-PRODUCTION-RETRIEVAL-GATE.md`.

```
Facade (repo này)  ──  Retrieval Contract v1  ──►  Retrieval brain: search-router (production) | embedded (tham chiếu)
```

## Yêu cầu môi trường

| Thành phần | Phiên bản đã kiểm chứng | Ghi chú |
|---|---|---|
| Node.js | `22.x` (CI dùng `actions/setup-node@v4` + `node:22-alpine`) | Local bạn đang dùng Node 24 vẫn chạy được, nhưng CI chuẩn là 22 |
| npm | `10+/11` (đi kèm Node 22) | Cài đúng từ `package-lock.json` bằng `npm ci` |
| Python | `3.12.x` (xem `services/search-router/pyproject.toml`: `>=3.12,<3.14`) | Core search-router bắt buộc 3.12 cho CI/Docker/pyright |
| uv | `0.12.18` (pin trong `pyproject.toml` + Docker dùng `ghcr.io/astral-sh/uv:0.12.18`) | Quản lý venv Python, thay pip |
| Docker + Compose | Docker `28+/29`, Compose v2 | Embedded dev hoặc production retrieval profile |
| Postgres | `16` (`postgres:16` + `postgis/postgis:16-3.5-alpine`) | Facade DB và brain PostGIS DB tách riêng |

> "Model" ở đây KHÔNG phải file `.gguf`/weights trong repo.
> `vietscope-1` = Compound Search Model: Retrieval deterministic (Postgres + code trong repo)
> + Inference/LLM trỏ ngoài qua `LLM_BASE_URL` (OpenAI-compatible).
> Muốn chạy local GPU thì dựng `llama-server`/`vLLM` riêng rồi trỏ `LLM_BASE_URL` vào — xem `.env.example` Phương án A/B/C.

## Tải về + chạy lại từ đầu (máy mới, 5 phút)

### Cách 0 — script một lệnh (khuyến nghị cho máy mới)

```powershell
# Windows (PowerShell)
git clone https://github.com/xegheplimo-web/A-Z.git
cd A-Z
.\scripts\setup.ps1     # kiểm tra prereqs → .env → npm ci → Postgres (Docker) → schema+seed → uv sync
.\scripts\verify.ps1    # lint · typecheck · boundaries · build · contract + DB + Python suites
.\scripts\start.ps1     # bảo đảm db up → build nếu thiếu → next start :3000
```

```bash
# Linux / macOS
git clone https://github.com/xegheplimo-web/A-Z.git
cd A-Z
./scripts/setup.sh      # flags: --skip-python --skip-docker --production
./scripts/verify.sh     # flags: --skip-python --skip-db --skip-build
./scripts/start.sh      # flags: --dev --port 3001 --production --skip-docker
```

`setup` làm đúng các bước thủ công ở Cách 1/2 bên dưới: tạo `.env` từ `.env.example` (không ghi đè), `npm ci`, dựng Postgres `postgres:16` bằng Docker (hoặc dùng `DATABASE_URL` sẵn có), `drizzle-kit push` + seed, và `uv sync --frozen` cho Python core khi có `uv`. `setup --production` / `start --production` dựng toàn bộ stack retrieval như Cách 1b.

### Cách 1 — Docker embedded (dev/reference)

```bash
git clone https://github.com/xegheplimo-web/A-Z.git
cd A-Z
cp .env.example .env
docker compose up -d --build  # postgres:16 + Next.js, RETRIEVAL_BACKEND=embedded
docker compose exec app npx drizzle-kit push
docker compose exec app npx tsx src/db/seed.ts # admin graph + places + documents minh họa
curl http://localhost:3000/api/health           # {"ok":true}
curl http://localhost:3000/v1/models            # vietscope-1
```

### Cách 1b — Production Retrieval Gate (khuyến nghị để kiểm production brain)

```bash
# Dựng facade + search-router + PostGIS + Redis + OpenSearch + Qdrant + SearXNG.
# Overlay ép RETRIEVAL_BACKEND=search-router và RETRIEVAL_FALLBACK="".
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile production up -d --build --wait

SEARCH_ROUTER_URL=http://127.0.0.1:8888 npm run test:conformance:production
VIETSCOPE_URL=http://127.0.0.1:3000 npm run test:e2e:production
VIETSCOPE_URL=http://127.0.0.1:3000 npm run benchmark:production -- --smoke
# Sau khi import dữ liệu live có nhãn:
VIETSCOPE_URL=http://127.0.0.1:3000 npm run benchmark:production -- --gate
```

`app-migrate` tự áp schema facade trước khi app lên. `search-router` tự áp migration vào DB PostGIS riêng; không dùng chung các bảng embedded. Port core chỉ bind `127.0.0.1:8888`.

### Cách 2 — Chạy tay (dev)

```bash
git clone https://github.com/xegheplimo-web/A-Z.git
cd A-Z
cp .env.example .env
# Postgres local (Docker):
docker run -d --name az-pg -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_db \
  -p 5432:5432 postgres:16-alpine

npm ci
npx drizzle-kit push
npx tsx src/db/seed.ts
npm run build && npm start
# dev: npm run dev
```

Seed là bắt buộc cho engine `embedded` (admin graph 34 tỉnh/sáp nhập + places + documents demo).

### Bật LLM ("cài model")

Mặc định không cần key — chạy `synthesizer extractive`.

```bash
# Phương án A — API ngoài OpenAI-compatible (khuyến nghị)
LLM_BASE_URL=https://<provider>/v1
LLM_API_KEY=<key>
LLM_MODEL=qwen3.8-flash-next
# Override theo vai trò (trống = dùng LLM_MODEL):
LLM_PLANNER_MODEL= LLM_SYNTH_MODEL= LLM_VERIFY_MODEL= LLM_EXTRACT_MODEL=

# Phương án B — local RTX 3090 24GB, model quant 20–35B
# Chạy llama-server riêng: LLM_BASE_URL=http://127.0.0.1:8080/v1  LLM_MODEL=local
# Phương án C — máy lớn: vLLM/llama.cpp + Flash-Next, mtp-*.gguf chỉ là draft head tăng tốc
```

### Bật search-router core (Python, production brain)

```bash
cd services/search-router
cp .env.example .env           # sửa SEARXNG_URL, LLM_*, REDIS_URL, POSTGRES_URL...
uv sync --frozen               # tạo .venv đúng lock (uv.lock), Python 3.12
uv run uvicorn main:app --host 0.0.0.0 --port 8888
# hoặc Docker: docker build -t search-router . && docker run -p 8888:8888 --env-file .env search-router
# Kiểm thử Python: uv run pytest tests/test_retrieve_contract.py tests/test_retrieve_bindings.py tests/test_local_discovery.py
```

Trỏ facade sang brain này:

```bash
# .env ở repo root
RETRIEVAL_BACKEND=search-router
SEARCH_ROUTER_URL=http://127.0.0.1:8888
```

## Kiểm thử

```bash
npm run check:boundaries
npm run test:conformance                  # reference/adapter error semantics
npm run test:conformance:production       # Python core thật → TypeScript adapter
npm run test:e2e:production               # retrieve/search/places/responses/stream/auth
npm run benchmark:production -- --gate    # 5 local query live; không dùng fixture
npx tsx scripts/smoke-upstreams.ts
npx tsx scripts/test-auth.ts

cd services/search-router
uv sync --frozen
uv run ruff check --select E4,E7,E9,F .
uv run ruff check api/retrieve.py core/unified_retrieve.py tests/test_retrieve_contract.py tests/test_retrieve_bindings.py tests/test_compose_mounts.py
uv run pyright -p pyright-pnextconfig.json
uv run pytest -q -m "not e2e and not live"
```

## Ví dụ

```bash
curl -X POST localhost:3000/v1/responses -H 'content-type: application/json' \
  -d '{"model":"vietscope-1","input":"quán giò chả ngon ở Yên Dũng"}'
```


## Execution / pilot

- Mã core được port: `services/search-router`; patch để ghép vào checkout VietScope: `services/search-router-port.patch`.
- Năm query LOCAL-1: `npx tsx scripts/local1-pilot.ts --gate`; kết quả trước/sau: `reports/`.
- Pilot workspace: `/data/pilot` (xem tổng hợp), `VIETSCOPE_ADMIN_KEY` cho thao tác quản trị (khóa không lưu phía client).
- Pilot regression: `npx tsx scripts/test-pilot.ts`; import hợp lệ: `npx tsx scripts/pilot-import.ts export.jsonl [job-id]`.
- FastAPI port tests: trong toolchain Python của core, chạy `pytest tests/test_retrieve_contract.py tests/test_retrieve_bindings.py tests/test_local_discovery.py`.
- Python → TypeScript contract: `npx tsx scripts/test-core-port.ts` sau Python tests.

Không auto-seed/reset DB khi truy cập UI. Cần áp schema mới bằng `npx drizzle-kit push`; dữ liệu pilot là nguồn người vận hành cung cấp, không crawler tự động. Chi tiết giới hạn và provenance trong `docs/PILOT-YEN-DUNG.md`.

## Ports

| Port | Service | Exposed | Ghi chú |
|---|---|---|---|
| `3000` | facade Next.js | host | UI + `/v1/*` API + `/api/health` |
| `5432` | facade Postgres (`postgres:16-alpine`) | host (dev compose) | `DATABASE_URL`, schema drizzle `src/db/schema.ts` |
| `8888` | search-router core | `127.0.0.1` only (production profile) | Retrieval Contract v1 `/v1/retrieve`, health `/v1/health` |
| `5432` (internal) | search-db PostGIS | compose network only | brain DB riêng, migrations `services/search-router/db/migrations/` |
| `6379` | Redis | internal | cache/queue của brain + SearXNG (db 1) |
| `9200` | OpenSearch | internal | BM25 places/web; cần `vm.max_map_count>=262144` trên Linux host |
| `6333/6334` | Qdrant | internal | dense lane (opt-in `QDRANT_DENSE_ENABLED`) |
| `8080` | SearXNG | internal | live-web provider, settings `deploy/searxng/settings.yml` |

Ngoài ra `LLM_BASE_URL`/`EMBEDDING_BASE_URL`/`FIRECRAWL_URL` trỏ ra endpoint ngoài tuỳ cấu hình.

## Production deployment

- CI (`.github/workflows/ci.yml`): lint · typecheck · build · compose-contract · python-core (ruff/pyright/pytest + fixture decode) · hygiene (knip + npm audit + pip-audit) · test (DB) · e2e embedded · production-retrieval-e2e (full stack).
- CD (`.github/workflows/cd.yml`) trên `main`: build image → `ghcr.io/<repo>:{latest,sha}` → SSH deploy (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` secrets) chạy `docker compose up -d app` trên server `/opt/vietscope`.
- Tự deploy: build image từ `Dockerfile` gốc (facade) + `services/search-router/Dockerfile` (core), chạy bằng `docker-compose.yml` + `docker-compose.production.yml --profile production` như Cách 1b; bắt buộc `RETRIEVAL_BACKEND=search-router`, `RETRIEVAL_FALLBACK` rỗng, secrets qua env.
- Telemetry retention chạy định kỳ ~03:30 hằng ngày: `npm run telemetry:retention` (single-run, advisory lock).

## Troubleshooting

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `npm ci` lỗi lockfile | `package.json`/`package-lock.json` lệch | không sửa tay lock — chạy `npm install` để regenerate rồi review diff |
| `drizzle-kit push`/seed báo connect | Postgres chưa lên hoặc `DATABASE_URL` sai | `docker compose up -d db` hoặc sửa `DATABASE_URL` trong `.env` |
| `/v1/*` trả 503 khi `RETRIEVAL_BACKEND=search-router` | core chưa chạy/`SEARCH_ROUTER_URL` sai | đây là hành vi fail-closed cố ý; kiểm tra `http://127.0.0.1:8888/v1/health` |
| `/ops/*` từ chối từ xa | `VIETSCOPE_ADMIN_KEY` rỗng → chỉ mở mạng nội bộ | đặt `VIETSCOPE_ADMIN_KEY` (openssl rand -hex 32), mở `/ops/auth` |
| Rate-limit gom chung bucket `anon` | `TRUST_PROXY_HEADERS` tắt | chỉ bật khi reverse proxy overwrite `X-Forwarded-For` |
| OpenSearch không healthy trong production stack | `vm.max_map_count` thấp (Linux) | `sudo sysctl -w vm.max_map_count=262144` |
| `uv sync` báo sai Python | core yêu cầu `>=3.12,<3.14` | `uv python install 3.12` (uv tự quản toolchain) |
| Port 3000/5432 đã dùng | service khác chiếm port | `start.ps1 -Port 3001` / đổi port trong compose & `DATABASE_URL` |
| Build `next build` báo thiếu `DATABASE_URL` | build cần biến tồn tại (không cần DB thật) | `.env` từ setup đã có giá trị mặc định; CI dùng DSN dummy |
