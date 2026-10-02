// ---------------------------------------------------------------------------
// VietScope · VietScopeModel facade — "vietscope-1"
// Bên ngoài chỉ có MỘT model. Bên trong: understand → budget → retrieve →
// fuse → synthesize → verify. Facade chuyển kết quả sang các contract:
//   /v1/retrieve · /v1/search · /v1/chat/completions · /v1/responses
// Engine suy luận (LLM) là thành phần thay thế được — facade không phụ thuộc.
// ---------------------------------------------------------------------------
import { runPipeline, prepare, finalize, toResponse, retrieveOnly, unify, MODEL_ID, MODEL_ALIASES, type RetrievalOutcome, type RunOptions, type VietScopeResponse } from "./pipeline";
import { synthesize } from "./answer";
import { buildSynthesisMessages, callOptsForBudget, inferenceConfig, parseAnswerText, streamComplete, type LLMUsage } from "./inference";
import { passagesFor } from "./evidence";
import { clamp } from "./vi";
import type { ModeInput } from "@/core/contract";

export interface ChatMessage {
  role: string;
  content: string | { type?: string; text?: string }[];
}

export type ModelInput = string | ChatMessage[];

const FOOD_CATS = new Set(["gio-cha", "pho", "bun-cha", "banh-cuon", "banh-mi", "com", "bun-bo", "mi-quang", "banh-da-cua", "com-chay", "cha-ca", "dac-san", "an-dem", "cafe"]);

const INTENT_TYPE: Record<string, string> = {
  local_search: "local",
  legal: "legal",
  market_price: "market",
  weather: "weather",
  compare: "comparison",
  admin_info: "admin",
  product: "product",
  news: "news",
  general: "general",
};

function textOf(c: ChatMessage["content"]): string {
  if (typeof c === "string") return c;
  return (c ?? []).map((p) => p.text ?? "").join(" ");
}

/** Lượt hiện tại + câu hỏi trước đó (để pipeline kế thừa ngữ cảnh một cách deterministic). */
export function resolveTurn(input: ModelInput): { query: string; context: string | null } {
  if (typeof input === "string") return { query: input.trim().slice(0, 500), context: null };
  const users = input.filter((m) => m.role === "user").map((m) => textOf(m.content).trim()).filter(Boolean);
  return { query: (users[users.length - 1] ?? "").slice(0, 500), context: users.length > 1 ? users[users.length - 2].slice(0, 500) : null };
}

export function resolveQuery(input: ModelInput): string {
  return resolveTurn(input).query;
}

/**
 * Usage cho response. Ưu tiên usage THẬT của LLM provider; không có (extractive / provider không trả)
 * thì ước lượng và gắn `estimated: true` — không dùng ước lượng này để tính tiền.
 */
export function usageFor(data: VietScopeResponse, query: string, outputText: string) {
  const u = data.llm_usage;
  if (u && typeof u.total_tokens === "number") {
    return { prompt_tokens: u.prompt_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0, total_tokens: u.total_tokens, estimated: false as const };
  }
  const pt = approxTokens(query);
  const ct = approxTokens(outputText);
  return { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct, estimated: true as const };
}

export function approxTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 3.6));
}

/** Markdown có marker [n] + chân trang nguồn (mọi OpenAI client đều render được). */
export function renderMarkdown(data: VietScopeResponse): { body: string; full: string } {
  const lines: string[] = [];
  for (const b of data.answer.blocks) {
    const cites = (b.citations ?? []).map((n) => `[${n}]`).join("");
    if (b.kind === "table" && b.table) {
      const { columns, rows } = b.table;
      lines.push(`| ${columns.join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`);
      for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
    } else if (b.text) {
      lines.push(`${b.text}${cites ? " " + cites : ""}`);
    }
    lines.push("");
  }
  if (data.places.exact.length) {
    lines.push("**Địa điểm đã xác minh:**");
    data.places.exact.slice(0, 6).forEach((p) => {
      lines.push(`- **${p.name}** — ${p.address}${p.rating ? ` · ${p.rating.toFixed(1)}★` : ""}${p.hours ? ` · ${p.hours}` : ""}${p.distanceLabel ? ` · cách ${p.distanceLabel}` : ""}`);
    });
    lines.push("");
  }
  if (data.places.unverified.length) {
    lines.push("_Tìm thấy thêm từ web (chưa xác minh):_");
    data.places.unverified.slice(0, 5).forEach((p) => lines.push(`- ${p.name} — ${p.address}`));
    lines.push("");
  }
  const body = lines.join("\n").trim();
  const footer = data.sources.length ? `\n\n**Nguồn:**\n${data.sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join("\n")}` : "";
  return { body, full: body + footer };
}

