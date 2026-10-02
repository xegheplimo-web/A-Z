# VietScope · `vietscope-1`

Vietnam-first Search & Answer Engine — một model public (`vietscope-1`), một retrieval brain.
Xem `VISION.md` (North Star + kiến trúc đóng băng), `docs/retrieve.contract.md`, `docs/PORTING-TO-SEARCH-ROUTER.md`.

```
Facade (repo này)  ──  Retrieval Contract v1  ──►  Retrieval brain: search-router (production) | embedded (tham chiếu)
```

## Chạy
```bash
cp .env.example .env          # DATABASE_URL; RETRIEVAL_BACKEND=embedded (mặc định)
npx drizzle-kit push          # tạo bảng
npx tsx src/db/seed.ts        # dữ liệu cho engine embedded
npm run build && npm start
```
Production: `RETRIEVAL_BACKEND=search-router` + `SEARCH_ROUTER_URL` (cần `/v1/retrieve` — xem tài liệu port).

## Kiểm thử
```bash
node scripts/check-boundaries.mjs
npx tsx scripts/conformance.ts
npx tsx scripts/smoke-upstreams.ts
npx tsx scripts/test-auth.ts
npx tsx scripts/bench-scale.ts
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
