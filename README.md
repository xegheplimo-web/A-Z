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
