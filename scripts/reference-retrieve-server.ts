// ---------------------------------------------------------------------------
// Server THAM CHIẾU cho Retrieval Contract v1 — "đặc tả chạy được" cho search-router.
//
//   npx tsx scripts/reference-retrieve-server.ts [port]
//
//   POST /v1/retrieve        wire format snake_case (src/core/wire.ts) — dùng engine embedded
//   GET  /v1/health
//   GET  /v1/capabilities    { features: ["retrieve", ...] }
//
// Mục đích: (1) kiểm thử adapter và facade qua HTTP thật, khác tiến trình; (2) là chuẩn để team
// search-router (Python) port: cùng request, cùng response, cùng conformance test.
// KHÔNG dùng làm production.
// ---------------------------------------------------------------------------
import "dotenv/config";
import http from "node:http";
import { embeddedBackend } from "../src/engine/embedded";
import { requestFromWire, toWire } from "../src/core/wire";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8097);
const KEY = process.env.REFERENCE_KEY?.trim() || null;

const server = http.createServer(async (req, res) => {
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? "/", "http://x");
  if (KEY && url.pathname.startsWith("/v1/") && req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: "unauthorized" });
  if (url.pathname === "/v1/health") return json(200, { status: "ok", backend: "reference-embedded" });
  if (url.pathname === "/v1/capabilities") return json(200, { features: ["retrieve"], modes: ["auto", "fast", "standard", "research"], providers: [] });
  if (url.pathname === "/v1/retrieve" && req.method === "POST") {
    let raw = "";
    for await (const c of req) raw += c;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(400, { error: "invalid json" });
    }
    const r = requestFromWire(body);
    if (!r.query.trim()) return json(422, { error: "query is required" });
    try {
      const out = await embeddedBackend.retrieve(r);
      return json(200, toWire({ ...out, backend: "search-router" }));
    } catch (e) {
      return json(500, { error: e instanceof Error ? e.message : "error" });
    }
  }
  json(404, { error: "not found" });
});

server.listen(PORT, () => console.log(`reference retrieve server :${PORT}`));
