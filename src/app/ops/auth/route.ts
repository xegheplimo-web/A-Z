// ---------------------------------------------------------------------------
// /ops/auth — unlock ops surfaces cho browser.
//
//   GET  → form nhập admin key
//   POST → verify VIETSCOPE_ADMIN_KEY (timing-safe) → set cookie vs_ops
//          (HttpOnly, Secure, SameSite=Lax, 12h) → redirect /ops/quality
//
//   Rate-limit theo IP qua gate(skipAuth) — chống brute-force key.
//   Cookie chỉ chứa HMAC session, không lưu admin key.
// ---------------------------------------------------------------------------
import { gate } from "@/lib/auth";
import { guard } from "@/lib/http";
import { mintOpsSession, opsAdminKeyOk, OPS_COOKIE, OPS_SESSION_TTL_S } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORM = (err = "") => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>VietScope Ops</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px/1.5 system-ui;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px;width:300px}
input{width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:10px;margin:10px 0}
button{width:100%;background:#d4a437;border:0;border-radius:8px;padding:10px;font-weight:600;cursor:pointer}
.e{color:#f85149;font-size:12px}</style></head>
<body><form method="post" action="/ops/auth"><b>VietScope Ops</b>${err ? `<p class="e">${err}</p>` : ""}
<input name="key" type="password" placeholder="Admin key" autocomplete="off" autofocus required>
<button>Unlock</button></form></body></html>`;

export const GET = guard(async () => new Response(FORM(), { headers: { "content-type": "text/html; charset=utf-8" } }));

export const POST = guard(async (req: Request) => {
  const blocked = await gate(req, { skipAuth: true });
  if (blocked) return blocked;
  const key = String((await req.formData()).get("key") ?? "");
  if (!opsAdminKeyOk(key)) {
    return new Response(FORM("Key không đúng"), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const token = mintOpsSession();
  const res = new Response(null, { status: 303, headers: { location: "/ops/quality" } });
  if (token) {
    // Secure chỉ khi request qua https — http local ops vẫn dùng được
    const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
    res.headers.append("set-cookie", `${OPS_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${OPS_SESSION_TTL_S}`);
  }
  return res;
});
