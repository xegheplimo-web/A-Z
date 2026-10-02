// ---------------------------------------------------------------------------
// Kiểm thử vòng đời API key + rate limit + quota + usage + MCP session stateless
//   npx tsx scripts/test-auth.ts
// Chạy trên DB dev → LUÔN dọn sạch key/usage/window (nếu để lại key active, auth của app sẽ bật).
// ---------------------------------------------------------------------------
import "dotenv/config";
import { eq, inArray, like } from "drizzle-orm";

let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failed++;
};
const req = (auth?: string, path = "/v1/search") => new Request(`http://x${path}`, { headers: auth ? { authorization: `Bearer ${auth}`, "x-forwarded-for": "9.9.9.9" } : { "x-forwarded-for": "9.9.9.9" } });

async function main() {
  delete process.env.VIETSCOPE_API_KEYS;
  process.env.VIETSCOPE_ADMIN_KEY = "admin-test-secret";
  process.env.RATE_LIMIT_PER_MIN = "1000";
  const { db } = await import("../src/db");
  const { apiKeys, apiUsage, rateLimitWindows } = await import("../src/db/schema");
  const auth = await import("../src/lib/auth");
  const created: string[] = [];

  try {
    // trạng thái ban đầu: không key → demo mở
    await db.update(apiKeys).set({ active: false }).where(eq(apiKeys.active, true)); // đảm bảo sạch (không đụng key thật nếu có: đã tắt tạm)
    auth.invalidateAuthCache();
    ok("0  không có key active → auth tắt (demo mở)", (await auth.gate(req())) === null);

    // --- tạo key: chỉ lưu hash ---
    const k1 = await auth.createApiKey({ name: "test-rate", rateLimitPerMin: 3 });
    created.push(k1.row.id);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, k1.row.id));
    ok("1  key plaintext KHÔNG nằm trong DB; chỉ có SHA-256", row.keyHash === auth.hashKey(k1.key) && !JSON.stringify(row).includes(k1.key), `prefix=${row.prefix} hash=${row.keyHash.slice(0, 12)}…`);
    ok("1b key có dạng vs_live_<48 hex>", /^vs_live_[0-9a-f]{48}$/.test(k1.key));

    // --- bật auth khi có key ---
    ok("2  có key active → thiếu Authorization bị 401", (await auth.gate(req()))?.status === 401);
    ok("2b key sai → 401", (await auth.gate(req("vs_live_wrong")))?.status === 401);
    ok("2c key đúng → cho qua", (await auth.gate(req(k1.key))) === null);

    // --- rate limit dùng chung (Postgres) ---
    await auth.gate(req(k1.key)); // lần 2 (đã dùng 1 ở 2c)
    await auth.gate(req(k1.key)); // lần 3
    const over = await auth.gate(req(k1.key)); // lần 4 > limit 3
    ok("3  rate limit theo key: lần thứ 4 trong phút bị 429 + Retry-After", over?.status === 429 && !!over.headers.get("retry-after"), `retry-after=${over?.headers.get("retry-after")}`);
    const wins = await db.select().from(rateLimitWindows).where(eq(rateLimitWindows.subject, `key:${k1.row.id}`));
    ok("3b bộ đếm nằm ở Postgres (dùng chung mọi instance), không phải RAM", wins.length >= 1 && wins[0].count >= 4, `count=${wins[0]?.count}`);

    // --- quota tháng ---
    const k2 = await auth.createApiKey({ name: "test-quota", rateLimitPerMin: 100, monthlyQuota: 2 });
    created.push(k2.row.id);
    const q1 = await auth.gate(req(k2.key));
    const q2 = await auth.gate(req(k2.key));
    const q3 = await auth.gate(req(k2.key));
    ok("4  quota tháng: 2 request đầu qua, request thứ 3 bị 429 quota_exceeded", q1 === null && q2 === null && q3?.status === 429 && (await q3.json()).error.type === "quota_exceeded");

    // --- usage: chỉ cộng token THẬT ---
    const k3 = await auth.createApiKey({ name: "test-usage", rateLimitPerMin: 100 });
    created.push(k3.row.id);
    const r3 = req(k3.key);
    await auth.gate(r3);
    await auth.recordUsage(r3, { prompt_tokens: 500, completion_tokens: 80, estimated: false });
    const r3b = req(k3.key);
    await auth.gate(r3b);
    await auth.recordUsage(r3b, { prompt_tokens: 9999, completion_tokens: 9999, estimated: true });
    const [u] = await db.select().from(apiUsage).where(eq(apiUsage.keyId, k3.row.id));
    ok("5  usage thật: token cộng đúng (500 + 80)", u.promptTokens === 500 && u.completionTokens === 80, `prompt=${u.promptTokens} completion=${u.completionTokens}`);
    ok("5b usage ước lượng KHÔNG cộng token, chỉ đếm estimated_requests (không dùng để tính tiền)", u.estimatedRequests === 1 && u.requests === 2);

    // --- thu hồi ---
    await db.update(apiKeys).set({ active: false }).where(eq(apiKeys.id, k3.row.id));
    auth.invalidateAuthCache();
    ok("6  key bị thu hồi → 401", (await auth.gate(req(k3.key)))?.status === 401);

    // --- route admin ---
    const adminRoute = await import("../src/app/v1/admin/keys/route");
    const noAdmin = await adminRoute.POST(new Request("http://x/v1/admin/keys", { method: "POST", body: JSON.stringify({ name: "x" }), headers: { authorization: "Bearer nope" } }));
    ok("7  /v1/admin/keys không có ADMIN key → 401", noAdmin.status === 401);
    const mk = await adminRoute.POST(new Request("http://x/v1/admin/keys", { method: "POST", body: JSON.stringify({ name: "via-admin", rate_limit_per_min: 7, monthly_quota: 100 }), headers: { authorization: "Bearer admin-test-secret", "content-type": "application/json" } }));
    const mkBody = (await mk.json()) as { id: string; key: string; rate_limit_per_min: number };
    created.push(mkBody.id);
    ok("7b admin tạo key → 201, trả plaintext đúng MỘT lần", mk.status === 201 && /^vs_live_/.test(mkBody.key) && mkBody.rate_limit_per_min === 7);
    const ls = await adminRoute.GET(new Request("http://x/v1/admin/keys", { headers: { authorization: "Bearer admin-test-secret" } }));
    const lsText = await ls.text();
    ok("7c danh sách key KHÔNG chứa plaintext", ls.status === 200 && !lsText.includes(mkBody.key) && lsText.includes("via-admin"));
    const rv = await adminRoute.DELETE(new Request(`http://x/v1/admin/keys?id=${mkBody.id}`, { method: "DELETE", headers: { authorization: "Bearer admin-test-secret" } }));
    ok("7d admin thu hồi key → 200, dùng lại bị 401", rv.status === 200 && (await auth.gate(req(mkBody.key)))?.status === 401);

    // --- MCP session stateless ---
    const mcp = await import("../src/app/mcp/route");
    await db.update(apiKeys).set({ active: false }).where(inArray(apiKeys.id, created));
    auth.invalidateAuthCache(); // tắt auth để test MCP thuần
    const init = await mcp.POST(new Request("http://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) }));
    const sid = init.headers.get("mcp-session-id") ?? "";
    ok("8  MCP initialize cấp session id có chữ ký (nonce.iat.hmac), không lưu RAM", sid.split(".").length === 3, sid.slice(0, 24) + "…");
    const listOk = await mcp.POST(new Request("http://x/mcp", { method: "POST", headers: { "mcp-session-id": sid }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) }));
    ok("8b session hợp lệ → tools/list OK (instance nào cũng xác thực được)", listOk.status === 200 && (await listOk.json()).result.tools[0].name === "vietscope_retrieve");
    const tampered = sid.slice(0, -3) + (sid.endsWith("aaa") ? "bbb" : "aaa");
    const listBad = await mcp.POST(new Request("http://x/mcp", { method: "POST", headers: { "mcp-session-id": tampered }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }) }));
    ok("8c session bị sửa chữ ký → 400", listBad.status === 400);
    const none = await mcp.POST(new Request("http://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }) }));
    ok("8d không có session → 400", none.status === 400);
  } finally {
    if (created.length) {
      await db.delete(apiUsage).where(inArray(apiUsage.keyId, created));
      await db.delete(apiKeys).where(inArray(apiKeys.id, created));
      for (const id of created) await db.delete(rateLimitWindows).where(like(rateLimitWindows.subject, `%${id}%`));
    }
    await db.delete(rateLimitWindows).where(like(rateLimitWindows.subject, "ip:9.9.9.9"));
    auth.invalidateAuthCache();
  }
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : "\nTẤT CẢ KIỂM TRA AUTH ĐẠT");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
