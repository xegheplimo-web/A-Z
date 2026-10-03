// ---------------------------------------------------------------------------
// /ops/* proxy — chuyển hướng về /ops/auth khi request không mang credential
// nào (production). Đây chỉ là presence-check cho UX; quyết định auth thật
// nằm ở opsAccessOk() trong từng ops page (verify cookie HMAC / Bearer / IP).
// ---------------------------------------------------------------------------
import { NextResponse, type NextRequest } from "next/server";

const INTERNAL_IP = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd])/i;

export function proxy(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();
  if (req.nextUrl.pathname === "/ops/auth") return NextResponse.next();
  if (req.cookies.has("vs_ops") || req.headers.has("authorization")) return NextResponse.next();
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (INTERNAL_IP.test(ip)) return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/ops/auth", req.url));
}

export const config = { matcher: "/ops/:path*" };
