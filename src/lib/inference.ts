// ---------------------------------------------------------------------------
// VietScope · InferenceGateway — client OpenAI-compatible DUY NHẤT của vietscope-1
//
//   vietscope-1 = Retrieval Engine (dữ liệu VietScope, deterministic)
//               + Inference Engine (LLM — thành phần THAY THẾ ĐƯỢC)
//
// Backend chỉ là cấu hình, VietScope API không đổi:
//   A) API ngoài        LLM_BASE_URL=https://<provider>/v1   (vd Qwen3.8-Flash-Next qua API)
//   B) llama.cpp local  LLM_BASE_URL=http://127.0.0.1:8080/v1 (model 20–35B quant trên 24 GB VRAM)
//   C) vLLM máy lớn     LLM_BASE_URL=http://vllm:8000/v1     (Flash-Next + MTP speculative decoding)
//
// Vai trò (role) → model, bám đúng tên biến của repo VietScope (search-router):
//   LLM_MODEL (mặc định) · LLM_PLANNER_MODEL · LLM_SYNTH_MODEL · LLM_VERIFY_MODEL · LLM_EXTRACT_MODEL
// Gateway sở hữu: timeout, retry, circuit breaker, health probe, streaming.
// Chưa cấu hình → synthesizer extractive deterministic; retrieval/ranking/verify không đổi.
// ---------------------------------------------------------------------------
import type { DocDTO, UnderstandingDTO } from "@/core/contract";
import type { AnswerBlock } from "./answer";

export type Role = "default" | "planner" | "synthesizer" | "verifier" | "extractor";

export interface InferenceConfig {
  baseUrl: string;
  apiKey: string | null;
  models: Record<Role, string>;
  timeoutMs: number;
  maxRetries: number;
}

const ROLE_ENV: Record<Role, string> = {
  default: "LLM_MODEL",
  planner: "LLM_PLANNER_MODEL",
  synthesizer: "LLM_SYNTH_MODEL",
  verifier: "LLM_VERIFY_MODEL",
  extractor: "LLM_EXTRACT_MODEL",
};

export function inferenceConfig(): InferenceConfig | null {
  const baseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  const def = (process.env.LLM_MODEL ?? process.env.LLM_DEFAULT_MODEL ?? "").trim();
  const pick = (role: Role) => (process.env[ROLE_ENV[role]] ?? "").trim() || def;
  const models = {
    default: def,
    planner: pick("planner"),
    synthesizer: pick("synthesizer"),
    verifier: pick("verifier"),
    extractor: pick("extractor"),
  };
  if (!models.synthesizer) return null; // phải có ít nhất model cho synthesis
  return {
    baseUrl,
    apiKey: process.env.LLM_API_KEY?.trim() || null,
    models,
    timeoutMs: Math.max(1000, Number(process.env.LLM_TIMEOUT_MS ?? 20000)),
    maxRetries: Math.min(3, Math.max(0, Number(process.env.LLM_MAX_RETRIES ?? 1))),
  };
}

/** Đoán kiểu backend từ base URL — chỉ để hiển thị, không ảnh hưởng hành vi */
export function guessBackend(baseUrl: string): "llama.cpp" | "vllm" | "ollama" | "openai-compatible" {
  const u = baseUrl.toLowerCase();
  if (/:8080\b|llama/.test(u)) return "llama.cpp";
  if (/:8000\b|vllm/.test(u)) return "vllm";
  if (/:11434\b|ollama/.test(u)) return "ollama";
  return "openai-compatible";
}

// --- circuit breaker: mở 60s sau 3 lỗi liên tiếp -----------------------------------
const cb = { fails: 0, openUntil: 0, lastError: null as string | null };
/** Chỉ dùng trong kiểm thử/ops: đóng lại circuit breaker */
export function resetBreaker() {
  cb.fails = 0;
  cb.openUntil = 0;
  cb.lastError = null;
}
export function breakerState() {
  return { open: Date.now() < cb.openUntil, consecutive_failures: cb.fails, last_error: cb.lastError };
}

