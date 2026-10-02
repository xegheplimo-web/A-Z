# VietScope · North Star

> **VietScope is a Vietnam-first Search and Answer Engine that discovers information across the web and specialized Vietnamese sources, understands Vietnamese language, entities and geography deeply, retrieves and ranks trustworthy evidence, returns fast structured search results and citation-backed answers, and continuously improves its own Vietnam data coverage from every search.**

> **VietScope là công cụ tìm kiếm và trả lờii AI ưu tiên Việt Nam, có khả năng tìm kiếm đa nguồn, hiểu sâu tiếng Việt, thực thể và địa lý Việt Nam; truy xuất, đối chiếu và xếp hạng thông tin đáng tin cậy; trả kết quả nhanh, có cấu trúc và câu trả lờii kèm dẫn nguồn; đồng thờii tự làm giàu kho dữ liệu Việt Nam sau mỗi lần tìm kiếm.**

## 4 tiêu chí sống còn của mọi feature

Mọi feature chỉ được thêm nếu giúp ít nhất một trong bốn thứ:

1. **Tìm được nhiều hơn** (recall / coverage)
2. **Tìm đúng hơn** (precision / exact-match / honesty)
3. **Trả nhanh hơn** (latency)
4. **Làm dữ liệu Việt Nam ngày càng đầy đủ hơn** (data flywheel)

## Gói sản phẩm — "1 model" ở góc nhìn ngườii dùng

- Ngườii dùng/API consumers chỉ gọi **`vietscope-1`** (`/v1/chat/completions`, OpenAI-compatible).
- Bên trong là **Compound Search Model**: Query Understanding → SourceRouter → federated retrieve → dedup → ranking → quality gate → evidence → synthesis → verify → citations.
- Dữ liệu thờii gian thực (giá, giờ mở cửa, văn bản mới) **không** nằm trong trọng số model — nằm ở lớp retrieval (Postgres/OpenSearch/places graph/web providers).

## Nguyên tắc kiến trúc (đóng băng)

- **LLM không phải Search Engine** — routing, query expansion, dedup, cache, geocoding, provider selection, basic ranking: deterministic. LLM chỉ synthesis / deep research / conflict explanation / claim verification.
- **Precision trước khi lấp đầy màn hình** — thà nói "chưa tìm thấy đủ bằng chứng" còn hơn giả vờ exact match.
- **Không fan-out mọi nguồn cho mọi query** — SourceRouter + Progressive Widening.
- **Search API và Answer API tách rờii** — `/v1/search`, `/v1/places/search`, `/v1/retrieve` không bắt buộc LLM; `/v1/answer`, `/v1/chat/completions` có synthesis.
- **Mọi claim đều citation** — claim → source → passage; thiếu bằng chứng = gắn cờ.
- **Chất lượng đo bằng benchmark** — bộ golden tiếng Việt (50 → 300 → 1.000+), không đánh giá bằng cảm giác.

## ⚑ Quyết định đã đóng băng: MỘT retrieval brain

```
                  USER / APP / AI AGENT  →  model = "vietscope-1"
                              │
        ┌─────────────────────┴─────────────────────┐
        │ FACADE (repo này: Next.js)                │   vietscope-1 · OpenAI API · MCP một tool · UI
        │ auth · quota · usage · synthesis · verify │   KHÔNG chứa logic retrieval
        └─────────────────────┬─────────────────────┘
                              │  Retrieval Contract v1  (src/core · docs/retrieve.contract.md)
                              ▼  POST /v1/retrieve
        ┌─────────────────────────────────────────────┐
        │ RETRIEVAL BRAIN — chọn bằng RETRIEVAL_BACKEND│
        │  search-router  → production (SearXNG, OpenSearch, Qdrant, PostGIS…)
        │  embedded       → engine tham chiếu / fixture benchmark (src/engine/embedded)
        └─────────────────────────────────────────────┘
```

