// ---------------------------------------------------------------------------
// VietScope · API gate — production-shaped
//
//   • API key lưu dạng SHA-256 trong Postgres (bảng api_keys); không lưu plaintext
//   • rate limit + quota + usage nằm ở Postgres → đúng khi chạy nhiều instance
//     (trước đây: Map trong RAM → request vào server A và B đếm riêng)
//   • VIETSCOPE_API_KEYS (env) còn là đường bootstrap tạm thời; so khớp bằng hash
//   • VIETSCOPE_ADMIN_KEY bật /v1/admin/keys để tạo/thu hồi key
//
// Auth bật khi: có VIETSCOPE_API_KEYS hoặc có ≥1 key active trong DB. Tắt = demo mở (vẫn rate limit theo IP).
// Rate limit store lỗi → fail-open (ghi log); xác thực key lỗi → fail-closed.
// ---------------------------------------------------------------------------
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, apiUsage, rateLimitWindows } from "@/db/schema";

export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

interface AuthCtx {
  keyId: string | null;
  subject: string;
}
const ctxByRequest = new WeakMap<Request, AuthCtx>();

function errorJson(status: number, message: string, type: string, extra: Record<string, string> = {}) {
  return Response.json({ error: { message, type, code: status } }, { status, headers: extra });
}

function legacyHashes(): Set<string> {
  return new Set((process.env.VIETSCOPE_API_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean).map(hashKey));
}

let keysCache: { v: boolean; at: number } | null = null;
async function dbHasKeys(): Promise<boolean> {
  if (keysCache && Date.now() - keysCache.at < 10_000) return keysCache.v;
  const [r] = await db.select({ c: sql<number>`count(*)` }).from(apiKeys).where(eq(apiKeys.active, true));
  keysCache = { v: Number(r?.c ?? 0) > 0, at: Date.now() };
  return keysCache.v;
}
export function invalidateAuthCache() {
  keysCache = null;
}

export async function authEnabled(): Promise<boolean> {
  return legacyHashes().size > 0 || (await dbHasKeys());
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
}

/** Trả Response lỗi nếu bị chặn, hoặc null nếu cho qua. */
export async function gate(req: Request): Promise<Response | null> {
  let subject = `ip:${clientIp(req)}`;
  let keyId: string | null = null;
  let limit = Math.max(1, Number(process.env.RATE_LIMIT_PER_MIN ?? 60));
  let quota: number | null = null;

  if (await authEnabled()) {
    const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
    const token = m?.[1]?.trim();
    if (!token) return errorJson(401, "Thiếu Authorization: Bearer <api_key>", "authentication_error", { "www-authenticate": "Bearer" });
    const h = hashKey(token);
    const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, h), eq(apiKeys.active, true))).limit(1);
    if (row) {
      keyId = row.id;
      subject = `key:${row.id}`;
      limit = row.rateLimitPerMin;
      quota = row.monthlyQuota;
    } else if (legacyHashes().has(h)) {
      subject = `legacy:${h.slice(0, 10)}`;
    } else {
      return errorJson(401, "API key không hợp lệ hoặc đã bị thu hồi", "authentication_error", { "www-authenticate": "Bearer" });
    }
  }

  // --- rate limit (dùng chung giữa các instance) ---
  try {
    const minute = Math.floor(Date.now() / 60_000);
    const [w] = await db
      .insert(rateLimitWindows)
      .values({ subject, windowStart: minute, count: 1 })
      .onConflictDoUpdate({ target: [rateLimitWindows.subject, rateLimitWindows.windowStart], set: { count: sql`${rateLimitWindows.count} + 1` } })
      .returning({ count: rateLimitWindows.count });
    if (w.count > limit) {
      const retry = Math.max(1, 60 - Math.floor((Date.now() % 60_000) / 1000));
      return errorJson(429, `Vượt giới hạn ${limit} request/phút`, "rate_limit_error", { "retry-after": String(retry) });
    }
    if (Math.random() < 0.01) void db.delete(rateLimitWindows).where(sql`${rateLimitWindows.windowStart} < ${minute - 10}`);
  } catch (e) {
    console.error("rate limit store error (fail-open)", e);
  }

  // --- quota tháng + usage ---
  if (keyId) {
    if (quota != null) {
      const [u] = await db
        .select({ s: sql<number>`coalesce(sum(${apiUsage.requests}), 0)` })
        .from(apiUsage)
        .where(and(eq(apiUsage.keyId, keyId), sql`${apiUsage.day} >= date_trunc('month', current_date)`));
      if (Number(u?.s ?? 0) >= quota) return errorJson(429, `Đã dùng hết quota tháng (${quota} request)`, "quota_exceeded", { "retry-after": "3600" });
    }
    try {
      await db
        .insert(apiUsage)
        .values({ keyId, day: sql`current_date` as unknown as string, requests: 1 })
        .onConflictDoUpdate({ target: [apiUsage.keyId, apiUsage.day], set: { requests: sql`${apiUsage.requests} + 1` } });
      void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
    } catch (e) {
      console.error("usage write error", e);
    }
  }
  ctxByRequest.set(req, { keyId, subject });
  return null;
}

/** Ghi usage token của một request đã qua gate(). Chỉ cộng token khi là usage THẬT của provider. */
export async function recordUsage(req: Request, u: { prompt_tokens: number; completion_tokens: number; estimated: boolean }) {
  const ctx = ctxByRequest.get(req);
  if (!ctx?.keyId) return;
  try {
    await db
      .update(apiUsage)
      .set(
        u.estimated
          ? { estimatedRequests: sql`${apiUsage.estimatedRequests} + 1` }
          : { promptTokens: sql`${apiUsage.promptTokens} + ${u.prompt_tokens}`, completionTokens: sql`${apiUsage.completionTokens} + ${u.completion_tokens}` }
      )
      .where(and(eq(apiUsage.keyId, ctx.keyId), sql`${apiUsage.day} = current_date`));
  } catch (e) {
    console.error("token usage write error", e);
  }
}

// --- quản trị key ---------------------------------------------------------------------------------
export function isAdmin(req: Request): boolean {
  const admin = process.env.VIETSCOPE_ADMIN_KEY?.trim();
  if (!admin) return false;
  const token = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const a = Buffer.from(hashKey(token));
  const b = Buffer.from(hashKey(admin));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createApiKey(input: { name: string; rateLimitPerMin?: number; monthlyQuota?: number | null; scopes?: string[] }) {
  const key = `vs_live_${randomBytes(24).toString("hex")}`;
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: input.name.slice(0, 80),
      prefix: key.slice(0, 12),
      keyHash: hashKey(key),
      scopes: input.scopes?.length ? input.scopes : ["*"],
      rateLimitPerMin: Math.max(1, input.rateLimitPerMin ?? 60),
      monthlyQuota: input.monthlyQuota ?? null,
    })
    .returning();
  invalidateAuthCache();
  return { key, row }; // plaintext chỉ trả MỘT lần
}
