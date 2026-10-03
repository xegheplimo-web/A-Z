// ---------------------------------------------------------------------------
// VietScope · Ops surface access control
//
//   /ops/* hiển thị query_safe, bad-search queue, coverage cells — không phải
//   public surface. `robots: noindex` không phải access control.
//
//   Cho qua khi MỘT trong các điều kiện đúng:
//     1. Authorization: Bearer <VIETSCOPE_ADMIN_KEY> (timing-safe compare)
//        — đường chính cho production: curl, SSO-header injection, mTLS proxy.
//     2. Client IP thuộc mạng nội bộ (loopback / RFC1918) — chỉ được tin khi
//        TRUST_PROXY_HEADERS=true, tức reverse proxy mình kiểm soát đã
//        overwrite X-Forwarded-For bằng client IP thật.
//     3. NODE_ENV != 'production' — dev/demo mở (giống authEnabled()=false).
//
//   Production mà không set VIETSCOPE_ADMIN_KEY và không trust proxy →
//   fail-closed (404), không lộ data ops.
// ---------------------------------------------------------------------------
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { hashKey } from "@/lib/auth";

function isInternalIp(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^f[cd]/i.test(ip) // fc00::/7 (IPv6 unique-local)
  );
}

/** true = request được phép xem ops surfaces. */
export async function opsAccessOk(): Promise<boolean> {
  const h = await headers();

  const admin = process.env.VIETSCOPE_ADMIN_KEY?.trim();
  if (admin) {
    const token = (h.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    const a = Buffer.from(hashKey(token));
    const b = Buffer.from(hashKey(admin));
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  if (process.env.NODE_ENV !== "production") return true;

  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (ip && isInternalIp(ip)) return true;
  }
  return false;
}
