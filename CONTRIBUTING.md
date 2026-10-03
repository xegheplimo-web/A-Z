# Đóng góp vào VietScope (`A-Z`)

Cảm ơn bạn đã quan tâm đóng góp. Repo này là **facade** (Next.js 16 + React 19 + TypeScript + drizzle-orm/Postgres) phía trước một **retrieval brain** bằng Python (`services/search-router/`). Đọc `README.md` để hiểu kiến trúc, `docs/retrieve.contract.md` cho Retrieval Contract v1.

Pipeline chuẩn của một đóng góp:

```
PLAN → branch feat/xxx → Draft PR → CODE → LOCAL VERIFY
   → atomic commit(s) → PUSH → PR CI → REVIEW → MERGE → MAIN CI → CD
```

## 1. Fork, clone, remote

Contributors bên ngoài **không có quyền push trực tiếp** — mọi thay đổi đi qua fork + Pull Request.

```bash
# Fork repo trên GitHub trước, rồi:
git clone https://github.com/<USERNAME>/A-Z.git
cd A-Z
git remote add upstream https://github.com/xegheplimo-web/A-Z.git
git fetch upstream
```

## 2. Dựng môi trường

Yêu cầu: Node `22.x`, npm `10+`, Python `3.12.x`, uv `0.12.18`, Docker + Compose v2 (xem bảng chi tiết trong `README.md`).

```powershell
# Windows
.\scripts\setup.ps1     # prereqs → .env → npm ci → Postgres (Docker) → schema+seed → uv sync
```

```bash
# Linux / macOS
./scripts/setup.sh      # flags: --skip-python --skip-docker --production
```

Nếu checkout chưa có `scripts/setup.*` (đang landing qua PR riêng), làm theo đường tay trong `README.md` (Cách 1/2): `cp .env.example .env` → `npm ci` → Postgres → `npx drizzle-kit push` + seed → `uv sync --frozen` trong `services/search-router/`.

Nếu dùng VS Code / Codespaces: mở repo trong **Dev Container** (`.devcontainer/`) — Node 22 + Python 3.12 + uv + Docker-in-Docker đã dựng sẵn. Nếu dùng `mise`: `mise install` đọc `mise.toml` và cài đúng toolchain.

Sau setup, kiểm tra nhanh:

```bash
.\scripts\verify.ps1    # hoặc ./scripts/verify.sh
```

## 3. Tạo branch

Đừng code trên `main`. Tên branch theo loại thay đổi:

```bash
git switch -c feat/ten-tinh-nang      # tính năng
git switch -c fix/ten-loi             # sửa lỗi
git switch -c chore/ten-viec          # tooling/docs/infra
git switch -c phase/<phase-id>        # theo phase plan nội bộ (nếu có PLAN.md)
```

## 4. Mở Draft PR sớm

Push branch rồi mở **Draft PR** ngay cả khi chưa code xong — CI chạy sớm, maintainer thấy hướng đi. Điền đủ template PR (summary, tests, DB changes, env vars, breaking changes).

```bash
git push -u origin feat/ten-tinh-nang
gh pr create --draft
```

## 5. Code + verify trước khi push

**Không push khi chưa chạy verify local.** Ma trận tối thiểu theo vùng code:

| Bạn sửa                              | Chạy tối thiểu                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `src/` (facade TS)                   | `npm run lint` · `npm run typecheck` · `npm run check:boundaries` · `npm run build`                                 |
| API `/v1/*`, retrieval contract      | + `npm run test:conformance`                                                                                        |
| `src/db/` schema                     | + `npx drizzle-kit push` · `npx tsx src/db/seed.ts` · suite test cần DB                                             |
| `services/search-router/`            | `uv run ruff check .` · `uv run pyright -p pyright-pnextconfig.json` · `uv run pytest -q -m "not e2e and not live"` |
| `docker-compose*.yml`, `Dockerfile*` | `docker compose -f docker-compose.yml config --quiet` (và cả overlay production nếu đụng)                           |
| `.github/`, docs, scripts            | `.\scripts\verify.ps1` / `./scripts/verify.sh`                                                                      |

`./scripts/verify.sh` (hoặc `.ps1`) chạy gần trọn CI local: lint · typecheck · boundaries · build · contract + DB + Python suites. Đây là cách nhanh nhất biết PR có xanh không. Chưa có script verify thì chạy tay các lệnh trong cột phải của bảng trên.

## 6. Commit

Commit nhỏ, atomic — một commit một ý. Message theo conventional style:

```
feat(search): improve Vietnamese query normalization
fix(api): return 503 when search-router is unreachable
docs: add retrieval contract examples
chore(deps): bump drizzle-orm to 0.45.2
```

Nội bộ repo cũng dùng prefix phase-id (`P-LEARNING-6: ...`, `VN100-0: ...`) — contributor ngoài cứ dùng conventional style.

## 7. CI phải xanh

Mọi PR vào `main` chạy đủ job trong `.github/workflows/ci.yml` — hiện là `lint`, `typecheck`, `build`, `compose-contract`, `python-core`, `test`, `e2e`, `production-retrieval-e2e` (danh sách chính xác luôn ở file workflow; job `hygiene` sẽ join khi PR tương ứng merge). PR chỉ merge được khi các required checks pass và branch up-to-date với `main`.

CI đỏ → fix → push lại vào **cùng branch** (PR tự cập nhật). Đừng mở PR mới.

## 8. Quy ước quan trọng

- **Secrets**: chỉ qua env vars. Không bao giờ commit `.env`, API key, token, SSH key. Biến môi trường mới → thêm vào `.env.example` (và `services/search-router/.env.example` nếu thuộc core) + ghi chú trong PR.
- **Dependencies**: cài đúng lockfile — `npm ci`, `uv sync --frozen`. Không sửa tay `package-lock.json`/`uv.lock`; đổi dep thì `npm install <pkg>` / `uv add <pkg>` rồi review diff lock.
- **Format**: prettier (`npm run format`). `format:check` đang advisory — chỉ format file bạn sửa, đừng format cả repo trong một PR tính năng.
- **Python**: ruff (`--select E4,E7,E9,F` toàn repo + strict surface theo CI) và pyright phải sạch.
- **Không commit dữ liệu lớn**: indexes, DB dumps, model weights, `node_modules`, logs. Dataset lớn đi qua download script/object storage, không qua Git.
- **DB**: facade dùng drizzle (`src/db/schema.ts` → `drizzle-kit push`); search-router có migrations riêng trong `services/search-router/db/migrations/` — hai schema không dùng chung bảng.
- **Fail-closed**: giữ nguyên semantics production (vd `RETRIEVAL_FALLBACK` rỗng → 503 rõ ràng). Đừng thêm fallback âm thầm.

## 9. Báo lỗi & bảo mật

- Bug thường: mở **Issue** qua template `Bug report` — khai đủ OS, version, steps, logs (che secrets).
- Lỗ hổng bảo mật: **KHÔNG** mở issue public — làm theo `SECURITY.md` (GitHub Private Vulnerability Reporting).
- Ý tưởng tính năng: template `Feature request`.

## 10. License

Repo phát hành dưới **Apache-2.0** (`LICENSE`). Khi gửi PR bạn đồng ý đóng góp của mình được phát hành dưới cùng license (Apache-2.0 §5 — Submission of Contributions).