function headers(cfg: InferenceConfig): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) h.authorization = `Bearer ${cfg.apiKey}`;
  return h;
}

/** Usage THẬT do model/provider trả về — dùng cho billing; không ước lượng theo số ký tự. */
export interface LLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOut {
  text: string;
  model: string;
  ms: number;
  attempts: number;
  usage: LLMUsage | null;
}

/** Gọi chat/completions (non-stream) với retry + breaker. Trả null khi tắt/lỗi. */
export interface CallOpts {
  temperature?: number;
  maxTokens?: number;
  /** ghi đè theo budget: FAST dùng timeout ngắn, không retry */
  timeoutMs?: number;
  retries?: number;
}

/** Timeout/retry theo budget — LLM không được kéo query đơn giản lên 40–50 giây */
export function callOptsForBudget(budget: "fast" | "standard" | "research"): CallOpts {
  const cfg = inferenceConfig();
  const base = cfg?.timeoutMs ?? 20000;
  if (budget === "fast") return { timeoutMs: Math.min(base, 4000), retries: 0 };
  if (budget === "research") return { timeoutMs: base * 2, retries: cfg?.maxRetries ?? 1 };
  return { timeoutMs: base, retries: cfg?.maxRetries ?? 1 };
}

export async function complete(role: Role, messages: ChatTurn[], opts: CallOpts = {}): Promise<CompleteOut | null> {
  const cfg = inferenceConfig();
  if (!cfg) return null;
  if (Date.now() < cb.openUntil) return null;
  const model = cfg.models[role] || cfg.models.synthesizer;
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
  const retries = opts.retries ?? cfg.maxRetries;
  const t0 = performance.now();
  let lastErr = "";
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(cfg),
        body: JSON.stringify({ model, messages, temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 1200, stream: false }),
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        // 4xx khác: không retry
        cb.lastError = `HTTP ${res.status}`;
        return null;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; model?: string; usage?: CompleteOut["usage"] };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("empty completion");
      cb.fails = 0;
      cb.lastError = null;
      return { text, model: json.model || model, ms: Math.round(performance.now() - t0), attempts: attempt, usage: json.usage ?? null };
    } catch (e) {
      lastErr = e instanceof Error ? (e.name === "AbortError" ? `timeout ${timeoutMs}ms` : e.message) : "unknown";
      if (attempt <= retries) await new Promise((r) => setTimeout(r, 250 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  cb.fails++;
  cb.lastError = lastErr;
  if (cb.fails >= 3) cb.openUntil = Date.now() + 60_000;
  return null;
}

/** Streaming token từ LLM (SSE OpenAI). Yield từng delta; throw khi lỗi để caller fallback. */
export async function* streamComplete(role: Role, messages: ChatTurn[], opts: { temperature?: number; maxTokens?: number } = {}): AsyncGenerator<string, { model: string; usage: LLMUsage | null }, void> {
  const cfg = inferenceConfig();
  if (!cfg) throw new Error("inference not configured");
  if (Date.now() < cb.openUntil) throw new Error("circuit open");
  const model = cfg.models[role] || cfg.models.synthesizer;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs * 3);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify({ model, messages, temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 1200, stream: true, stream_options: { include_usage: true } }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let seenModel = model;
    let seenUsage: LLMUsage | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          cb.fails = 0;
          return { model: seenModel, usage: seenUsage };
        }
        try {
          const j = JSON.parse(payload) as { model?: string; usage?: LLMUsage | null; choices?: { delta?: { content?: string } }[] };
          if (j.model) seenModel = j.model;
          if (j.usage && typeof j.usage.total_tokens === "number") seenUsage = j.usage;
          const d = j.choices?.[0]?.delta?.content;
          if (d) yield d;
        } catch {
          /* bỏ qua dòng hỏng */
        }
      }
    }
    cb.fails = 0;
    return { model: seenModel, usage: seenUsage };
  } catch (e) {
    cb.fails++;
    cb.lastError = e instanceof Error ? e.message : "stream error";
    if (cb.fails >= 3) cb.openUntil = Date.now() + 60_000;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Health probe: GET {base}/models — danh sách model backend đang phục vụ */
export async function inferenceHealth(): Promise<{
  configured: boolean;
  ok: boolean | null;
  ms: number | null;
  backend: string | null;
  served_models: string[];
  roles: Record<Role, string> | null;
  breaker: ReturnType<typeof breakerState>;
  detail?: string;
}> {
  const cfg = inferenceConfig();
  if (!cfg) return { configured: false, ok: null, ms: null, backend: null, served_models: [], roles: null, breaker: breakerState() };
  const t0 = performance.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: headers(cfg), signal: AbortSignal.timeout(3000), cache: "no-store" });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { configured: true, ok: false, ms, backend: guessBackend(cfg.baseUrl), served_models: [], roles: cfg.models, breaker: breakerState(), detail: `HTTP ${res.status}` };
    const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
    return { configured: true, ok: true, ms, backend: guessBackend(cfg.baseUrl), served_models: (j.data ?? []).map((m) => m.id ?? "").filter(Boolean).slice(0, 20), roles: cfg.models, breaker: breakerState() };
  } catch (e) {
    return { configured: true, ok: false, ms: Math.round(performance.now() - t0), backend: guessBackend(cfg.baseUrl), served_models: [], roles: cfg.models, breaker: breakerState(), detail: e instanceof Error ? e.message : "unreachable" };
  }
}

