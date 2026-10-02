// ---------------------------------------------------------------------------
// VietScope · Facade pipeline — nửa "sản phẩm" của vietscope-1
//
//   RETRIEVAL BRAIN (backend duy nhất, qua Retrieval Contract v1)
//        → Evidence → InferenceGateway (LLM | extractive) → Verification → Citations → ANSWER
//
// File này KHÔNG chứa logic retrieval (không understand/route/rank/dedup/RRF/widening): tất cả nằm ở
// backend được chọn bằng RETRIEVAL_BACKEND. Facade chỉ: gọi backend, tổng hợp, kiểm chứng, ghi vết.
// ---------------------------------------------------------------------------
import { retrieveVia } from "@/core/backend";
import type { Budget, BudgetDTO, DocDTO, ModeInput, PlaceDTO, ProviderStatus, RetrieveResult, UnderstandingDTO } from "@/core/contract";
import type { CandidateDTO } from "@/core/contract";
import { synthesize, type AnswerResult, type SourceEntry } from "./answer";
import { callOptsForBudget, inferenceConfig, synthesizeWithLLM, type LLMUsage } from "./inference";
import { extractArticle, verifyAnswer, type ClaimCheck, type Verification } from "./evidence";
import { recordTrace } from "./traces";
import { clamp, freshnessLabel } from "./vi";

export const MODEL_ID = "vietscope-1";
/** Chỉ MỘT model public. Các alias cũ vẫn được chấp nhận ở request nhưng không quảng bá. */
export const MODELS = [
  {
    id: MODEL_ID,
    label: "VietScope 1",
    desc: "Compound AI Search Model cho Việt Nam — tự chọn chiến lược (fast / standard / research) theo câu hỏi.",
  },
];
export const MODEL_ALIASES: Record<string, ModeInput> = {
  "vietscope-1": "auto",
  "vietscope-1-fast": "fast",
  "vietscope-1-research": "research",
  "duyai-search": "auto",
};

export interface RunOptions {
  /** câu hỏi người dùng ngay trước đó (hội thoại) — brain kế thừa địa danh/chuyên ngành cho câu nối tiếp */
  context?: string | null;
  mode?: ModeInput;
  location?: { lat: number; lng: number } | null;
  maxResults?: number;
  log?: boolean;
}

export type PublicPlace = PlaceDTO;
export type PublicCandidate = CandidateDTO;

export interface UnifiedResult {
  id: string;
  type: "place" | "web";
  title: string;
  url: string | null;
  snippet: string;
  source: string;
  source_type: string;
  published_at: string | null;
  retrieved_at: string;
  authority: number;
  freshness: string;
  location: { address: string | null; lat: number | null; lng: number | null; distance_m: number | null } | null;
  entity: string | null;
  verified: boolean | null;
  score: number;
}

export interface CitationOut {
  n: number;
  title: string;
  url: string;
  domain: string;
  source_type: string;
  authority: number;
  published_at: string | null;
  article: string | null;
  passage: { text: string; start: number; end: number } | null;
  supports_blocks: number[];
}

export interface VietScopeResponse {
  model: string;
  backend: string;
  query: string;
  trace_id: string | null;
  synthesizer: string;
  /** usage THẬT từ LLM provider (null khi extractive hoặc provider không trả usage) */
  llm_usage: LLMUsage | null;
  understanding: {
    intent: string;
    intentLabel: string;
    normalized: string;
    specialty: string | null;
    freshness: string;
    locations: { id: string; name: string; type: string; status: string; matchedTerm: string }[];
    transition: { from: string; to: string[]; date: string | null } | null;
    compareTargets: [string, string] | null;
    fuzzy: { used: boolean; notes: string[] };
  };
  budget: { name: Budget; reason: string; targetMs: string; multiHop: boolean; readEvidence: boolean };
  answer: { mode: string; headline: string; blocks: AnswerResult["blocks"]; claimsCited: number; claimsUnsupported: number };
  sources: SourceEntry[];
  citations: CitationOut[];
  results: UnifiedResult[];
  places: { exact: PlaceDTO[]; unverified: PlaceDTO[]; related: PlaceDTO[]; candidates: CandidateDTO[] };
  web: { title: string; url: string; domain: string; snippet: string; publishedAt: string | null; freshness: string; sourceType: string; authority: number; origin: string }[];
  verification: { verifiedRatio: number; citationPrecision: number; citationCoverage: number; claims: ClaimCheck[] };
  quality: {
    confidence: number;
    coverageLabel: "good" | "partial" | "none";
    independentSources: number;
    exactCount: number;
    unverifiedCount: number;
    relatedCount: number;
    citedClaims: number;
    unsupportedClaims: number;
    avgAuthority: number;
    sourceDiversity: number;
  };
  coverage: { gap: boolean; reason: string | null; widened: boolean };
  federation: ProviderStatus[];
  widening: string[];
  timings: Record<string, number>;
  usage: { search_requests: number; sources_read: number; places_scanned: number; providers_called: number };
}

