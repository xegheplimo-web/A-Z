# Retrieval Contract v1 — `POST /v1/retrieve`

Ranh giới duy nhất giữa **Facade** (Next.js: `vietscope-1`, OpenAI API, MCP, UI, auth, synthesis, verification)
và **Retrieval Brain** (một và chỉ một tại runtime: `search-router` ở production).

- Kiểu TypeScript: `src/core/contract.ts` · wire + validator: `src/core/wire.ts`
- Ví dụ **sinh từ chạy thật**: `upstream/contracts/retrieve.request.example.json`, `retrieve.response.example.json`
- Server tham chiếu: `scripts/reference-retrieve-server.ts` · test: `scripts/conformance.ts`

## Request (snake_case)

| trường | kiểu | ghi chú |
|---|---|---|
| `contract_version` | `"1"` | |
| `query` | string | bắt buộc, ≤ 500 ký tự |
| `context` | string \| null | câu hỏi trước đó của người dùng (để kế thừa địa danh/chuyên ngành cho câu nối tiếp) |
| `mode` | `auto\|fast\|standard\|balanced\|research\|deep` | `auto` = brain tự chọn budget |
| `location` | `{lat,lng}` \| null | cho truy vấn "gần đây" |
| `max_results` | int | mặc định 10 |
| `record` | bool | `false` = không ghi coverage gap/trace phía brain (benchmark/test) |

## Response (snake_case) — facade **từ chối** payload sai (`ContractError` → HTTP 503 `backend_unavailable`)

| trường | ý nghĩa |
|---|---|
| `contract_version` | `"1"` |
| `understanding` | `intent` ∈ {local_search, legal, market_price, weather, compare, admin_info, product, news, general}; `specialty`, `categories`, `locations[]` (id, name, type, status, matched_term, fuzzy), **`resolved_current_ids`** (đơn vị hành chính HIỆN HÀNH sau khi resolve địa danh lịch sử), `transition` (from → to, date), `fuzzy{used,notes}` |
| `budget` | `name` ∈ {fast, standard, research}, `reason`, `target_ms`, `multi_hop`, `read_evidence` |
| `places` | **`exact`** (đã xác minh, đúng chuyên ngành + địa bàn) · **`unverified`** (từ web, chưa đủ bằng chứng) · **`related`** (cùng khu vực, không phải exact) · `candidates` (place candidate đang chờ verify) |
| `docs[]` | tài liệu làm evidence, **đã dedup + fuse + xếp hạng**: `url, domain, source_type, snippet, content, authority, published_at, entities, score, why, origin` |
| `coverage` | `gap` (có lỗ hổng dữ liệu?), `reason`, `widened` |
| `scope` | `provinces[]`, `communes[]` — phạm vi địa lý đã resolve (dùng đo outside-area) |
| `quality` | `confidence` (0–1, **của retrieval**), `coverage` ∈ {good, partial, none}, `independent_sources`, `avg_authority` |
| `federation[]` | trạng thái từng provider đã gọi: `provider, lane, status, ms, count, detail` |
| `widening[]` | các bước mở rộng lũy tiến đã thực hiện (để audit) |
| `timings` | `understand_ms, retrieve_ms, rerank_ms, load_graph_ms, total_ms` |

Facade tự thêm `timings.network_ms` và `timings.backend_ms`.

## Hành vi BẮT BUỘC (conformance kiểm tra bằng VN_GOLDEN)

1. **Precision trước khi lấp đầy màn hình.** Không có exact → `places.exact = []` là hợp lệ. Kết quả chỉ liên quan **không bao giờ** được đưa vào `exact`.
2. **Địa giới lịch sử → hiện hành.** "Yên Dũng, Bắc Giang" phải resolve ra `resolved_current_ids` chứa `t_bac_ninh`; `transition` mô tả sáp nhập.
3. **Progressive widening.** canonical/own index → live web → reader → multi-hop; dừng ngay khi quality gate đủ. Ghi mỗi bước vào `widening[]`.
4. **Không fan-out mù quáng.** `federation[].status = "skipped"` khi bước trước đã đủ.
5. **Authority + freshness + diversity** tham gia xếp hạng; `docs[]` đã dedup theo URL chuẩn hoá.
6. **Không dùng LLM trong hot path** (routing, geocoding, dedup, ranking cơ bản).
7. Sai contract = lỗi: không trả trường thiếu/sai kiểu.

## Lỗi

| HTTP | ý nghĩa với facade |
|---|---|
| 404/405 | brain chưa hỗ trợ `/v1/retrieve` → facade trả 503 kèm hướng dẫn port |
| 401/403 | key sai |
| ≥500, timeout, JSON hỏng, sai contract | `503 backend_unavailable` (không âm thầm đổi engine; chỉ fallback nếu `RETRIEVAL_FALLBACK=embedded`) |

## Cách kiểm thử một backend mới

```bash
# Reference serialization/parity + adapter error semantics:
npm run test:conformance

# Core Python đang chạy thật ở :8888 → validator/adapter TypeScript:
SEARCH_ROUTER_URL=http://127.0.0.1:8888 npm run test:conformance:production

# Facade production + benchmark live:
VIETSCOPE_URL=http://127.0.0.1:3000 npm run test:e2e:production
VIETSCOPE_URL=http://127.0.0.1:3000 npm run benchmark:production -- --gate
```
