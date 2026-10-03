// ---------------------------------------------------------------------------
// VietScope · Ops surface access control
//
//   /ops/* hiển thị query_safe, bad-search queue, coverage cells — không phải
//   public surface. `robots: noindex` không phải access control.
//
//   Cho qua khi MỘT trong các điều kiện đúng:
//     1. Session cookie `vs_ops` — nhận qua POST /ops/auth sau khi nhập
//        VIETSCOPE_ADMIN_KEY (đường browser: /ops/auth → HttpOnly cookie).
//        Cookie chỉ chứa <exp>.<hmac(admin_key, "ops."+exp)> — không lưu key.
//     2. Authorization: Bearer <VIETSCOPE_ADMIN_KEY> (timing-safe) — API/curl.
//     3. Client IP nội bộ (loopback / RFC1918) — chỉ được tin khi
//        TRUST_PROXY_HEADERS=true, tức reverse proxy mình kiểm soát đã
//        overwrite X-Forwarded-For bằng client IP thật.
//     4. NODE_ENV != 'production' — dev/demo mở (giống authEnabled()=false).
//
//   Production mà không set VIETSCOPE_ADMIN_KEY và không trust proxy →
//   fail-closed (404), không lộ data ops.
// ---------------------------------------------------------------------------
import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hashKey } from "@/lib/auth";

export const OPS_COOKIE = "vs_ops";
export const OPS_SESSION_TTL_S = 12 * 3600; // 12h — session ngắn hạn

function opsSecret(): string | null {
  return process.env.VIETSCOPE_ADMIN_KEY?.trim() || null;
}

const hmacEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Timing-safe check một token trần với VIETSCOPE_ADMIN_KEY. */
export function opsAdminKeyOk(token: string): boolean {
  const admin = opsSecret();
  return !!admin && !!token && hmacEq(hashKey(token), hashKey(admin));
}

/** Cookie value: `<exp_unix>.<hmac>` — không chứa admin key plaintext. */
export function mintOpsSession(): string | null {
  const secret = opsSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + OPS_SESSION_TTL_S;
  const sig = createHmac("sha256", secret).update(`ops.${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyOpsSession(v: string | undefined): boolean {
  if (!v || !opsSecret()) return false;
  const [exp, sig] = v.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = createHmac("sha256", opsSecret()!).update(`ops.${exp}`).digest("hex");
  return hmacEq(sig, expected);
}

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

  const token = (h.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (token && opsAdminKeyOk(token)) return true;

  const session = (await cookies()).get(OPS_COOKIE)?.value;
  if (verifyOpsSession(session)) return true;

  if (process.env.NODE_ENV !== "production") return true;

  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (ip && isInternalIp(ip)) return true;
  }
  return false;
}
