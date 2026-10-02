# Validation evidence

- `local1-before.json`: output measured before this change on the existing embedded reference dataset. 26/30 checks passed. No fixture reset was used to make the baseline worse.
- `local1-after.json`: same five questions after aliases + narrower scope + strict-specialty gate. Run `npx tsx scripts/local1-pilot.ts --gate` to refresh. Tân An has **zero verified steel outlets in this dataset**; zero exact is the expected answer.
- `core-contract-fixture.json`: produced by the FastAPI ASGI test, with dependency I/O fixtures. Decoded by `npx tsx scripts/test-core-port.ts` using the actual TypeScript wire decoder.

Measurements are **not a national/live-service benchmark**. Times use a small local PostgreSQL fixture. Full stack P95, evidence correctness on real legal documents, and actual geographic/admin records still need independent labels and live deployment validation.

Main regression suite: 59 → 64 questions. Existing case L24 (`cửa hàng bán máy khoan gần đây` without any location) now expects abstention instead of a fabricated nearby result. Explicit lat/lng remains supported.
