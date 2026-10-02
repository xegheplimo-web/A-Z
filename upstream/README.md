# upstream/ — tham chiếu từ repo VietScope (search-router)

Bản chép (read-only) từ https://github.com/xegheplimo-web/VietScope để dự án Next.js này bám đúng contract:

- `ARCHITECTURE.md`           kiến trúc production: SearXNG, OpenSearch, Qdrant, reranker, hub-postgres…
- `api/openapi.yaml`          OpenAPI của search-router (:8888)
- `api/baseline.openapi.json` baseline contract
- `api/openai-compat.md`      tài liệu OpenAI-compat của search-router
- `eval/golden_set.json`      golden set 50 câu của repo (thiên về tech/EN) — tham chiếu khi mở rộng VN benchmark
- `env.example`               biến môi trường của search-router

Ghép nối: đặt `SEARCH_HUB_URL` (+ `SEARCH_HUB_API_KEY`) → lane **search-hub** trong `src/lib/federation.ts`
gọi `POST /v1/search` của search-router, chuẩn hoá → dedup → RRF cùng canonical places & corpus.
