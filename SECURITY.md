# Chính sách bảo mật (Security Policy)

## Phiên bản được hỗ trợ

VietScope đang ở giai đoạn pre-1.0 — chỉ branch `main` nhận bản vá bảo mật.

| Phiên bản           | Hỗ trợ |
| ------------------- | ------ |
| `main` (mới nhất)   | ✅     |
| Bản cũ hơn / tag cũ | ❌     |

## Báo cáo lỗ hổng

**Không mở public Issue cho lỗ hổng bảo mật.**

Dùng **GitHub Private Vulnerability Reporting**:

1. Vào repo → tab **Security** → **Advisories** → **Report a vulnerability**.
2. Mô tả: ảnh hưởng, bước tái hiện, commit/version bị ảnh hưởng, gợi ý vá (nếu có).
3. Report chỉ maintainer thấy; trao đổi fix riêng tư trước khi công bố.

Maintainer sẽ phản hồi sớm nhất có thể (dự án cá nhân — không cam kết SLA, nhưng ưu tiên report bảo mật trước mọi việc khác).

## Phạm vi quan tâm

Các vấn đề được coi là lỗ hổng trong repo này:

- Bypass auth/API key trên `/v1/*`, `/v1/admin/*`, `/ops/*` (vd khi `VIETSCOPE_ADMIN_KEY` đã đặt mà vẫn truy cập được).
- SSRF qua các upstream URL (`SEARCH_ROUTER_URL`, `SEARCH_HUB_URL`, `LLM_BASE_URL`, provider connectors trong search-router — xem `services/search-router/security/ssrf.py`).
- Rate-limit/quota bypass (kể cả qua `X-Forwarded-For` khi `TRUST_PROXY_HEADERS` tắt).
- Lộ secrets: key/token/password bị commit vào repo, log, hoặc response API.
- SQL injection / path traversal / RCE trong facade hoặc Python core.
- Telemetry/PII retention sai hợp đồng (`npm run telemetry:retention`).

## Nếu lỡ commit secrets

1. **Rotate ngay** secret đó (coi như đã lộ — Git history không xoá được bằng commit mới).
2. Báo maintainer qua private report nếu là secret của dự án; purge history sau khi rotate.

## Hardening notes cho người tự deploy

- Production bắt buộc `RETRIEVAL_BACKEND=search-router`, `RETRIEVAL_FALLBACK` rỗng (fail-closed, không âm thầm degrade về fixture engine).
- Đặt `VIETSCOPE_ADMIN_KEY` strong random (`openssl rand -hex 32`); `MCP_SESSION_SECRET` random **độc lập** (không derive từ `DATABASE_URL`).
- `VIETSCOPE_API_KEYS` rỗng = demo mở, không auth — **không** deploy public ở trạng thái này.
- Chỉ bật `TRUST_PROXY_HEADERS` khi reverse proxy của bạn **overwrite** `X-Forwarded-For` (không forward nguyên xi), nếu không kẻ ngoài giả IP bypass rate-limit / vào `/ops/*`.
- Postgres production: đổi `postgres:postgres` mặc định trong `DATABASE_URL`.
- Audit định kỳ (đã có trong CI `hygiene`): `npm audit --omit=dev --audit-level=high`, `pip-audit` trên `services/search-router/requirements.txt`.