// --- chuyển DTO → hình dạng response ---------------------------------------------------------
export function unify(r: RetrieveResult, max: number): UnifiedResult[] {
  const now = new Date().toISOString();
  const placeRes = (p: PlaceDTO): UnifiedResult => ({
    id: p.id,
    type: "place",
    title: p.name,
    url: p.lat && p.lng ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}` : null,
    snippet: [p.categoryLabel, p.hours, p.priceLabel, p.note].filter(Boolean).join(" · "),
    source: p.source,
    source_type: "place",
    published_at: p.updatedAt,
    retrieved_at: now,
    authority: p.verified ? 0.9 : 0.4,
    freshness: freshnessLabel(p.updatedAt),
    location: { address: p.address, lat: p.lat, lng: p.lng, distance_m: p.distanceKm != null ? Math.round(p.distanceKm * 1000) : null },
    entity: p.category,
    verified: p.verified,
    score: p.score,
  });
  const docRes = (d: DocDTO): UnifiedResult => ({
    id: d.id,
    type: "web",
    title: d.title,
    url: d.url,
    snippet: d.snippet,
    source: d.domain,
    source_type: d.sourceType,
    published_at: d.publishedAt,
    retrieved_at: now,
    authority: d.authority,
    freshness: freshnessLabel(d.publishedAt),
    location: null,
    entity: d.entities?.[0] ?? null,
    verified: null,
    score: d.score,
  });
  return [...r.places.exact.map(placeRes), ...r.places.unverified.map(placeRes), ...r.docs.map(docRes)].slice(0, max);
}

function buildCitations(docs: DocDTO[], v: Verification): CitationOut[] {
  return docs.map((d, i) => {
    const n = i + 1;
    const supporting = v.claims.filter((c) => c.citations.includes(n));
    const withPassage = supporting.filter((c) => c.via === "passage" && c.source === n && c.passage).sort((a, b) => b.score - a.score)[0];
    return {
      n,
      title: d.title,
      url: d.url,
      domain: d.domain,
      source_type: d.sourceType,
      authority: d.authority,
      published_at: d.publishedAt,
      article: extractArticle(withPassage?.passage?.text ?? d.snippet),
      passage: withPassage?.passage ?? null,
      supports_blocks: supporting.map((c) => c.blockIndex),
    };
  });
}

/** Độ tin cậy cuối = độ tin cậy retrieval × hệ số verification của câu trả lời */
function finalQuality(R: RetrieveResult, v: Verification) {
  const confidence = Math.round(clamp(R.quality.confidence * (0.6 + 0.4 * v.verifiedRatio), 0, 0.97) * 100) / 100;
  const coverageLabel: "good" | "partial" | "none" = confidence >= 0.7 ? "good" : confidence >= 0.35 ? "partial" : "none";
  return { confidence, coverageLabel, independent: R.quality.independentSources, avgAuthority: R.quality.avgAuthority };
}

// --- pha 0: chỉ retrieve (không LLM, không synthesis) ---------------------------------------------
export interface RetrievalOutcome {
  retrieval: RetrieveResult;
  traceId: string | null;
  timings: Record<string, number>;
}

function callBackend(query: string, opts: RunOptions) {
  return retrieveVia({ query, context: opts.context ?? null, mode: opts.mode ?? "auto", location: opts.location ?? null, maxResults: opts.maxResults, record: opts.log !== false });
}

/** Core Search / Retrieve / Places / Evidence: KHÔNG gọi LLM, không synthesis. */
export async function retrieveOnly(query: string, opts: RunOptions = {}): Promise<RetrievalOutcome> {
  const t0 = performance.now();
  const retrieval = await callBackend(query, opts);
  const timings = { ...retrieval.timings, total_ms: Math.round(performance.now() - t0), backend_ms: retrieval.timings.total_ms ?? 0 };
  let traceId: string | null = null;
  if (opts.log !== false) {
    traceId = await recordTrace({ retrieval, synthesizer: "none", confidence: retrieval.quality.confidence, coverageLabel: retrieval.quality.coverage, timings });
  }
  return { retrieval, traceId, timings };
}

// --- pha 1 → 3: retrieve → synthesis → verify ----------------------------------------------------------
export interface Prepared {
  query: string;
  retrieval: RetrieveResult;
  /** alias tiện dụng */
  r: RetrieveResult;
  u: UnderstandingDTO;
  fused: DocDTO[];
  policy: BudgetDTO;
  federation: ProviderStatus[];
  widening: string[];
  marks: { t0: number; tRetrieve: number };
}

export interface Analysis {
  retrieval: RetrieveResult;
  a: AnswerResult;
  verification: Verification;
  quality: ReturnType<typeof finalQuality>;
  synthesizer: string;
  traceId: string | null;
  timings: Record<string, number>;
  federation: ProviderStatus[];
  widening: string[];
  llmUsage: LLMUsage | null;
}

export async function prepare(query: string, opts: RunOptions = {}): Promise<Prepared> {
  const t0 = performance.now();
  const retrieval = await callBackend(query, opts);
  const tRetrieve = performance.now();
  return {
    query,
    retrieval,
    r: retrieval,
    u: retrieval.understanding,
    fused: retrieval.docs,
    policy: retrieval.budget,
    federation: [...retrieval.federation],
    widening: [...retrieval.widening],
    marks: { t0, tRetrieve },
  };
}

/** Ghi trạng thái Inference Engine vào federation */
export function noteInference(federation: ProviderStatus[], ok: { model: string; ms: number; count: number; attempts?: number } | null) {
  if (ok) {
    federation.push({ provider: "inference-engine", lane: "llm synthesis", status: "ok", ms: ok.ms, count: ok.count, detail: `${ok.model}${(ok.attempts ?? 1) > 1 ? ` · retry ${(ok.attempts ?? 1) - 1}` : ""}` });
    return;
  }
  const cfg = inferenceConfig();
  federation.push({
    provider: "inference-engine",
    lane: "llm synthesis",
    status: cfg ? "error" : "disabled",
    ms: 0,
    count: 0,
    detail: cfg ? `LLM lỗi/timeout (${cfg.models.synthesizer}) → fallback synthesizer extractive` : "chưa cấu hình LLM_BASE_URL → synthesizer extractive",
  });
}

/** Verification → quality gate → trace. `a` đã có blocks (LLM hoặc extractive). */
export async function finalize(p: Prepared, a: AnswerResult, synthesizer: string, tAnswer: number, opts: RunOptions = {}, llmUsage: LLMUsage | null = null): Promise<Analysis> {
  const { retrieval, u, fused, federation, widening, marks } = p;
  const verification = verifyAnswer(a.blocks, fused, u.intent);
  a.blocks.forEach((b, i) => {
    const c = verification.claims[i];
    if (c && !c.supported) b.supported = false;
  });
  a.claimsCited = verification.claims.filter((c) => c.citations.length > 0 && c.supported).length;
  a.claimsUnsupported = verification.unsupportedClaims;
  const tVerify = performance.now();

  const quality = finalQuality(retrieval, verification);
  const rt = retrieval.timings;
  const timings: Record<string, number> = {
    total_ms: Math.round(tVerify - marks.t0),
    load_graph_ms: rt.load_graph_ms ?? 0,
    understand_ms: rt.understand_ms ?? 0,
    retrieve_ms: rt.retrieve_ms ?? Math.round(marks.tRetrieve - marks.t0),
    rerank_ms: rt.rerank_ms ?? 0,
    synthesize_ms: Math.round(tAnswer - marks.tRetrieve),
    verify_ms: Math.round(tVerify - tAnswer),
    backend_ms: rt.total_ms ?? Math.round(marks.tRetrieve - marks.t0),
    network_ms: rt.network_ms ?? 0,
  };
  let traceId: string | null = null;
  if (opts.log !== false) {
    traceId = await recordTrace({ retrieval: { ...retrieval, federation, widening }, a, verification, synthesizer, confidence: quality.confidence, coverageLabel: quality.coverageLabel, timings, llmUsage });
  }
  return { retrieval, a, verification, quality, synthesizer, traceId, timings, federation, widening, llmUsage };
}

/** Đường non-stream: retrieve → synthesis (LLM hoặc extractive) → verify */
export async function analyze(query: string, opts: RunOptions = {}): Promise<Analysis> {
  const p = await prepare(query, opts);
  let a = synthesize(p.u, p.r);
  let synthesizer = "extractive";
  let usage: LLMUsage | null = null;
  const llm = await synthesizeWithLLM(query, p.u, p.fused, callOptsForBudget(p.policy.name));
  if (llm && llm.blocks.length) {
    a = { ...a, headline: llm.headline, blocks: llm.blocks };
    synthesizer = `llm:${llm.model}`;
    usage = llm.usage;
    noteInference(p.federation, { model: llm.model, ms: llm.ms, count: llm.blocks.length, attempts: llm.attempts });
  } else {
    noteInference(p.federation, null);
  }
  return finalize(p, a, synthesizer, performance.now(), opts, usage);
}

export function toResponse(x: Analysis, query: string, opts: RunOptions = {}): VietScopeResponse {
  const { retrieval: R, a, verification, quality, synthesizer, traceId, timings, federation, widening, llmUsage } = x;
  const u = R.understanding;
  const maxResults = clamp(opts.maxResults ?? 10, 1, 30);
  return {
    model: MODEL_ID,
    backend: R.backend,
    query,
    trace_id: traceId,
    synthesizer,
    llm_usage: llmUsage,
    understanding: {
      intent: u.intent,
      intentLabel: u.intentLabel,
      normalized: u.normalized,
      specialty: u.specialty,
      freshness: u.freshness,
      locations: u.locations.map((l) => ({ id: l.id, name: l.name, type: l.type, status: l.status, matchedTerm: l.matchedTerm })),
      transition: u.transition,
      compareTargets: u.compareTargets,
      fuzzy: u.fuzzy,
    },
    budget: { name: R.budget.name, reason: R.budget.reason, targetMs: R.budget.targetMs, multiHop: R.budget.multiHop, readEvidence: R.budget.readEvidence },
    answer: { mode: a.mode, headline: a.headline, blocks: a.blocks, claimsCited: a.claimsCited, claimsUnsupported: a.claimsUnsupported },
    sources: a.sources,
    citations: buildCitations(R.docs, verification),
    results: unify(R, maxResults),
    places: R.places,
    web: R.docs.map((d) => ({ title: d.title, url: d.url, domain: d.domain, snippet: d.snippet, publishedAt: d.publishedAt, freshness: freshnessLabel(d.publishedAt), sourceType: d.sourceType, authority: d.authority, origin: d.origin })),
    verification: {
      verifiedRatio: Math.round(verification.verifiedRatio * 100) / 100,
      citationPrecision: Math.round(verification.citationPrecision * 100) / 100,
      citationCoverage: Math.round(verification.citationCoverage * 100) / 100,
      claims: verification.claims,
    },
    quality: {
      confidence: quality.confidence,
      coverageLabel: quality.coverageLabel,
      independentSources: quality.independent,
      exactCount: R.places.exact.length,
      unverifiedCount: R.places.unverified.length,
      relatedCount: R.places.related.length,
      citedClaims: a.claimsCited,
      unsupportedClaims: a.claimsUnsupported,
      avgAuthority: Math.round(quality.avgAuthority * 100) / 100,
      sourceDiversity: quality.independent,
    },
    coverage: R.coverage,
    federation,
    widening,
    timings,
    usage: {
      search_requests: 1,
      sources_read: R.docs.length,
      places_scanned: R.places.exact.length + R.places.unverified.length + R.places.related.length,
      providers_called: federation.filter((f) => f.status === "ok" || f.status === "empty").length,
    },
  };
}

export async function runPipeline(query: string, opts: RunOptions = {}): Promise<VietScopeResponse> {
  return toResponse(await analyze(query, opts), query, opts);
}