function annotations(body: string, data: VietScopeResponse) {
  const out: { type: "url_citation"; start_index: number; end_index: number; url: string; title: string }[] = [];
  const rx = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(body)) !== null) {
    const src = data.sources[Number(m[1]) - 1];
    if (src) out.push({ type: "url_citation", start_index: m.index, end_index: m.index + m[0].length, url: src.url, title: src.title });
  }
  return out;
}

function ext(data: VietScopeResponse) {
  return {
    backend: data.backend,
    trace_id: data.trace_id,
    synthesizer: data.synthesizer,
    llm_usage: data.llm_usage,
    understanding: data.understanding,
    budget: data.budget,
    places: data.places,
    results: data.results,
    citations: data.citations,
    related: data.places.related,
    verification: { verified_ratio: data.verification.verifiedRatio, citation_precision: data.verification.citationPrecision, citation_coverage: data.verification.citationCoverage },
    quality: { confidence: data.quality.confidence, coverage: data.quality.coverageLabel, independent_sources: data.quality.independentSources },
    coverage: data.coverage,
    federation: data.federation,
    timings: data.timings,
  };
}

export class VietScopeModel {
  readonly id = MODEL_ID;

  /** Alias model → mode nội bộ (người dùng cuối chỉ thấy vietscope-1). */
  static resolveModel(name: string | undefined | null): { id: string; mode: ModeInput } {
    const key = (name ?? MODEL_ID).trim();
    if (key in MODEL_ALIASES) return { id: MODEL_ID, mode: MODEL_ALIASES[key] };
    return { id: MODEL_ID, mode: "auto" };
  }

  async respond(input: ModelInput, opts: RunOptions = {}): Promise<VietScopeResponse> {
    const { query, context } = resolveTurn(input);
    return runPipeline(query, { ...opts, context: opts.context ?? context });
  }

  /** Chỉ retrieve (KHÔNG LLM, KHÔNG synthesis) — nền của /v1/retrieve, /v1/search, /v1/places/search, MCP */
  async retrieve(input: ModelInput, opts: RunOptions = {}): Promise<RetrievalOutcome> {
    const { query, context } = resolveTurn(input);
    return retrieveOnly(query, { ...opts, context: opts.context ?? context });
  }

  /** /v1/retrieve — "retrieval brain" cho AI agents: intent + results + evidence(passage/offset) + quality + timings */
  toRetrieve(out: RetrievalOutcome, query: string, evidence: "auto" | "off" | "full" = "auto", maxResults = 10) {
    const R = out.retrieval;
    const u = R.understanding;
    const top = R.places.exact[0] ?? R.places.unverified[0];
    return {
      model: MODEL_ID,
      backend: R.backend,
      query,
      trace_id: out.traceId,
      intent: {
        type: INTENT_TYPE[u.intent] ?? "general",
        label: u.intentLabel,
        category: u.intent === "local_search" ? (top && FOOD_CATS.has(top.category) ? "food" : "local") : null,
        specialty: u.specialty,
        location: u.locations[0]?.name ?? null,
        locations: u.locations,
        transition: u.transition,
        freshness: u.freshness,
        fuzzy: u.fuzzy,
      },
      budget: R.budget,
      results: unify(R, clamp(maxResults, 1, 30)),
      related: R.places.related,
      candidates: R.places.candidates,
      evidence: evidence === "off" ? [] : passagesFor(query, R.docs, evidence === "full" ? 4 : 2, evidence === "full" ? 20 : 8),
      quality: {
        confidence: R.quality.confidence,
        coverage: R.quality.coverage,
        independent_sources: R.quality.independentSources,
        exact_places: R.places.exact.length,
      },
      coverage: R.coverage,
      federation: R.federation,
      widening: R.widening,
      timings: {
        understand_ms: out.timings.understand_ms ?? 0,
        retrieve_ms: out.timings.retrieve_ms ?? 0,
        rerank_ms: out.timings.rerank_ms ?? 0,
        total_ms: out.timings.total_ms ?? 0,
      },
    };
  }

