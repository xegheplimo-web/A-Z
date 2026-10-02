// ---------------------------------------------------------------------------
// Kiểm thử tích hợp: pipeline vietscope-1 với LLM + Search Hub (mock)
//   npx tsx scripts/smoke-upstreams.ts
// Kiểm tra: synthesizer=llm, citation [n] parse, verifier gắn cờ claim bịa,
// retry/timeout/breaker → fallback extractive, hub widening + RRF dedup + flywheel staging,
// planner LLM cho RESEARCH, streaming SSE của gateway.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { createServer } from "./mock-upstreams.mjs";

const PORT = 8099;
process.env.LLM_BASE_URL = `http://127.0.0.1:${PORT}/llm/v1`;
process.env.LLM_MODEL = "qwen3.8-flash-next";
process.env.LLM_TIMEOUT_MS = "1500";
process.env.LLM_MAX_RETRIES = "1";
process.env.SEARCH_HUB_URL = `http://127.0.0.1:${PORT}/hub`;

let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failed++;
}
async function setMode(mode: string) {
  await fetch(`http://127.0.0.1:${PORT}/mock/mode`, { method: "POST", body: JSON.stringify({ mode }) });
}
async function mockState() {
  return (await fetch(`http://127.0.0.1:${PORT}/mock/state`)).json() as Promise<{ llmCalls: number; hubCalls: number; lastHubBody: { query: string; mode: string } | null }>;
}