- Hai engine **không** chạy song song: chỉ backend được chọn mới được nạp (đã có test chứng minh).
- Ranh giới được **máy kiểm tra**: `node scripts/check-boundaries.mjs` (facade không import engine, không đọc bảng của brain).
- `/v1/search`, `/v1/places/search`, `/v1/evidence`, MCP `vietscope_retrieve` đều chỉ là facade của `retrieve()`; `/v1/answer`, chat, responses = `retrieve()` → synthesize → verify.
- Brain production = `search-router`; nó **chưa có** `/v1/retrieve` — xem `docs/PORTING-TO-SEARCH-ROUTER.md`.
- Đóng băng feature mới cho đến khi đạt các gate chất lượng; việc tiếp theo là execution + benchmark + data acquisition.

## Kiểm thử (đều chạy được không cần GPU/API key)

| lệnh | kiểm tra |
|---|---|
| `node scripts/check-boundaries.mjs` | ranh giới facade ↔ brain |
| `npx tsx scripts/conformance.ts` | contract · một-brain · **parity** VN_GOLDEN giữa hai backend · lỗi adapter |
| `npx tsx scripts/smoke-upstreams.ts` | LLM gateway (retry/timeout/breaker/stream/usage thật) + lane web của engine embedded |
| `npx tsx scripts/test-auth.ts` | API key hash · rate limit/quota/usage ở Postgres · MCP session stateless |
| `npx tsx scripts/bench-scale.ts` | engine tham chiếu ở 150k places + 60k docs: latency, index, chất lượng dưới nhiễu |
| `POST /v1/eval/run` | benchmark VN_GOLDEN (59 case) qua backend đang chọn |

## Kiến trúc đã hiện thực trong repo này (`vietscope-1`)

```
model = "vietscope-1"  →  VietScopeModel (src/lib/model.ts)
  understand (src/lib/understand.ts, deterministic: dấu/không dấu, địa danh cũ→mới, chuyên ngành)
  → budget FAST | STANDARD | RESEARCH (src/lib/budget.ts, tự chọn, không lộ ra ngoài)
  → retrieve song song: canonical places · corpus · search-hub (src/lib/federation.ts)
  → progressive widening (canonical thiếu → web) + flywheel (ứng viên → place_candidates)
  → normalize → dedup URL → RRF → (multi-hop cho RESEARCH)
  → synthesize: Inference Engine LLM (src/lib/inference.ts) hoặc extractive (src/lib/answer.ts)
  → verify (src/lib/evidence.ts) → trace (src/lib/traces.ts) + coverage gap (src/lib/coverage.ts)
  → quality gate: confidence · coverage · independent_sources
```

| Endpoint | Vai trò |
|---|---|
| `GET /v1/models` | chỉ MỘT model public: `vietscope-1` |
| `POST /v1/responses` | OpenAI Responses API (+stream) |
| `POST /v1/chat/completions` | OpenAI chat (+stream) |
| `POST /v1/retrieve` | retrieval brain cho Hermes/agents |
| `POST /v1/search` · `GET /v1/places/search` | Core Search / Local Search — không cần LLM |
| `POST /v1/answer` · `POST /v1/evidence` | answer + citation (passage/offset) |
| `GET /v1/providers` | federation health + quy mô dữ liệu + flywheel |
| `POST /v1/eval/run` | benchmark vn-golden đo thật |
| `POST /mcp` | MCP adapter — agent chỉ gọi MỘT tool `vietscope_retrieve` |
| `GET /v1/coverage` · `POST /v1/coverage/promote` | Coverage Engine + khép kín flywheel |
| `GET /v1/traces` · `POST /v1/feedback` | training traces (§11) + nhãn preference |

Inference Engine (LLM): `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` (override theo vai trò `LLM_PLANNER_MODEL`/`LLM_SYNTH_MODEL`/…).
Backend là cấu hình, không phải kiến trúc: (A) API ngoài — khuyến nghị hiện tại, vd Qwen3.8-Flash-Next;
(B) llama.cpp local 20–35B quant trên 24 GB VRAM; (C) máy lớn: Flash-Next + MTP speculative decoding.
`mtp-*.gguf` chỉ là draft head tăng tốc, không phải model chính. Kiểm thử tích hợp: `npx tsx scripts/smoke-upstreams.ts`.
Ghép với repo VietScope (search-router): đặt `SEARCH_HUB_URL` (+ `SEARCH_HUB_API_KEY`) → lane `search-hub`.
Tài liệu gốc của repo nằm trong `upstream/`.

