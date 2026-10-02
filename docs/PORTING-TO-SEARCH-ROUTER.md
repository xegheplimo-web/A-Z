# `/v1/retrieve` — bản port vào core, không engine mới

## Mã nguồn

Snapshot đầy đủ tại `services/search-router`, từ https://github.com/xegheplimo-web/VietScope commit `6257130efa846d2ea0223e6e6f9e8a060765808c`.

Các thay đổi của bản port:

- `api/retrieve.py`: validation Pydantic, dependency/auth hiện có, `POST /v1/retrieve` contract version `1`.
- `core/unified_retrieve.py`: orchestration gọi **dịch vụ sẵn có**, không truy cập DB/index riêng, không gọi answer/LLM.
- `main.py`: mount router.
- `security/apikeys.py`: `retrieve → search:read`.
- `api/v1.py`: capability `retrieve` và `retrieve_contract_v1`.
- `tests/test_retrieve_contract.py`, `tests/test_retrieve_bindings.py`: ASGI + binding tests; I/O provider thay bằng fixture.

## Các thành phần thực sự được gọi

| Bước | Core hiện có |
|---|---|
| Hiểu query/entity | `SearchOrchestrator.query_understanding.analyze`, `core.local_discovery.extract_specialty`, `core.entity_resolver.fold` |
| Temporal geography | `_get_admin_resolver().resolve` + `services.admin.admin_anchor` |
| Canonical places | `PlacesService.search` (cache → OS → PostGIS), bounded `get_place` để đọc specialty provenance |
| Live providers | `SearchOrchestrator._search_query` → SourceRouter + registry + FederatedExecutor |
| Own index | `_hybrid_retrieve` → OpenSearch / Qdrant / RRF |
| Fusion / rank / reader | bounded URL identity fusion → `_rank` top-30 → `_fetch_top` tối đa 7 nguồn |

Strict local: đúng scope + evidence chuyên ngành + `verification_level` ≥ `corroborated` (≥2 *independent evidence keys* — hai provider trích cùng một domain chỉ tính một nguồn — review đủ evidence, hoặc nguồn first-party) + confidence ≥0.7 mới vào exact. `last_seen` chỉ là timestamp quan sát — không còn được đọc như `verified_at`. Không biến category `restaurant` thành bằng chứng giò chả, không biến web snippet thành canonical place. Nếu không resolve được scope, không tự nhận exact.

FAST local đủ 2 exact thì dừng trước live providers. Nếu thiếu, gọi live web + own index cùng deadline. Timeout/lỗi dịch vụ hiện rõ trong `federation`. Query không-local không gọi Places. Endpoint này chỉ retrieve; `vietscope-1` synthesis vẫn nằm ở facade.

## Áp vào checkout upstream

Dùng patch `services/search-router-port.patch` từ root checkout VietScope (commit nêu trên):

1. `git apply --check /path/to/facade/services/search-router-port.patch`
2. `git apply /path/to/facade/services/search-router-port.patch`
3. Chạy pytest hai test mới cùng `tests/test_local_discovery.py` với toolchain Python 3.12 của core.
4. Rebuild search-router bằng Compose hiện có: `docker compose up -d --no-deps --build search-router`.
5. Đặt `RETRIEVAL_BACKEND=search-router`, `SEARCH_ROUTER_URL`, `SEARCH_ROUTER_API_KEY` trong facade.

Hoặc build snapshot: `docker build -t vietscope-search-router:retrieve-v1 services/search-router`. Không cần dependency/framework mới; giữ pyproject/lock upstream.

## Production Retrieval Gate

- ASGI route thật, request validation, exact/unverified/related, stop/widen/degrade/timeout.
- Binding `ExistingCoreServices` dùng QueryUnderstanding, AdminGraph, normalizer/ranker thật; chỉ transport ngoài bị thay thế trong unit tests.
- `scripts/test-core-port.ts` giải mã JSON từ Python qua **chính `fromWire()` mà adapter TypeScript dùng**.
- `docker-compose.production.yml` dựng core cùng PostGIS, Redis, OpenSearch, Qdrant và SearXNG; facade bị khóa ở `RETRIEVAL_BACKEND=search-router`, không fallback.
- `npm run test:conformance:production` và `npm run test:e2e:production` chạy trên endpoint Python thật; CI còn dừng SearXNG để kiểm degraded-provider behavior.
- `npm run benchmark:production -- --gate` chạy năm query LOCAL-1 live, ghi report không phải fixture. Gate chất lượng chỉ có ý nghĩa khi deployment đã nạp dữ liệu thật và nhãn được review.

Production retrieval path đã trở thành first-class CI gate, nhưng điều đó **không** đồng nghĩa dữ liệu toàn quốc hay CD public đã sẵn sàng. Request `research` có budget riêng nhưng endpoint retrieve chưa chạy nghiên cứu LLM đa hop — không gọi research/answer để lén dùng LLM.

## Không thay đồng loạt legacy APIs trong một lần

Các client mới/facade/MCP đi qua `/v1/retrieve`. Legacy `/v1/search`, `/v1/places/search`, `/v1/business/search` vẫn còn để tương thích; chuyển từng API sau parity test, tránh vòng gọi endpoint mới → cũ → mới. Endpoint mới gọi dịch vụ nội bộ, không fan-out HTTP về các legacy routes.