// ===========================================================================
// Vai trò SYNTHESIZER — evidence → câu trả lời có [n]
// ===========================================================================
export const SYNTH_SYSTEM_PROMPT = `Bạn là bộ tổng hợp (synthesizer) của VietScope — công cụ tìm kiếm AI cho Việt Nam.
NGUYÊN TẮC BẮT BUỘC:
1. Chỉ dùng thông tin trong EVIDENCE được cung cấp. Không bịa số liệu, tên, địa chỉ, ngày tháng.
2. Mỗi câu khẳng định phải kèm chỉ số nguồn dạng [n] ngay sau nội dung, với n là số thứ tự nguồn trong EVIDENCE.
3. Nếu evidence không đủ để trả lời, nói rõ phần nào chưa có bằng chứng — không suy diễn.
4. Nếu các nguồn mâu thuẫn, nêu cả hai và chỉ rõ nguồn nào chính thống hơn.
5. Trả lời bằng tiếng Việt tự nhiên, ngắn gọn, đi thẳng vào câu hỏi.
6. Với câu hỏi địa điểm: liệt kê đúng địa điểm có trong evidence, kèm địa chỉ/giờ mở cửa nếu có, và ghi rõ địa điểm nào "chưa xác minh".`;

export function buildSynthesisMessages(query: string, u: UnderstandingDTO, docs: DocDTO[]): ChatTurn[] {
  const ev = docs
    .slice(0, 8)
    .map(
      (d, i) =>
        `[${i + 1}] (${d.sourceType}, authority ${d.authority.toFixed(2)}${d.publishedAt ? ", " + new Date(d.publishedAt).toISOString().slice(0, 10) : ""}) ${d.title}\nURL: ${d.url}\n${(d.content || d.snippet).slice(0, 1800)}`
    )
    .join("\n\n");
  const ctx = [
    `Intent: ${u.intent} (${u.intentLabel})`,
    u.specialty ? `Chuyên ngành: ${u.specialty}` : null,
    u.locations.length ? `Địa danh người dùng gõ: ${u.locations.map((l) => l.name).join(", ")}` : null,
    u.transition ? `Địa giới: ${u.transition.from} đã sáp nhập thành ${u.transition.to.join(", ")} từ ${u.transition.date ?? "?"}` : null,
    u.freshness !== "any" ? `Yêu cầu độ tươi: ${u.freshness}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: SYNTH_SYSTEM_PROMPT },
    { role: "user", content: `PHÂN TÍCH CÂU HỎI:\n${ctx}\n\nEVIDENCE:\n${ev || "(không có nguồn nào khớp)"}\n\nCÂU HỎI: ${query}\n\nHãy trả lời, mỗi khẳng định kèm [n].` },
  ];
}

/** Tách text có marker [n] thành các block + citations (1-based) */
export function parseAnswerText(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const rawPara of text.split(/\n{2,}/)) {
    const para = rawPara.trim();
    if (!para || /^#+\s/.test(para)) continue; // bỏ heading markdown
    if (/^(lưu ý|cảnh báo|chú ý|note)\b/i.test(para)) {
      blocks.push({ kind: "callout", text: para.replace(/\s*\[(\d+)\]/g, ""), citations: citeNums(para), supported: true });
      continue;
    }
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every((l) => /^[-*•\d]/.test(l))) {
      blocks.push({
        kind: "list",
        items: lines.map((l) => ({ text: l.replace(/^[-*•]\s*|^\d+[.)]\s*/, "").replace(/\s*\[(\d+)\]/g, "").trim(), citations: citeNums(l), supported: true })),
        citations: citeNums(para),
        supported: true,
      });
      continue;
    }
    blocks.push({ kind: "paragraph", text: para.replace(/\s*\[(\d+)\]/g, ""), citations: citeNums(para), supported: true });
  }
  return blocks;
}

function citeNums(s: string): number[] {
  const out = new Set<number>();
  for (const m of s.matchAll(/\[(\d{1,2})\]/g)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

export interface SynthesisOut {
  blocks: AnswerBlock[];
  headline: string;
  model: string;
  ms: number;
  attempts: number;
  usage: LLMUsage | null;
}

export async function synthesizeWithLLM(query: string, u: UnderstandingDTO, docs: DocDTO[], opts: CallOpts = {}): Promise<SynthesisOut | null> {
  if (docs.length === 0) return null;
  const out = await complete("synthesizer", buildSynthesisMessages(query, u, docs), opts);
  if (!out) return null;
  const blocks = parseAnswerText(out.text);
  if (!blocks.length) return null;
  return { blocks, headline: firstHeading(out.text, query), model: out.model, ms: out.ms, attempts: out.attempts, usage: out.usage };
}

function firstHeading(text: string, query: string): string {
  const m = text.match(/^#+\s+(.+)$/m);
  if (m) return m[1].replace(/\[(\d+)\]/g, "").trim().slice(0, 120);
  return query.slice(0, 90);
}

// ===========================================================================
// Vai trò PLANNER — research planning (chỉ với budget RESEARCH)
// ===========================================================================
export async function planWithLLM(query: string, u: Pick<UnderstandingDTO, "intent" | "specialty">, covered: string[], opts: CallOpts = {}): Promise<{ subqueries: string[]; model: string; ms: number } | null> {
  const out = await complete(
    "planner",
    [
      {
        role: "system",
        content:
          "Bạn là bộ lập kế hoạch nghiên cứu của VietScope. Nhiệm vụ: tách câu hỏi phức tạp thành tối đa 3 truy vấn con ngắn (tiếng Việt), " +
          "mỗi truy vấn nhắm một khía cạnh còn thiếu bằng chứng. Chỉ trả về JSON: {\"subqueries\": [\"...\", \"...\"]}. Không giải thích.",
      },
      {
        role: "user",
        content: `CÂU HỎI: ${query}\nINTENT: ${u.intent}${u.specialty ? ` · ${u.specialty}` : ""}\nĐÃ CÓ NGUỒN VỀ: ${covered.slice(0, 6).join(" | ") || "(chưa có)"}`,
      },
    ],
    { temperature: 0.1, maxTokens: 300, ...opts }
  );
  if (!out) return null;
  try {
    const m = out.text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : out.text) as { subqueries?: unknown };
    const subs = Array.isArray(j.subqueries) ? j.subqueries.map(String).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 3) : [];
    return subs.length ? { subqueries: subs, model: out.model, ms: out.ms } : null;
  } catch {
    return null;
  }
}
