# VN100-0 Label Contract v1 — FROZEN

Khóa vocabulary trước khi nhân dataset (VN100-20 → 50 → 100). Thay đổi vocabulary
= bump contract version + migrate, không sửa lặt vặt trên dữ liệu đang sống.

Enforcement: `src/lib/golden.ts` — `validateGoldenLabels()` reject tại write-time;
`approveGoldenCandidate()` re-check trước khi approve. Dữ liệu vi phạm không bao
giờ vào `golden_candidates`.

## Case shape (golden_candidates)

| Field | Type | Bắt buộc approve | Ghi chú |
|---|---|---|---|
| query_safe | string (redacted) | ✓ | từ bad_search_reviews |
| intent | enum `INTENTS` | ✓ | `local_search\|legal\|market_price\|weather\|compare\|admin_info\|product\|news\|general` |
| geo_scope | `{admin_ids?, anchor?, radius_m?}` | — | xem bên dưới |
| specialty | string | — | "nhà thuốc", "cà phê"… |
| expected_entities | string[] | ∨ | tên kết quả phải có |
| abstention_expected | boolean | ∨ | đúng = 0 exact là kết quả đúng |
| relevance_labels | `{entity: 0..3}` | — | xem thang bên dưới |
| freshness_requirement | enum | ✓ | `static\|slow\|medium\|high\|realtime` |
| authority_requirement | enum | ✓ | `any\|observed_or_better\|corroborated_or_better\|verified_or_better\|authoritative` |
| review_note | string (redacted) | ✓ (khi label) | lý do human label |
| provenance | review_id + trace_id + evidence_snapshot | ✓ | tự động lúc tạo |

Bắt buộc approve: `intent` + `freshness_requirement` + `authority_requirement`
+ (`expected_entities` không rỗng HOẶC `abstention_expected=true`).
`abstention_expected=true` kèm expected_entities không rỗng → reject (mâu thuẫn).

## geo_scope v1

```json
{ "admin_ids": ["new:07681"] }
```

hoặc/và cho query "gần X":

```json
{ "anchor": { "label": "Neo" }, "radius_m": 2000 }
```

hoặc anchor tọa độ: `{ "anchor": { "lat": 21.28, "lng": 106.19 }, "radius_m": 2000 }`.

- `admin_ids` → assert `understanding.resolved_current_ids` chứa đủ.
- `anchor.label` → assert `retrieval.anchor` resolve và label khớp (normalized contains).
- `anchor.lat/lng` → assert anchor trong vòng 1 km.
- `radius_m` → mọi place exact/unverified phải trong bán kính (distance_km hoặc haversine từ anchor). Chỉ hợp lệ kèm `anchor`.

## relevance_labels thang 0–3

Grade được gán trên **entity name** (không phải result id — result id thay đổi
theo lần chạy, còn ground truth gắn với entity):

| Grade | Nghĩa | Eval assert |
|---|---|---|
| 3 | exact-correct — đúng entity người dùng cần | phải có trong `places.exact` |
| 2 | relevant-partial — đúng nhưng chưa đủ bằng chứng | phải có trong exact ∪ unverified |
| 1 | related-only — chỉ nên ở related | không được trong exact |
| 0 | irrelevant/harmful | không được trong exact |

## freshness_requirement

Về tốc độ ground truth thay đổi — quyết định chu kỳ re-verify và assert freshness
khi benchmark:

| Value | Nghĩa | Eval assert |
|---|---|---|
| `realtime` | thay đổi trong giờ/ngày (giá, tin tức nóng) | `understanding.freshness ∈ {today, recent}` |
| `high` | thay đổi hàng tuần/tháng (giờ mở cửa, giá niêm yết) | `understanding.freshness ∈ {today, recent}` |
| `medium` | thay đổi hàng quý (menu, dịch vụ) | — |
| `slow` | thay đổi hàng năm (địa chỉ, số điện thoại) | — |
| `static` | gần như không đổi (lịch sử hành chính, điều luật đã ban hành) | — |

Alias legacy `"current"` → normalize thành `high` ngay lúc ghi (không lưu vào DB).

## authority_requirement

Rung tối thiểu trên verification ladder `observed < corroborated < verified < authoritative`
áp cho **mọi** `places.exact`:

| Value | Min rank |
|---|---|
| `any` | không yêu cầu (case legal/news/web không đánh giá place authority) |
| `observed_or_better` | ≥ observed (vẫn cho phép unverified exact — hiếm) |
| `corroborated_or_better` | ≥ corroborated |
| `verified_or_better` | ≥ verified |
| `authoritative` | = authoritative |

`PlaceDTO.verification_level` (Retrieval Contract v1, additive) mang level từ
brain; embedded backend map `verified:true → "verified"`.

## Hai nguồn vào — `golden_candidates.source`

| Source | `review_id` | `trace_id` | Nghĩa |
|---|---|---|---|
| `bad_search_review` | bắt buộc → review `confirmed_bad` | trace lúc phát hiện | failure-derived — đo "lỗi từng xảy ra có tái phát không" |
| `manual_nomination` | `null` (không đụng `bad_search_reviews`) | trace gần nhất nếu có, ngược lại `null` | positive control — đo regression "trước đúng giờ sai" |

Sau `candidate_created` hai nguồn giống nhau: cùng funnel label → approve →
promote, cùng `validateGoldenLabels()`, cùng dedup một active candidate theo
`query_safe`. `promoted_to_golden` trên `bad_search_reviews` chỉ áp dụng khi
`review_id` tồn tại.

Manual nomination **không chạy `record:true`**: không trace gần nhất → dry-run
`analyze(log:false)` → `evidence_snapshot.source_kind = "dry_run"`. Benchmark
traffic không bao giờ làm bẩn `search_traces`/`coverage_signals`/demand.

## Ranh giới với VN_GOLDEN legacy

`eval/golden_set.json` / suite `VN_GOLDEN` trong `src/lib/eval.ts` là regression
suite nội bộ — **không phải** VN100. VN100 chỉ đến từ `golden_candidates`
approved/promoted (suite `golden-promoted`), có human label + provenance đầy đủ.

Benchmark luôn chạy `record:false` (log:false) — không làm bẩn telemetry/coverage.