## Roadmap

```
P0  Stability / reproducibility                    ✅
P1  LOCAL-1 precision + recall + latency           ← bản demo này
P2  Server-side retrieval/fallback                 ✅ (/v1/retrieve)
P3  MCP retrieve/local_search                      ✅ (POST /mcp, một tool duy nhất)
P4  LOCAL-2 PlaceCandidate                         ✅ (staging + flywheel)
P5  Coverage Engine                                ✅ (coverage_gaps + promote candidate)
P6  Unified /v1/search federation                  ✅ (bản khung)
P7  Retrieval/ranking quality (OpenSearch + Qdrant + RRF ✅ + fuzzy typo ✅; còn: reranker)
P8  Evidence + citation quality (passage offsets ✅ + /v1/evidence ✅)
P9  Vietnam corpus expansion
P10 Answer Engine refinement                       ✅ khung: InferenceGateway (roles, retry/timeout theo budget, breaker, stream thật) — còn: prompt tuning trên LLM thật
P11 OpenAI-compatible API                          ✅ (/v1/responses + /v1/chat/completions + stream)
P12 Billing/API keys/quotas                        (khung: VIETSCOPE_API_KEYS + rate limit ✅)
P13 Production/CD/scale
```

Kiến trúc production đầy đủ (SearXNG, Firecrawl, OpenSearch, Qdrant, reranker, hub-postgres,
MCP adapter): xem `ARCHITECTURE.md` trong repo VietScope. Bản demo Next.js này hiện thực hóa
cùng contract API và cùng pipeline bằng Postgres + deterministic retrieval (module thay thế được).


## Execution update — một brain, pilot Yên Dũng

Không mở vertical/framework/model mới. Ba việc của đợt này:

1. **Port core**: source snapshot `services/search-router` (upstream `6257130e`) đã có `POST /v1/retrieve`, scope `search:read`, capability và test. Reuse QueryUnderstanding, AdminGraph, PlacesService, SourceRouter/FederatedExecutor, hybrid index và reader. Patch có thể áp vào upstream; chưa push GitHub hay deploy stack ngoài sandbox.
2. **LOCAL-1**: 5 câu hỏi của chủ dự án lưu BEFORE/AFTER thật ở `reports/`; sửa sắt/bách hóa, specific scope Neo, strict specialty. Câu sắt Tân An trả 0 exact khi chưa có bằng chứng. Bộ VN_GOLDEN 59 → 64, không tự sinh 300 nhãn để quảng bá.
3. **Observations / Coverage pilot**: tách LegalEntity 1–N outlets; staging immutable/idempotent, field provenance, review có ghi chú và ≥2 nguồn; fixture không vào public search. Demand tuần → job priority; atomic claim + fenced lease token → import batch đúng scope. Workspace `/data/pilot`, CLI `scripts/pilot-import.ts`.

### Gate và giới hạn

- ASGI/main mount và binding core đã kiểm thử bằng I/O fixture; legacy LOCAL-1 tests không bị phá.
- Facade một brain/parity kiểm chứng qua `scripts/conformance.ts`; dữ liệu fixture không thay số đo production.
- `H3 = null` khi chưa xác định; chưa tuyên bố đã import PBF/registry Việt Nam hay có crawler tự động.
- Ops pilot chỉ có ở backend embedded hiện tại; backend search-router không hỗ trợ phải báo rõ, không âm thầm chuyển brain.
- Không còn promote public `verified:true`. Canonical writes cần quan sát có nguồn và quyền quản trị.
- Cần live tests trên stack thật trước beta: 3s/5s/10s P95, nhãn độc lập, OSM/registry licensing, shared cache/provider state, rollout và monitoring.

Tài liệu triển khai: `docs/PORTING-TO-SEARCH-ROUTER.md`, `docs/PILOT-YEN-DUNG.md`.
