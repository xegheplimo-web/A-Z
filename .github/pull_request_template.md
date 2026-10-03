## Summary

<!-- 1-3 câu: PR này làm gì, tại sao. Link issue/phase nếu có: Fixes #___ -->

## Changes

<!-- Bullet ngắn các thay đổi chính -->

-

## Tests

<!-- Tick những gì đã chạy local và pass. Tối thiểu theo CONTRIBUTING.md §5 -->

- [ ] `./scripts/verify` (hoặc `.ps1`) — xanh
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run check:boundaries`
- [ ] `npm run build`
- [ ] `npm run test:conformance` (nếu đụng `/v1/*` / retrieval contract)
- [ ] `cd services/search-router && uv run pytest -q -m "not e2e and not live"` (nếu đụng Python core)
- [ ] `docker compose config --quiet` (nếu đụng compose/Dockerfile)

## Database changes

<!-- None, hoặc mô tả schema change (drizzle / search-router migrations) + cách apply -->

None

## New environment variables

<!-- None, hoặc liệt kê biến mới — PHẢI đã thêm vào .env.example, giá trị mặc định an toàn, không chứa secret -->

None

## Breaking changes

<!-- None, hoặc mô tả điểm break + migration path -->

None

## Security impact

<!-- None, hoặc lưu ý auth/SSRF/secrets/rate-limit liên quan. Lỗ hổng thật → SECURITY.md, không qua PR public -->

None
