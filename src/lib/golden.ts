// ---------------------------------------------------------------------------
// VietScope · P-LEARNING-6 — Golden Promotion
//
//   bad_search_reviews.confirmed_bad   (chỉ đề cử — không phải ground truth)
//       ↓ createGoldenCandidate (snapshot evidence từ search_traces)
//   golden_candidates draft → labeled → approved → promoted
//                                            ↑
//                              chỉ lúc này review mới thành promoted_to_golden
//       ↓ exportGoldenBenchmark / runGoldenEval (record:false) → eval_runs
//
//   golden_candidate_events — append-only audit, không UPDATE/DELETE.
//
// Invariants:
//   • chỉ review `confirmed_bad` tạo được candidate
//   • approve khi thiếu label bắt buộc → reject
//   • sửa approved/promoted → version mới + cũ → superseded (không overwrite)
//   • benchmark/export chỉ đọc approved+promoted
//   • reviewed_good / ignored / open không bao giờ vào golden dataset
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { badSearchReviews, evalRuns, goldenCandidateEvents, goldenCandidates, searchTraces } from "@/db/schema";
import { analyze } from "@/lib/pipeline";
import { normalize } from "@/lib/vi";
import { and, desc, eq, inArray } from "drizzle-orm";

export const GOLDEN_STATUSES = ["draft", "labeled", "approved", "promoted", "superseded"] as const;
export type GoldenStatus = (typeof GOLDEN_STATUSES)[number];
export const BENCHMARK_STATUSES: readonly GoldenStatus[] = ["approved", "promoted"];

export interface GoldenLabels {
  intent?: string | null;
  geoScope?: { admin_ids?: string[] } | null;
  specialty?: string | null;
  expectedEntities?: string[] | null;
  relevanceLabels?: Record<string, number> | null;
  freshnessRequirement?: string | null;
  authorityRequirement?: string | null;
  abstentionExpected?: boolean | null;
  reviewNote?: string | null;
}

function missingRequiredLabels(c: {
  intent: string | null;
  freshnessRequirement: string | null;
  authorityRequirement: string | null;
  abstentionExpected: boolean;
  expectedEntities: unknown;
}): string[] {
  const miss: string[] = [];
  if (!c.intent?.trim()) miss.push("intent");
  if (!c.freshnessRequirement?.trim()) miss.push("freshness_requirement");
  if (!c.authorityRequirement?.trim()) miss.push("authority_requirement");
  if (!c.abstentionExpected && !(Array.isArray(c.expectedEntities) && c.expectedEntities.length > 0)) {
    miss.push("expected_entities hoặc abstention_expected");
  }
  return miss;
}

async function emit(candidateId: string, eventType: string, payload?: unknown, actor = "ops") {
  await db.insert(goldenCandidateEvents).values({ candidateId, eventType, actor, payload });
}

/** Evidence tối thiểu từ trace gần nhất của query — trace JSONB sẽ bị retention drop. */
async function evidenceSnapshot(querySafe: string) {
  const [t] = await db
    .select({
      id: searchTraces.id,
      intent: searchTraces.intent,
      resultsTotal: searchTraces.resultsTotal,
      exactCount: searchTraces.exactCount,
      coverageGap: searchTraces.coverageGap,
      confidence: searchTraces.confidence,
      latencyMs: searchTraces.latencyMs,
      createdAt: searchTraces.createdAt,
    })
    .from(searchTraces)
    .where(eq(searchTraces.querySafe, querySafe))
    .orderBy(desc(searchTraces.createdAt))
    .limit(1);
  if (!t) return { trace_id: null };
  return {
    trace_id: t.id,
    intent: t.intent,
    results_total: t.resultsTotal,
    exact_count: t.exactCount,
    coverage_gap: t.coverageGap,
    confidence: t.confidence,
    latency_ms: t.latencyMs,
    searched_at: t.createdAt?.toISOString?.() ?? null,
  };
}

/** confirmed_bad → draft candidate. Một query_safe = một candidate đang sống. */
export async function createGoldenCandidate(input: { querySafe: string; actor?: string }) {
  const querySafe = input.querySafe.trim();
  const [review] = await db
    .select()
    .from(badSearchReviews)
    .where(eq(badSearchReviews.querySafe, querySafe))
    .limit(1);
  if (!review) throw new Error("chưa có human review cho query này — telemetry score không đủ");
  if (review.status !== "confirmed_bad") {
    throw new Error(`review status '${review.status}' không được tạo candidate — chỉ confirmed_bad`);
  }
  const [active] = await db
    .select({ id: goldenCandidates.id, status: goldenCandidates.status })
    .from(goldenCandidates)
    .where(and(eq(goldenCandidates.querySafe, querySafe), inArray(goldenCandidates.status, ["draft", "labeled", "approved", "promoted"])))
    .limit(1);
  if (active) throw new Error(`query đã có candidate đang sống (${active.status})`);

  const snap = await evidenceSnapshot(querySafe);
  const [row] = await db
    .insert(goldenCandidates)
    .values({
      reviewId: review.id,
      traceId: snap.trace_id ?? null,
      querySafe,
      status: "draft",
      evidenceSnapshot: snap,
      reviewNote: review.note,
    })
    .returning();
  await emit(row.id, "candidate_created", { review_id: review.id, snapshot: snap }, input.actor);
  return row;
}