  /** /v1/chat/completions */
  toChatCompletion(data: VietScopeResponse, query: string) {
    const { full } = renderMarkdown(data);
    const usage = usageFor(data, query, full);
    return {
      id: `chatcmpl-vs-${Date.now().toString(36)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: data.model,
      choices: [{ index: 0, message: { role: "assistant", content: full }, finish_reason: "stop" }],
      usage: { ...usage, vietscope: data.usage },
      vietscope: ext(data),
    };
  }

  /** /v1/responses (OpenAI Responses API) */
  toResponses(data: VietScopeResponse, query: string, id = `resp_vs_${Date.now().toString(36)}`) {
    const { body, full } = renderMarkdown(data);
    const usage = usageFor(data, query, full);
    return {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: data.model,
      output: [
        {
          id: `msg_${id.slice(-8)}`,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: full, annotations: annotations(body, data) }],
        },
      ],
      output_text: full,
      usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, estimated: usage.estimated },
      vietscope: { ...ext(data), places: data.places },
    };
  }

  /**
   * Stream thật: prepare (retrieve) → token từ LLM đẩy thẳng tới client → verify sau khi xong.
   * Không có LLM / LLM lỗi → fallback extractive và giả-stream.
   * onDelta nhận từng mảnh text; trả về VietScopeResponse cuối cùng (đã verify) để gửi ở chunk cuối.
   */
  async respondStream(input: ModelInput, opts: RunOptions, onDelta: (delta: string) => Promise<void> | void): Promise<VietScopeResponse> {
    const { query, context } = resolveTurn(input);
    const runOpts: RunOptions = { ...opts, context: opts.context ?? context };
    const p = await prepare(query, runOpts);
    const cfg = inferenceConfig();
    let streamedText = "";
    let streamUsage: LLMUsage | null = null;
    let synthesizer = "extractive";
    let a = synthesize(p.u, p.r);

    if (cfg && p.fused.length) {
      const t0 = performance.now();
      try {
        const call = callOptsForBudget(p.policy.name);
        const gen = streamComplete("synthesizer", buildSynthesisMessages(query, p.u, p.fused), call);
        let model = cfg.models.synthesizer;
        while (true) {
          const n = await gen.next();
          if (n.done) {
            model = n.value.model;
            streamUsage = n.value.usage;
            break;
          }
          streamedText += n.value;
          await onDelta(n.value);
        }
        const blocks = parseAnswerText(streamedText);
        if (blocks.length) {
          a = { ...a, headline: query.slice(0, 90), blocks };
          synthesizer = `llm:${model}`;
          p.federation.push({ provider: "inference-engine", lane: "llm synthesis (stream)", status: "ok", ms: Math.round(performance.now() - t0), count: blocks.length, detail: model });
        }
      } catch (e) {
        p.federation.push({ provider: "inference-engine", lane: "llm synthesis (stream)", status: "error", ms: Math.round(performance.now() - t0), count: 0, detail: `${e instanceof Error ? e.message : "stream error"} → fallback extractive` });
      }
    } else {
      p.federation.push({ provider: "inference-engine", lane: "llm synthesis", status: cfg ? "empty" : "disabled", ms: 0, count: 0, detail: cfg ? "không có evidence để tổng hợp" : "chưa cấu hình LLM_BASE_URL → synthesizer extractive" });
    }

    const x = await finalize(p, a, synthesizer, performance.now(), runOpts, streamUsage);
    const data = toResponse(x, query, runOpts);
    if (!streamedText) {
      // fallback: giả-stream phần thân câu trả lời extractive
      const { body } = renderMarkdown(data);
      for (let i = 0; i < body.length; i += 28) await onDelta(body.slice(i, i + 28));
    }
    return data;
  }

  /** SSE chat.completion.chunk với stream thật từ LLM; chunk cuối kèm usage + vietscope ext (đã verify) */
  streamChatLive(input: ModelInput, opts: RunOptions, onUsage?: (u: ReturnType<typeof usageFor>) => void): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const id = `chatcmpl-vs-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);
    const model = MODEL_ID;
    const self = this;
    const { query } = resolveTurn(input);
    return new ReadableStream<Uint8Array>({
      async start(c) {
        const send = (o: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
        send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
        try {
          let streamed = "";
          const data = await self.respondStream(input, opts, (d) => {
            streamed += d;
            send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: d }, finish_reason: null }] });
          });
          // chân trang nguồn + (nếu LLM) các khối bị gắn cờ
          const flagged = data.answer.blocks.filter((b) => b.supported === false && b.text).map((b) => b.text!.slice(0, 80));
          const footer =
            (flagged.length ? `\n\n_⚠ ${flagged.length} câu chưa đủ bằng chứng trong nguồn: ${flagged.map((t) => `“${t}…”`).join("; ")}_` : "") +
            (data.sources.length ? `\n\n**Nguồn:**\n${data.sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join("\n")}` : "");
          if (footer) send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: footer }, finish_reason: null }] });
          const usage = usageFor(data, query, streamed + footer);
          onUsage?.(usage);
          send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { ...usage, vietscope: data.usage }, vietscope: ext(data) });
        } catch (e) {
          send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: `\n\n[VietScope] lỗi: ${e instanceof Error ? e.message : "unknown"}` }, finish_reason: "stop" }] });
        }
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
  }

  /** SSE Responses API với stream thật từ LLM */
  streamResponsesLive(input: ModelInput, opts: RunOptions, onUsage?: (u: ReturnType<typeof usageFor>) => void): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const id = `resp_vs_${Date.now().toString(36)}`;
    const itemId = `msg_${id.slice(-8)}`;
    const self = this;
    const { query } = resolveTurn(input);
    let seq = 0;
    return new ReadableStream<Uint8Array>({
      async start(c) {
        const send = (type: string, payload: Record<string, unknown>) => c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...payload })}\n\n`));
        send("response.created", { response: { id, object: "response", status: "in_progress", model: MODEL_ID, output: [], output_text: "" } });
        try {
          let streamed = "";
          const data = await self.respondStream(input, opts, (d) => {
            streamed += d;
            send("response.output_text.delta", { item_id: itemId, output_index: 0, content_index: 0, delta: d });
          });
          const footer = data.sources.length ? `\n\n**Nguồn:**\n${data.sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join("\n")}` : "";
          if (footer) send("response.output_text.delta", { item_id: itemId, output_index: 0, content_index: 0, delta: footer });
          const text = streamed + footer;
          onUsage?.(usageFor(data, query, text));
          send("response.output_text.done", { item_id: itemId, output_index: 0, content_index: 0, text });
          const final = self.toResponses(data, query, id);
          final.output[0].content[0].text = text;
          final.output[0].content[0].annotations = annotations(streamed, data);
          final.output_text = text;
          send("response.completed", { response: final });
        } catch (e) {
          send("response.failed", { response: { id, object: "response", status: "failed", model: MODEL_ID, error: { message: e instanceof Error ? e.message : "unknown" } } });
        }
        c.close();
      },
    });
  }

  streamChat(data: VietScopeResponse, query: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const { full } = renderMarkdown(data);
    const id = `chatcmpl-vs-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);
    const model = data.model;
    const send = (c: ReadableStreamDefaultController<Uint8Array>, o: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
    return new ReadableStream<Uint8Array>({
      async start(c) {
        send(c, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
        for (let i = 0; i < full.length; i += 28) {
          send(c, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: full.slice(i, i + 28) }, finish_reason: null }] });
          await new Promise((r) => setTimeout(r, 6));
        }
        const pt = approxTokens(query);
        const ct = approxTokens(full);
        send(c, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct }, vietscope: ext(data) });
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
  }

  streamResponses(data: VietScopeResponse, query: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const final = this.toResponses(data, query);
    const text = final.output_text;
    let seq = 0;
    const send = (c: ReadableStreamDefaultController<Uint8Array>, type: string, payload: Record<string, unknown>) =>
      c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...payload })}\n\n`));
    return new ReadableStream<Uint8Array>({
      async start(c) {
        send(c, "response.created", { response: { ...final, status: "in_progress", output: [], output_text: "" } });
        send(c, "response.output_text.delta", { item_id: final.output[0].id, output_index: 0, content_index: 0, delta: "" });
        for (let i = 0; i < text.length; i += 28) {
          send(c, "response.output_text.delta", { item_id: final.output[0].id, output_index: 0, content_index: 0, delta: text.slice(i, i + 28) });
          await new Promise((r) => setTimeout(r, 6));
        }
        send(c, "response.output_text.done", { item_id: final.output[0].id, output_index: 0, content_index: 0, text });
        send(c, "response.completed", { response: final });
        c.close();
      },
    });
  }
}

export const vietscope = new VietScopeModel();
