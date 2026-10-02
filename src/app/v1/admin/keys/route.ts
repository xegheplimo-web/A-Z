import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, apiUsage } from "@/db/schema";
import { createApiKey, invalidateAuthCache, isAdmin } from "@/lib/auth";
import { badRequest, guard, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const denied = () => Response.json({ error: { message: "Cần VIETSCOPE_ADMIN_KEY hợp lệ (Authorization: Bearer …)", type: "authentication_error", code: 401 } }, { status: 401 });

/** POST /v1/admin/keys {name, rate_limit_per_min?, monthly_quota?, scopes?} → key plaintext trả MỘT lần duy nhất */
export const POST = guard(async (req: Request) => {
  if (!isAdmin(req)) return denied();
  const b = await readJson(req);
  const name = String(b.name ?? "").trim();
  if (!name) return badRequest("name is required");
  const { key, row } = await createApiKey({
    name,
    rateLimitPerMin: typeof b.rate_limit_per_min === "number" ? b.rate_limit_per_min : undefined,
    monthlyQuota: typeof b.monthly_quota === "number" ? b.monthly_quota : null,
    scopes: Array.isArray(b.scopes) ? (b.scopes as unknown[]).map(String) : undefined,
  });
  return Response.json({ id: row.id, name: row.name, key, prefix: row.prefix, rate_limit_per_min: row.rateLimitPerMin, monthly_quota: row.monthlyQuota, note: "Lưu key ngay — VietScope chỉ giữ SHA-256, không thể xem lại." }, { status: 201 });
});

/** GET /v1/admin/keys — danh sách key + usage tháng này (token là usage THẬT; ước lượng chỉ đếm request) */
export const GET = guard(async (req: Request) => {
  if (!isAdmin(req)) return denied();
  const keys = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  const usage = await db
    .select({
      keyId: apiUsage.keyId,
      requests: sql<number>`sum(${apiUsage.requests})`,
      prompt: sql<number>`sum(${apiUsage.promptTokens})`,
      completion: sql<number>`sum(${apiUsage.completionTokens})`,
      estimated: sql<number>`sum(${apiUsage.estimatedRequests})`,
    })
    .from(apiUsage)
    .where(sql`${apiUsage.day} >= date_trunc('month', current_date)`)
    .groupBy(apiUsage.keyId);
  const byKey = new Map(usage.map((u) => [u.keyId, u]));
  return Response.json({
    keys: keys.map((k) => {
      const u = byKey.get(k.id);
      return { id: k.id, name: k.name, prefix: k.prefix, active: k.active, rate_limit_per_min: k.rateLimitPerMin, monthly_quota: k.monthlyQuota, scopes: k.scopes, created_at: k.createdAt, last_used_at: k.lastUsedAt, month: { requests: Number(u?.requests ?? 0), prompt_tokens: Number(u?.prompt ?? 0), completion_tokens: Number(u?.completion ?? 0), requests_with_estimated_usage: Number(u?.estimated ?? 0) } };
    }),
  });
});

/** DELETE /v1/admin/keys?id=<uuid> — thu hồi */
export const DELETE = guard(async (req: Request) => {
  if (!isAdmin(req)) return denied();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return badRequest("id is required");
  const r = await db.update(apiKeys).set({ active: false, revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.active, true))).returning({ id: apiKeys.id });
  invalidateAuthCache();
  return r.length ? Response.json({ ok: true, revoked: id }) : Response.json({ error: { message: "key không tồn tại hoặc đã thu hồi", type: "not_found" } }, { status: 404 });
});