/** draft|labeled → labeled. Labels được ghi nguyên trạng (đã redacted ở form/query_safe). */
export async function setGoldenLabels(id: string, labels: GoldenLabels, actor?: string) {
  const [c] = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, id)).limit(1);
  if (!c) throw new Error("candidate không tồn tại");
  if (c.status !== "draft" && c.status !== "labeled") {
    throw new Error(`không sửa label được ở status '${c.status}' — dùng revise để tạo version mới`);
  }
  const [row] = await db
    .update(goldenCandidates)
    .set({
      intent: labels.intent?.trim() || null,
      geoScope: labels.geoScope ?? null,
      specialty: labels.specialty?.trim() || null,
      expectedEntities: labels.expectedEntities ?? null,
      relevanceLabels: labels.relevanceLabels ?? null,
      freshnessRequirement: labels.freshnessRequirement?.trim() || null,
      authorityRequirement: labels.authorityRequirement?.trim() || null,
      abstentionExpected: labels.abstentionExpected ?? false,
      reviewNote: labels.reviewNote?.trim() || c.reviewNote,
      status: "labeled",
      labeledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(goldenCandidates.id, id))
    .returning();
  await emit(id, "labeled", labels, actor);
  return row;
}

/** labeled → approved. Thiếu label bắt buộc → reject. */
export async function approveGoldenCandidate(id: string, actor?: string) {
  const [c] = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, id)).limit(1);
  if (!c) throw new Error("candidate không tồn tại");
  if (c.status !== "labeled") throw new Error(`approve chỉ từ 'labeled' — hiện '${c.status}'`);
  const miss = missingRequiredLabels(c);
  if (miss.length) throw new Error(`thiếu label bắt buộc: ${miss.join(", ")}`);
  const [row] = await db
    .update(goldenCandidates)
    .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(goldenCandidates.id, id))
    .returning();
  await emit(id, "approved", { labels_ok: true }, actor);
  return row;
}

/** approved → promoted. ĐỒNG THỜI review gốc → promoted_to_golden (terminal). */
export async function promoteGoldenCandidate(id: string, actor?: string) {
  const [c] = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, id)).limit(1);
  if (!c) throw new Error("candidate không tồn tại");
  if (c.status !== "approved") throw new Error(`promote chỉ từ 'approved' — hiện '${c.status}'`);
  const [row] = await db
    .update(goldenCandidates)
    .set({ status: "promoted", promotedAt: new Date(), updatedAt: new Date() })
    .where(eq(goldenCandidates.id, id))
    .returning();
  if (c.reviewId) {
    await db
      .update(badSearchReviews)
      .set({ status: "promoted_to_golden", updatedAt: new Date() })
      .where(eq(badSearchReviews.id, c.reviewId));
  }
  await emit(id, "promoted", { review_id: c.reviewId }, actor);
  return row;
}

/** Sửa approved/promoted → cũ superseded, version+1 ở 'labeled' (đi tiếp approve). */
export async function reviseGoldenCandidate(id: string, labels: GoldenLabels, actor?: string) {
  const [c] = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, id)).limit(1);
  if (!c) throw new Error("candidate không tồn tại");
  if (c.status !== "approved" && c.status !== "promoted") {
    throw new Error(`revise chỉ áp dụng cho approved/promoted — hiện '${c.status}' (draft/labeled sửa trực tiếp)`);
  }
  const miss = missingRequiredLabels({
    intent: labels.intent ?? null,
    freshnessRequirement: labels.freshnessRequirement ?? null,
    authorityRequirement: labels.authorityRequirement ?? null,
    abstentionExpected: labels.abstentionExpected ?? false,
    expectedEntities: labels.expectedEntities ?? null,
  });
  if (miss.length) throw new Error(`thiếu label bắt buộc: ${miss.join(", ")}`);

  await db
    .update(goldenCandidates)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(eq(goldenCandidates.id, id));
  await emit(id, "superseded", { by: "revision" }, actor);

  const [row] = await db
    .insert(goldenCandidates)
    .values({
      reviewId: c.reviewId,
      traceId: c.traceId,
      querySafe: c.querySafe,
      version: c.version + 1,
      supersedesId: c.id,
      status: "labeled",
      evidenceSnapshot: c.evidenceSnapshot,
      intent: labels.intent?.trim() || null,
      geoScope: labels.geoScope ?? null,
      specialty: labels.specialty?.trim() || null,
      expectedEntities: labels.expectedEntities ?? null,
      relevanceLabels: labels.relevanceLabels ?? null,
      freshnessRequirement: labels.freshnessRequirement?.trim() || null,
      authorityRequirement: labels.authorityRequirement?.trim() || null,
      abstentionExpected: labels.abstentionExpected ?? false,
      reviewNote: labels.reviewNote?.trim() || c.reviewNote,
      labeledAt: new Date(),
    })
    .returning();
  await emit(row.id, "candidate_created", { supersedes_id: c.id, version: c.version + 1 }, actor);
  await emit(row.id, "labeled", labels, actor);
  return row;
}

