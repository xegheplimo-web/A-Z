// ---------------------------------------------------------------------------
// Mock upstream cho kiểm thử tích hợp (không cần GPU/API key):
//   • LLM OpenAI-compatible : POST /llm/v1/chat/completions (stream & non-stream), GET /llm/v1/models
//   • Search Hub (search-router): POST /hub/v1/search, GET /hub/v1/health
// Chế độ lỗi điều khiển qua header x-mock-mode hoặc biến MOCK_LLM_MODE:
//   ok | fail500 | timeout | garbage
// Chạy:  node scripts/mock-upstreams.mjs [port]
// ---------------------------------------------------------------------------
import http from "node:http";

const PORT = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 8099);
let llmMode = process.env.MOCK_LLM_MODE ?? "ok";
export const state = { llmCalls: 0, hubCalls: 0, lastLLMBody: null, lastHubBody: null };

function readJson(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(b || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

/** Trả lời "giống LLM": trích câu đầu của 2 nguồn đầu + marker [n], thêm 1 câu bịa KHÔNG có trong evidence để test verifier */
function synthesize(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const ev = [...user.matchAll(/^\[(\d+)\] \([^)]*\) (.+)$/gm)].map((m) => ({ n: Number(m[1]), title: m[2] }));
  const q = (user.match(/CÂU HỎI: (.+)/) ?? [])[1] ?? "";
  if (/subqueries|lập kế hoạch/i.test(messages[0]?.content ?? "")) {
    return JSON.stringify({ subqueries: [`${q.slice(0, 30)} số liệu 2025`, `${q.slice(0, 30)} chính sách`, `${q.slice(0, 30)} doanh nghiệp`] });
  }
  if (!ev.length) return "Chưa có bằng chứng đủ để trả lời câu hỏi này.";
  const lines = ev.slice(0, 2).map((e) => `Theo nguồn ${e.n}, ${e.title.replace(/[.。]$/, "")} [${e.n}].`);
  lines.push(`Ngoài ra, giá thuê mặt bằng tại khu vực này là 99 triệu đồng mỗi tháng theo khảo sát riêng [${ev[0].n}].`); // claim bịa → verifier phải gắn cờ
  return `# Trả lời\n\n${lines.join("\n\n")}\n\nLưu ý: số liệu có thể thay đổi, hãy kiểm tra nguồn gốc.`;
}

const HUB_RESULTS = (q) => [
  {
    source_id: "hub-1",
    title: `Giò chả Vân Diên Nội Hoàng — cơ sở lâu đời tại xã Yên Dũng (${q.slice(0, 20)})`,
    url: "https://bacninh.gov.vn/du-lich/am-thuc/gio-cha-van-dien-noi-hoang",
    domain: "bacninh.gov.vn",
    description: `Cơ sở giò chả Vân Diên (kết quả cho truy vấn: ${q}) tại thôn Nội Hoàng, mở cửa 5h–19h, chuyên giò lụa giã tay.`,
    content: "Cơ sở giò chả Vân Diên tại thôn Nội Hoàng, xã Yên Dũng, tỉnh Bắc Ninh. Mở cửa 5h–19h hằng ngày. Sản phẩm giò lụa giã tay, chả quế. Điện thoại 0912 345 678.",
    score: 0.91,
    authority_score: 0.95,
    authority_type: "government",
    source_lane: "gov",
    published_at: "2025-09-01T00:00:00Z",
    fingerprint: "fp-van-dien",
  },
  {
    source_id: "hub-2",
    title: "Giò chả Nội Hoàng đạt sản phẩm OCOP 4 sao cấp tỉnh",
    url: "https://nongnghiep.vn/gio-cha-noi-hoang-ocop-4-sao.html?utm_source=zalo",
    domain: "nongnghiep.vn",
    description: "Trùng URL với corpus (khác utm) → phải bị dedup khi RRF.",
    content: "Làng nghề giò chả Nội Hoàng có 3 cơ sở đạt OCOP 4 sao.",
    score: 0.8,
    authority_score: 0.8,
    source_lane: "news",
    published_at: "2025-01-10T00:00:00Z",
    fingerprint: "fp-ocop",
  },
  {
    source_id: "hub-3",
    title: "Top 5 quán giò chả ngon quanh Bắc Ninh – Bắc Giang cũ",
    url: "https://foody.vn/bac-ninh/top-gio-cha",
    domain: "foody.vn",
    description: "Danh sách tổng hợp từ người dùng.",
    content: "Danh sách quán giò chả: Tư Nhuận, Bích Hạnh, Vân Diên, Đức Hường, Mến Diên.",
    score: 0.6,
    authority_score: 0.45,
    source_lane: "web",
    fingerprint: "fp-foody",
  },
];

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const mode = req.headers["x-mock-mode"] ?? llmMode;
    const json = (code, body, headers = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };

    // ---- admin: đổi chế độ lỗi
    if (url.pathname === "/mock/mode" && req.method === "POST") {
      const b = await readJson(req);
      llmMode = b.mode ?? "ok";
      return json(200, { mode: llmMode });
    }
    if (url.pathname === "/mock/state") return json(200, { ...state, llmMode });

    // ---- LLM
    if (url.pathname === "/llm/v1/models") return json(200, { object: "list", data: [{ id: "qwen3.8-flash-next", object: "model" }] });
    if (url.pathname === "/llm/v1/chat/completions" && req.method === "POST") {
      state.llmCalls++;
      const body = await readJson(req);
      state.lastLLMBody = body;
      if (mode === "fail500") return json(500, { error: { message: "mock upstream failure" } });
      if (mode === "timeout") return; // treo kết nối → client timeout
      if (mode === "garbage") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("<<not json>>");
      }
      const text = synthesize(body.messages ?? []);
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (let i = 0; i < text.length; i += 16) {
          res.write(`data: ${JSON.stringify({ id: "m", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { content: text.slice(i, i + 16) } }] })}\n\n`);
          await new Promise((r) => setTimeout(r, 2));
        }
        res.write(`data: ${JSON.stringify({ id: "m", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        if (body.stream_options?.include_usage) {
          res.write(`data: ${JSON.stringify({ id: "m", object: "chat.completion.chunk", model: body.model, choices: [], usage: { prompt_tokens: 500, completion_tokens: 80, total_tokens: 580 } })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      return json(200, {
        id: "chatcmpl-mock",
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 500, completion_tokens: 80, total_tokens: 580 },
      });
    }

    // ---- Search Hub
    if (url.pathname === "/hub/v1/health") return json(200, { status: "ok" });
    if (url.pathname === "/hub/v1/search" && req.method === "POST") {
      state.hubCalls++;
      const body = await readJson(req);
      state.lastHubBody = body;
      if (!/gio cha|giò chả/i.test(body.query ?? "")) return json(200, { query: body.query, results: [], elapsed_seconds: 0.01 });
      return json(200, { query: body.query, type: "web", results: HUB_RESULTS(body.query ?? ""), elapsed_seconds: 0.12 });
    }
    json(404, { error: "not found" });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, () => console.log(`mock upstreams on :${PORT}  (LLM /llm/v1 · Hub /hub/v1 · mode=${llmMode})`));
}
