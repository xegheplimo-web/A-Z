// ---------------------------------------------------------------------------
// Conformance + parity: CÙNG một benchmark qua HAI backend phải cho CÙNG chất lượng.
//   npx tsx scripts/conformance.ts
//
//  A. Contract: fromWire từ chối payload sai (version, intent, thiếu trường, sai kiểu)
//  B. Một brain: RETRIEVAL_BACKEND=search-router (server tham chiếu, TIẾN TRÌNH KHÁC) → engine embedded KHÔNG được nạp
//  C. Parity: metrics VN_GOLDEN qua search-router ≡ qua embedded (serialization không làm mất thông tin)
//  D. Lỗi adapter: 404/401/500/JSON hỏng/timeout/contract sai → 503 rõ ràng; fallback chỉ khi bật tường minh
// ---------------------------------------------------------------------------
import "dotenv/config";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";

let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url: string, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* chưa lên */
    }
    await sleep(250);
  }
  return false;
}

async function main() {
  delete process.env.LLM_BASE_URL;
  delete process.env.SEARCH_HUB_URL;
  const REF_PORT = 8097;
  const BAD_PORT = 8096;

  // ---- A. contract validation (thuần, không cần server) ----
  const { fromWire, toWire, ContractError } = await import("../src/core/wire");
  const good = (await (async () => {
    // lấy một payload hợp lệ từ server tham chiếu bên dưới; tạm dựng bằng tay tối thiểu
    return {
      contract_version: "1",
      understanding: { raw: "q", normalized: "q", tokens: ["q"], intent: "general", intent_label: "x", specialty: null, categories: [], freshness: "any", locations: [], resolved_current_ids: [], transition: null, compare_targets: null, fuzzy: { used: false, notes: [] } },
      budget: { name: "fast", reason: "r", target_ms: "1-4s", multi_hop: false, read_evidence: false },
      places: { exact: [], unverified: [], related: [], candidates: [] },
      docs: [], coverage: { gap: false, reason: null, widened: false }, anchor: null, scope: { provinces: [], communes: [] },
      quality: { confidence: 0.5, coverage: "partial", independent_sources: 0, avg_authority: 0 }, federation: [], widening: [], timings: { total_ms: 1 },
    };
  })()) as Record<string, any>;
  let parsed = true;
  try { fromWire(good); } catch { parsed = false; }
  ok("A1 payload tối thiểu hợp lệ được chấp nhận", parsed);
  const bad = (mut: (j: Record<string, any>) => void) => { const j = JSON.parse(JSON.stringify(good)); mut(j); try { fromWire(j); return null; } catch (e) { return e instanceof ContractError ? e.problems.join("|") : String(e); } };
  ok("A2 sai contract_version bị từ chối", !!bad((j) => (j.contract_version = "2")));
  ok("A3 intent lạ bị từ chối", !!bad((j) => (j.understanding.intent = "weird")));
  ok("A4 thiếu budget bị từ chối", !!bad((j) => delete j.budget));
  ok("A5 sai kiểu quality.confidence bị từ chối", !!bad((j) => (j.quality.confidence = "0.9")));
  ok("A6 place thiếu province_id bị từ chối", !!bad((j) => j.places.exact.push({ id: "1", name: "x", category: "c", category_label: "c", address: "a", source: "osm", verified: true })));
  void toWire;

  // ---- B/C. một brain + parity ----
  const ref: ChildProcess = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/reference-retrieve-server.ts", String(REF_PORT)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
  try {
    ok("B0 server tham chiếu (tiến trình riêng) lên", await waitFor(`http://127.0.0.1:${REF_PORT}/v1/health`));

    process.env.RETRIEVAL_BACKEND = "search-router";
    process.env.SEARCH_ROUTER_URL = `http://127.0.0.1:${REF_PORT}`;
    const { runEval } = await import("../src/lib/eval");
    const { runPipeline } = await import("../src/lib/pipeline");
    const viaRouter = await runEval({ persist: false });
    const loaded = (globalThis as Record<string, unknown>).__vietscope_embedded_loaded === true;
    ok("B1 search-router: engine embedded KHÔNG được nạp (một retrieval brain)", !loaded, loaded ? "embedded đã bị nạp!" : "chưa nạp");
    ok("B2 backend ghi nhận = search-router", (viaRouter.metrics.backend as string) === "search-router", String(viaRouter.metrics.backend));
    const one = await runPipeline("quán giò chả ngon ở Yên Dũng", { log: false });
    ok("B3 timings có network_ms (adapter đo độ trễ mạng)", typeof one.timings.network_ms === "number", `network_ms=${one.timings.network_ms} backend_ms=${one.timings.backend_ms}`);

    process.env.RETRIEVAL_BACKEND = "embedded";
    const viaEmbedded = await runEval({ persist: false });
    ok("C0 embedded: backend ghi nhận = embedded", (viaEmbedded.metrics.backend as string) === "embedded");
    const skip = new Set(["p50_ms", "p95_ms", "backend", "failures"]);
    const diffs: string[] = [];
    for (const k of Object.keys(viaEmbedded.metrics)) {
      if (skip.has(k)) continue;
      if (viaEmbedded.metrics[k] !== viaRouter.metrics[k]) diffs.push(`${k}: embedded=${viaEmbedded.metrics[k]} router=${viaRouter.metrics[k]}`);
    }
    ok("C1 PARITY: mọi metric chất lượng giống hệt giữa hai backend", diffs.length === 0, diffs.join("; ") || `${Object.keys(viaEmbedded.metrics).length - skip.size} metric trùng khớp`);
    const fa = (viaEmbedded.metrics.failures as { id: string }[]).map((f) => f.id).join(",");
    const fb = (viaRouter.metrics.failures as { id: string }[]).map((f) => f.id).join(",");
    ok("C2 PARITY: tập case lỗi giống nhau", fa === fb, `embedded=[${fa}] router=[${fb}]`);
  } finally {
    ref.kill();
  }

  // ---- D. lỗi adapter ----
  const { BackendUnavailableError } = await import("../src/core/backend");
  const { guard } = await import("../src/lib/http");
  const { runPipeline, retrieveOnly } = await import("../src/lib/pipeline");
  let mode = "404";
  const bad2 = http.createServer(async (req, res) => {
    for await (const _ of req) void _;
    const send = (c: number, b: string, h: Record<string, string> = {}) => { res.writeHead(c, { "content-type": "application/json", ...h }); res.end(b); };
    if (mode === "404") return send(404, "{}");
    if (mode === "401") return send(401, "{}");
    if (mode === "500") return send(500, "{}");
    if (mode === "garbage") return send(200, "<<html>>");
    if (mode === "badcontract") return send(200, JSON.stringify({ contract_version: "1", understanding: { intent: "nope" } }));
    if (mode === "timeout") return; // treo
  });
  await new Promise<void>((r) => bad2.listen(BAD_PORT, r));
  process.env.RETRIEVAL_BACKEND = "search-router";
  process.env.SEARCH_ROUTER_URL = `http://127.0.0.1:${BAD_PORT}`;
  process.env.SEARCH_ROUTER_TIMEOUT_MS = "1200";
  delete process.env.RETRIEVAL_FALLBACK;
  const expectUnavailable = async (label: string, re: RegExp) => {
    try {
      await runPipeline("giò chả yên dũng", { log: false });
      ok(label, false, "không ném lỗi");
    } catch (e) {
      ok(label, e instanceof BackendUnavailableError && re.test(e.message), e instanceof Error ? e.message.slice(0, 110) : String(e));
    }
  };
  mode = "404"; await expectUnavailable("D1 404 → báo deployment drift /v1/retrieve + trỏ tới tài liệu port", /chưa hỗ trợ POST \/v1\/retrieve.*PORTING/);
  mode = "401"; await expectUnavailable("D2 401 → báo từ chối API key", /từ chối API key/);
  mode = "500"; await expectUnavailable("D3 500 → backend_unavailable", /lỗi HTTP 500/);
  mode = "garbage"; await expectUnavailable("D4 JSON hỏng → backend_unavailable", /không phải JSON/);
  mode = "badcontract"; await expectUnavailable("D5 sai contract → liệt kê trường sai", /không đúng contract/);
  mode = "timeout";
  const t0 = Date.now();
  await expectUnavailable("D6 timeout → backend_unavailable", /quá 1200ms/);
  ok("D6b timeout đúng giới hạn (không treo)", Date.now() - t0 < 3500, `${Date.now() - t0}ms`);

  // route guard → 503 JSON có cấu trúc (không 500 trống)
  mode = "500";
  const handler = guard(async () => { await retrieveOnly("x", { log: false }); return new Response("ok"); });
  const resp = await handler();
  const body = (await resp.json()) as { error: { type: string } };
  ok("D7 route guard → HTTP 503 + error.type=backend_unavailable", resp.status === 503 && body.error.type === "backend_unavailable", `${resp.status} ${body.error.type}`);

  // fallback CHỈ khi bật tường minh
  process.env.RETRIEVAL_FALLBACK = "embedded";
  const fb = await runPipeline("quán giò chả ngon ở Yên Dũng", { log: false });
  ok("D8 RETRIEVAL_FALLBACK=embedded → vẫn trả lời, ghi cảnh báo rõ", fb.backend === "embedded" && fb.widening.some((w) => w.includes("tạm dùng engine embedded")) && fb.federation.some((f) => f.status === "error" && f.detail?.includes("fallback")), fb.widening[0]);
  delete process.env.RETRIEVAL_FALLBACK;
  bad2.close();

  // thiếu SEARCH_ROUTER_URL
  delete process.env.SEARCH_ROUTER_URL;
  await expectUnavailable("D9 thiếu SEARCH_ROUTER_URL → báo rõ", /chưa đặt SEARCH_ROUTER_URL/);

  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : "\nTẤT CẢ CONFORMANCE ĐẠT");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