export async function listGoldenCandidates() {
  return db.select().from(goldenCandidates).orderBy(desc(goldenCandidates.updatedAt)).limit(200);
}

/** Benchmark cases = chỉ approved + promoted. */
export async function exportGoldenBenchmark() {
  const rows = await db
    .select()
    .from(goldenCandidates)
    .where(inArray(goldenCandidates.status, [...BENCHMARK_STATUSES]))
    .orderBy(goldenCandidates.querySafe);
  return rows.map((c) => ({
    id: c.id,
    version: c.version,
    query: c.querySafe,
    intent: c.intent,
    geo_scope: c.geoScope,
    specialty: c.specialty,
    expected_entities: c.expectedEntities,
    relevance_labels: c.relevanceLabels,
    freshness_requirement: c.freshnessRequirement,
    authority_requirement: c.authorityRequirement,
    abstention_expected: c.abstentionExpected,
    provenance: { review_id: c.reviewId, trace_id: c.traceId, evidence: c.evidenceSnapshot },
  }));
}

// --- benchmark runner -------------------------------------------------------
// Chạy case qua pipeline thật với record:false — không làm bẩn telemetry.

const VERIFICATION_RANK: Record<string, number> = { observed: 0, corroborated: 1, verified: 2, authoritative: 3 };

export async function runGoldenEval(opts: { name?: string; actor?: string } = {}) {
  const cases = await exportGoldenBenchmark();
  const failures: { id: string; query: string; reason: string }[] = [];
  const latencies: number[] = [];
  let pass = 0;

  for (const c of cases) {
    const t0 = performance.now();
    const x = await analyze(c.query, { log: false });
    latencies.push(performance.now() - t0);
    const u = x.retrieval.understanding;
    const fail = (reason: string) => failures.push({ id: c.id, query: c.query, reason });

    let ok = true;
    if (c.intent && u.intent !== c.intent) { fail(`intent=${u.intent}, mong đợi ${c.intent}`); ok = false; }
    const wantGeo = (c.geo_scope as { admin_ids?: string[] } | null)?.admin_ids ?? [];
    for (const g of wantGeo) {
      if (!u.resolvedCurrentIds.includes(g)) { fail(`thiếu admin ${g} trong resolved`); ok = false; }
    }
    if (c.specialty && u.specialty !== c.specialty) { fail(`specialty=${u.specialty ?? "∅"}, mong đợi ${c.specialty}`); ok = false; }
    const places = [...x.retrieval.places.exact, ...x.retrieval.places.unverified];
    if (c.abstention_expected && x.retrieval.places.exact.length > 0) {
      fail(`abstention mong đợi nhưng có ${x.retrieval.places.exact.length} exact`);
      ok = false;
    }
    const names = places.map((p) => normalize(p.name));
    for (const e of (c.expected_entities as string[] | null) ?? []) {
      const ne = normalize(e);
      if (!names.some((n) => n.includes(ne))) { fail(`thiếu entity '${e}'`); ok = false; }
    }
    if (c.authority_requirement === "corroborated_or_better") {
      for (const p of x.retrieval.places.exact) {
        const lvl = (p as { verification_level?: string }).verification_level ?? "observed";
        if ((VERIFICATION_RANK[lvl] ?? 0) < 1) { fail(`exact '${p.name}' verification=${lvl} < corroborated`); ok = false; }
      }
    }
    if (ok) pass++;
  }

  const pct = (arr: number[], p: number) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  };
  const metrics = {
    pass_rate: cases.length ? Math.round((pass / cases.length) * 1000) / 1000 : 0,
    passed: pass,
    total: cases.length,
    p50_ms: Math.round(pct(latencies, 50)),
    p95_ms: Math.round(pct(latencies, 95)),
    failures,
  };
  const name = opts.name ?? `golden-promoted-${cases.length} · vietscope-1`;
  await db.insert(evalRuns).values({ name, suite: "golden-promoted", queryCount: cases.length, metrics });
  return { metrics, queryCount: cases.length, name };
}
