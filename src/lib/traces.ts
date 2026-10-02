// ---------------------------------------------------------------------------
// VietScope · Training traces (§11) — thu vết chất lượng cao để sau này dựng
// VietScope Instruction / Retrieval / Tool-Use / Citation Dataset.
// Mỗi trace giữ đủ chuỗi: query → intent → retrieval plan → providers chosen →
// candidates → reranking → evidence → final answer → citations → verification.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { searchTraces } from "@/db/schema";
import { redactQuery } from "@/lib/telemetry";
import { desc, sql } from "drizzle-orm";
import type { RetrieveResult } from "@/core/contract";
import type { AnswerResult } from "./answer";
import type { Verification } from "./evidence";

export interface TraceInput {
  retrieval: RetrieveResult;
  /** vắng mặt với các route retrieve-only (không synthesis) */
  a?: AnswerResult;
  verification?: Verification;
  synthesizer: string;
  confidence: number;
  coverageLabel: string;
  timings: Record<string, number>;
  llmUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

export async function recordTrace(t: TraceInput): Promise<string | null> {
  const { retrieval: R, a, verification, timings } = t;
  const u = R.understanding;
  const gap = R.coverage.gap || (u.intent === "local_search" ? R.places.exact.length === 0 : R.docs.length === 0);
  try {
    const [row] = await db
      .insert(searchTraces)
      .values({
        query: u.raw,
        querySafe: redactQuery(u.raw),
        normalized: u.normalized,
        intent: u.intent,
        locationId: u.locations[0]?.id ?? null,
        specialty: u.specialty,
        resultsTotal: R.places.exact.length + R.places.unverified.length + R.docs.length,
        exactCount: R.places.exact.length,
        relatedCount: R.places.related.length,
        coverageGap: gap,
        budget: R.budget.name,
        synthesizer: t.synthesizer,
        verifiedRatio: verification?.verifiedRatio ?? null,
        confidence: t.confidence,
        latencyMs: timings.total_ms ?? null,
        timingsMs: timings,
        trace: {
          // 0) backend nào đã trả lời — dataset huấn luyện phải biết nguồn gốc của vết
          backend: R.backend,
          // 1) query → intent
          query: u.raw,
          normalized: u.normalized,
          intent: u.intent,
          specialty: u.specialty,
          categories: u.categories,
          freshness: u.freshness,
          fuzzy: u.fuzzy,
          // 2) entity / địa giới
          entities: {
            locations: u.locations.map((l) => ({ id: l.id, name: l.name, status: l.status, fuzzy: l.fuzzy })),
            transition: u.transition,
            resolved_current_ids: u.resolvedCurrentIds,
            compare_targets: u.compareTargets,
          },
          // 3) retrieval plan + providers chosen
          plan: { budget: R.budget.name, reason: R.budget.reason, multi_hop: R.budget.multiHop, read_evidence: R.budget.readEvidence },
          providers: R.federation,
          widening: R.widening,
          // 4) candidates + reranking
          candidates: {
            places_exact: R.places.exact.map((p) => ({ id: p.id, name: p.name, score: p.score, verified: p.verified, why: p.why })),
            places_unverified: R.places.unverified.map((p) => ({ id: p.id, name: p.name, score: p.score })),
            places_related: R.places.related.map((p) => ({ id: p.id, name: p.name, score: p.score })),
            flywheel_candidates: R.places.candidates.map((c) => ({ id: c.id, name: c.name })),
            docs: R.docs.map((d) => ({ url: d.url, domain: d.domain, score: d.score, authority: d.authority, origin: d.origin })),
          },
          // 5) evidence → answer → citations → verification (chỉ khi có synthesis)
          answer: a ? { mode: a.mode, headline: a.headline, blocks: a.blocks } : null,
          sources: a ? a.sources.map((s) => ({ n: s.n, url: s.url, domain: s.domain, source_type: s.sourceType, authority: s.authority })) : [],
          verification: verification
            ? {
                verified_ratio: verification.verifiedRatio,
                citation_precision: verification.citationPrecision,
                citation_coverage: verification.citationCoverage,
                claims: verification.claims.map((c) => ({
                  claim_id: c.claimId,
                  status: c.status,
                  block: c.blockIndex,
                  supported: c.supported,
                  via: c.via,
                  score: c.score,
                  source: c.source,
                  passage: c.passage ? { start: c.passage.start, end: c.passage.end } : null,
                })),
              }
            : null,
          quality: { confidence: t.confidence, coverage: t.coverageLabel },
          llm_usage: t.llmUsage ?? null,
          timings,
        },
      })
      .returning({ id: searchTraces.id });
    return row?.id ?? null;
  } catch (e) {
    console.error("trace log failed", e);
    return null;
  }
}

/** Thống kê vết — dùng cho /v1/traces và dashboard flywheel */
export async function traceStats() {
  const [agg] = await db
    .select({
      total: sql<number>`count(*)`,
      gaps: sql<number>`count(*) filter (where coverage_gap)`,
      avg_ms: sql<number>`avg(latency_ms)`,
      avg_conf: sql<number>`avg(confidence)`,
      avg_verified: sql<number>`avg(verified_ratio)`,
    })
    .from(searchTraces);
  const byIntent = await db
    .select({ intent: searchTraces.intent, n: sql<number>`count(*)` })
    .from(searchTraces)
    .groupBy(searchTraces.intent);
  return {
    total: Number(agg?.total ?? 0),
    coverage_gaps: Number(agg?.gaps ?? 0),
    avg_latency_ms: Math.round(Number(agg?.avg_ms ?? 0)),
    avg_confidence: Math.round(Number(agg?.avg_conf ?? 0) * 1000) / 1000,
    avg_verified_ratio: Math.round(Number(agg?.avg_verified ?? 0) * 1000) / 1000,
    by_intent: byIntent.map((r) => ({ intent: r.intent, count: Number(r.n) })),
  };
}

/** Xuất vết để dựng dataset huấn luyện VietScope-LM (§11) */
export async function exportTraces(limit = 100, onlyWithFeedback = false) {
  const rows = await db.select().from(searchTraces).orderBy(desc(searchTraces.createdAt)).limit(Math.min(500, limit));
  return onlyWithFeedback ? rows.filter((r) => r.trace != null) : rows;
}