async function main() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(PORT, r));
  const { runPipeline } = await import("../src/lib/pipeline");
  const { usageFor } = await import("../src/lib/model");
  const { inferenceHealth, streamComplete } = await import("../src/lib/inference");
  const { db } = await import("../src/db");
  const { placeCandidates } = await import("../src/db/schema");
  const { like } = await import("drizzle-orm");

  try {
    // 0) health probe
    const h = await inferenceHealth();
    check("health probe LLM", h.ok === true && h.served_models.includes("qwen3.8-flash-next"), JSON.stringify({ backend: h.backend, roles: h.roles?.synthesizer }));

    // 1) legal query → LLM synthesis + verifier
    await setMode("ok");
    const legal = await runPipeline("nghị định mới nhất về hóa đơn điện tử", { log: false });
    check("synthesizer = llm", legal.synthesizer === "llm:qwen3.8-flash-next", legal.synthesizer);
    const cited = legal.answer.blocks.filter((b) => (b.citations?.length ?? 0) > 0);
    check("LLM blocks có citation [n] được parse", cited.length >= 2, `${cited.length} block có citation`);
    const flagged = legal.verification.claims.filter((c) => !c.supported);
    check("verifier gắn cờ claim bịa (99 triệu/tháng)", flagged.some((c) => /99 triệu/.test(c.text)), flagged.map((c) => c.text.slice(0, 50)).join(" | "));
    check("claim thật được xác minh qua passage", legal.verification.claims.some((c) => c.supported && c.via === "passage"), `verified_ratio=${legal.verification.verifiedRatio}`);
    check("usage THẬT từ provider (non-stream) được giữ nguyên, không ước lượng", legal.llm_usage?.total_tokens === 580 && usageFor(legal, legal.query, "x").estimated === false, JSON.stringify(legal.llm_usage));
    check("federation ghi inference-engine ok", legal.federation.some((f) => f.provider === "inference-engine" && f.status === "ok"));
    check("search-hub được gọi song song cho lane không-local", legal.federation.some((f) => f.provider === "search-hub" && (f.status === "ok" || f.status === "empty")));

    // 2) local: canonical đủ → KHÔNG fan-out hub
    const before = (await mockState()).hubCalls;
    const local = await runPipeline("quán giò chả ngon ở Yên Dũng", { log: false });
    const after = (await mockState()).hubCalls;
    check("local đủ canonical → không gọi hub (không fan-out)", after === before && local.federation.some((f) => f.provider === "search-hub" && f.status === "skipped"));

    // 3) local thiếu canonical → widening sang hub → RRF dedup → flywheel staging
    await db.delete(placeCandidates).where(like(placeCandidates.sourceUrl, "%bacninh.gov.vn/du-lich%"));
    const thin = await runPipeline("giò chả ở Hải Dương", { log: false }); // Hải Dương đã sáp nhập vào Hải Phòng; chưa có giò chả canonical ở đó
    const st = await mockState();
    check("widening → gọi hub", st.hubCalls > after && thin.widening.some((w) => w.includes("mở rộng sang web")), thin.widening.join(" / "));
    check("hub nhận query đã thêm địa giới mới (Hải Dương → Hải Phòng)", /Hải Phòng/.test(st.lastHubBody?.query ?? ""), st.lastHubBody?.query);
    const domains = thin.web.map((w) => w.domain);
    check("RRF trộn nguồn hub + corpus", domains.includes("bacninh.gov.vn") && domains.some((d) => d === "nongnghiep.vn"), domains.join(","));
    check("dedup URL (nongnghiep ?utm) chỉ 1 bản", domains.filter((d) => d === "nongnghiep.vn").length === 1);
    const staged = await db.select().from(placeCandidates).where(like(placeCandidates.sourceUrl, "%bacninh.gov.vn/du-lich%"));
    check("flywheel: web → place_candidates (pending, đúng tỉnh hiện hành)", staged.length === 1 && staged[0].status === "pending" && staged[0].provinceId === "t_hai_phong", `${staged[0]?.name} @ ${staged[0]?.provinceId}`);
    // guard địa bàn: nguồn không nhắc tới khu vực → KHÔNG staging
    const foreign = await runPipeline("giò chả ở Cà Mau", { log: false });
    const stagedCM = await db.select().from(placeCandidates).where(like(placeCandidates.provinceId, "t_ca_mau"));
    check("precision guard: nguồn không nhắc Cà Mau → không staging", stagedCM.length === 0 && foreign.coverage.gap, `staged=${stagedCM.length}`);

    // 4) research → planner LLM
    const research = await runPipeline("nghiên cứu xu hướng xe điện tại Việt Nam năm 2026", { log: false });
    check("budget research + planner llm", research.budget.name === "research" && research.widening.some((w) => w.includes("gap analysis (llm:")), research.widening[0]);

    // 5) lỗi upstream → retry rồi fallback extractive
    await setMode("fail500");
    const c0 = (await mockState()).llmCalls;
    const f1 = await runPipeline("thuế khoán hộ kinh doanh 2026", { log: false }); // budget standard → có retry
    const c1 = (await mockState()).llmCalls;
    check("500 (budget standard) → retry 1 lần rồi fallback extractive", f1.synthesizer === "extractive" && c1 - c0 === 2, `calls=${c1 - c0} synth=${f1.synthesizer}`);
    check("fallback vẫn có citation", f1.quality.citedClaims > 0);

    await setMode("timeout");
    const t0 = Date.now();
    const f2 = await runPipeline("thời tiết Bắc Ninh", { log: false });
    const dt = Date.now() - t0;
    check("timeout (budget fast: không retry, timeout ngắn) → fallback < 2.5s", f2.synthesizer === "extractive" && dt < 2500, `${dt}ms`);

    await setMode("garbage");
    const f3 = await runPipeline("tỷ giá usd hôm nay", { log: false });
    check("JSON hỏng → fallback extractive, breaker mở sau 3 lỗi", f3.synthesizer === "extractive" && (await inferenceHealth()).breaker.open === true);

    await setMode("ok");
    const f4 = await runPipeline("giá vàng hôm nay", { log: false });
    check("extractive → usage ước lượng và gắn estimated=true (không dùng để tính tiền)", f4.llm_usage === null && usageFor(f4, f4.query, "câu trả lời").estimated === true);
    check("breaker mở → không gọi LLM, vẫn trả lời", f4.synthesizer === "extractive" && f4.federation.some((f) => f.provider === "inference-engine" && f.status === "error"));

    // 6) streaming THẬT qua facade: token từ LLM → onDelta → verify sau → ext đầy đủ
    const { resetBreaker } = await import("../src/lib/inference");
    const { vietscope } = await import("../src/lib/model");
    resetBreaker();
    await setMode("ok");
    const deltas: string[] = [];
    const sdata = await vietscope.respondStream("nghị định mới nhất về hóa đơn điện tử", { log: false }, (d) => {
      deltas.push(d);
    });
    check("respondStream: nhận token từ LLM theo mảnh", deltas.length >= 5 && sdata.synthesizer.startsWith("llm:"), `${deltas.length} deltas · ${sdata.synthesizer}`);
    check("respondStream: verify chạy SAU stream, gắn cờ claim bịa", sdata.verification.claims.some((c) => !c.supported && /99 triệu/.test(c.text)));
    check("usage THẬT từ provider qua STREAM (stream_options.include_usage)", sdata.llm_usage?.total_tokens === 580 && usageFor(sdata, sdata.query, "x").estimated === false, JSON.stringify(sdata.llm_usage));
    check("respondStream: federation ghi lane stream", sdata.federation.some((f) => f.lane.includes("stream") && f.status === "ok"));
    // SSE chat/completions thật
    const stream = vietscope.streamChatLive([{ role: "user", content: "giá vàng hôm nay vì sao tăng" }], { log: false });
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let raw = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value);
    }
    const events = raw.split("\n\n").filter((l) => l.startsWith("data:") && !l.includes("[DONE]")).map((l) => JSON.parse(l.slice(5)));
    const last = events[events.length - 1];
    check("SSE chat: nhiều chunk + chunk cuối có finish_reason/usage/vietscope", events.length > 5 && last.choices[0].finish_reason === "stop" && last.usage && last.vietscope?.verification, `${events.length} chunks`);
    check("SSE chat: chân trang Nguồn được gửi", /\*\*Nguồn:\*\*/.test(raw));
    // stream khi LLM lỗi → fallback giả-stream extractive, không vỡ SSE
    await setMode("fail500");
    const d2: string[] = [];
    const fb = await vietscope.respondStream("thời tiết Bắc Ninh", { log: false }, (d) => { d2.push(d); });
    check("respondStream: LLM lỗi → fallback extractive vẫn stream", fb.synthesizer === "extractive" && d2.length > 0, `${d2.length} deltas`);
    await setMode("garbage"); await runPipeline("tỷ giá usd hôm nay", { log: false });
    await setMode("timeout"); await runPipeline("tỷ giá usd hôm nay", { log: false });

    // 7) gateway streaming tôn trọng breaker
    let chunks = 0;
    let text = "";
    // reset breaker bằng cách chờ không khả thi (60s) → kiểm tra stream ném lỗi "circuit open"
    try {
      for await (const d of streamComplete("synthesizer", [{ role: "user", content: "x" }])) {
        chunks++;
        text += d;
      }
      check("stream gateway", chunks > 0, `${chunks} chunks`);
    } catch (e) {
      check("stream gateway tôn trọng breaker", /circuit open/.test(String(e)), String(e));
    }
  } finally {
    await db.delete(placeCandidates).where(like(placeCandidates.sourceUrl, "%bacninh.gov.vn/du-lich%"));
    server.close();
  }
  console.log(failed ? `\n${failed} kiểm tra THẤT BẠI` : "\nTẤT CẢ KIỂM TRA ĐẠT");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
