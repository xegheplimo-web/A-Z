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
import { INTENTS } from "@/core/contract";
import { analyze } from "@/lib/pipeline";
import { haversineKm, normalize } from "@/lib/vi";
import { and, desc, eq, inArray } from "drizzle-orm";

export const GOLDEN_STATUSES = ["draft", "labeled", "approved", "promoted", "superseded"] as const;
export type GoldenStatus = (typeof GOLDEN_STATUSES)[number];
export const BENCHMARK_STATUSES: readonly GoldenStatus[] = ["approved", "promoted"];

// ---------------------------------------------------------------------------
// VN100-0 Label Contract v1 — FROZEN.
// Vocabulary khóa trước khi nhân dataset; đổi = bump contract + migrate, không
// sửa lặt vặt. docs/VN100-LABEL-CONTRACT.md là tài liệu đối chiếu.
// ---------------------------------------------------------------------------

/** Thang freshness yêu cầu — về tốc độ truth thay đổi, không phải freshness query. */
export const GOLDEN_FRESHNESS = ["static", "slow", "medium", "high", "realtime"] as const;
export type GoldenFreshness = (typeof GOLDEN_FRESHNESS)[number];
/** Alias legacy — normalize ngay lúc ghi, không cho vào storage. */
const FRESHNESS_ALIASES: Record<string, GoldenFreshness> = { current: "high" };

/** Rung tối thiểu trên verification ladder (observed<corroborated<verified<authoritative). "any" = không yêu cầu. */
export const GOLDEN_AUTHORITY = ["any", "observed_or_better", "corroborated_or_better", "verified_or_better", "authoritative"] as const;
export type GoldenAuthority = (typeof GOLDEN_AUTHORITY)[number];

/** relevance_labels grade 0..3 — 3 exact-correct · 2 relevant-partial · 1 related-only · 0 irrelevant/harmful. */
export const GOLDEN_RELEVANCE_GRADES = [0, 1, 2, 3] as const;

/** geo_scope v1: admin_ids HOẶC anchor+radius_m (query "gần X"). Có thể kết hợp. */
export interface GoldenGeoScope {
  admin_ids?: string[];
  anchor?: { label?: string; lat?: number; lng?: number };
  radius_m?: number;
}

const VERIFICATION_RANK: Record<string, number> = { observed: 0, corroborated: 1, verified: 2, authoritative: 3 };
const AUTHORITY_MIN_RANK: Record<GoldenAuthority, number> = {
  any: -1,
  observed_or_better: 0,
  corroborated_or_better: 1,
  verified_or_better: 2,
  authoritative: 3,
};

export interface GoldenLabels {
  intent?: string | null;
  geoScope?: GoldenGeoScope | null;
  specialty?: string | null;
  expectedEntities?: string[] | null;
  relevanceLabels?: Record<string, number> | null;
  freshnessRequirement?: string | null;
  authorityRequirement?: string | null;
  abstentionExpected?: boolean | null;
  reviewNote?: string | null;
}

/** Validate HÌNH DẠNG + vocabulary ngay lúc ghi — dữ liệu xấu không bao giờ vào bảng. */
export function validateGoldenLabels(labels: GoldenLabels): string[] {
  const err: string[] = [];
  if (labels.intent != null && labels.intent.trim() !== "" && !(INTENTS as readonly string[]).includes(labels.intent.trim())) {
    err.push(`intent '${labels.intent}' không thuộc contract (${INTENTS.join("|")})`);
  }
  if (labels.freshnessRequirement != null && labels.freshnessRequirement.trim() !== "") {
    const f = labels.freshnessRequirement.trim();
    if (!(GOLDEN_FRESHNESS as readonly string[]).includes(f) && !(f in FRESHNESS_ALIASES)) {
      err.push(`freshness '${f}' ngoài enum (${GOLDEN_FRESHNESS.join("|")})`);
    }
  }
  if (labels.authorityRequirement != null && labels.authorityRequirement.trim() !== "" &&
      !(GOLDEN_AUTHORITY as readonly string[]).includes(labels.authorityRequirement.trim())) {
    err.push(`authority '${labels.authorityRequirement}' ngoài enum (${GOLDEN_AUTHORITY.join("|")})`);
  }
  const g = labels.geoScope;
  if (g != null) {
    if (g.admin_ids != null && (!Array.isArray(g.admin_ids) || g.admin_ids.some((a) => typeof a !== "string" || !a.trim()))) {
      err.push("geo_scope.admin_ids phải là mảng string không rỗng");
    }
    if (g.anchor != null) {
      const a = g.anchor;
      const hasLabel = typeof a.label === "string" && a.label.trim() !== "";
      const hasCoords = typeof a.lat === "number" && typeof a.lng === "number" &&
        a.lat >= -90 && a.lat <= 90 && a.lng >= -180 && a.lng <= 180;
      if (!hasLabel && !hasCoords) err.push("geo_scope.anchor cần label hoặc lat+lng hợp lệ");
      if (!hasLabel && hasCoords === false && (a.lat != null || a.lng != null)) {
        err.push("geo_scope.anchor lat/lng không hợp lệ");
      }
    }
    if (g.radius_m != null) {
      if (typeof g.radius_m !== "number" || !Number.isFinite(g.radius_m) || g.radius_m <= 0) {
        err.push("geo_scope.radius_m phải là số > 0");
      } else if (g.anchor == null) {
        err.push("geo_scope.radius_m chỉ có nghĩa kèm anchor");
      }
    }
  }
  if (labels.expectedEntities != null) {
    if (!Array.isArray(labels.expectedEntities) || labels.expectedEntities.some((e) => typeof e !== "string" || !e.trim())) {
      err.push("expected_entities phải là mảng string không rỗng");
    } else if (labels.abstentionExpected === true && labels.expectedEntities.length > 0) {
      err.push("abstention_expected=true mâu thuẫn expected_entities không rỗng");
    }
  }
  if (labels.relevanceLabels != null) {
    if (typeof labels.relevanceLabels !== "object" || Array.isArray(labels.relevanceLabels)) {
      err.push("relevance_labels phải là object {entity: grade}");
    } else {
      for (const [k, v] of Object.entries(labels.relevanceLabels)) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 3) {
          err.push(`relevance_labels['${k}']=${v} ngoài thang 0..3`);
        }
      }
    }
  }
  return err;
}

/** Normalize label input trước khi ghi — alias → canonical. */
function normalizeLabels(labels: GoldenLabels): GoldenLabels {
  const f = labels.freshnessRequirement?.trim();
  return { ...labels, freshnessRequirement: f ? (FRESHNESS_ALIASES[f] ?? f) : f };
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

/** Canonical freshness đã ghi — "current" không tồn tại trong storage sau freeze. */
function canonicalFreshness(f: string | null): string | null {
  if (!f) return f;
  const t = f.trim();
  return FRESHNESS_ALIASES[t] ?? t;
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

/** draft|labeled → labeled. Labels phải đúng vocabulary VN100-0 — reject tại đây, không để dữ liệu xấu vào bảng. */
export async function setGoldenLabels(id: string, input: GoldenLabels, actor?: string) {
  const [c] = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, id)).limit(1);
  if (!c) throw new Error("candidate không tồn tại");
  if (c.status !== "draft" && c.status !== "labeled") {
    throw new Error(`không sửa label được ở status '${c.status}' — dùng revise để tạo version mới`);
  }
  const invalid = validateGoldenLabels(input);
  if (invalid.length) throw new Error(`label vi phạm VN100-0 contract: ${invalid.join("; ")}`);
  const labels = normalizeLabels(input);
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
  const invalid = validateGoldenLabels({
    intent: c.intent,
    geoScope: c.geoScope as GoldenGeoScope | null,
    expectedEntities: c.expectedEntities as string[] | null,
    relevanceLabels: c.relevanceLabels as Record<string, number> | null,
    freshnessRequirement: canonicalFreshness(c.freshnessRequirement),
    authorityRequirement: c.authorityRequirement,
    abstentionExpected: c.abstentionExpected,
  });
  if (invalid.length) throw new Error(`label vi phạm VN100-0 contract: ${invalid.join("; ")}`);
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
export async function reviseGoldenCandidate(id: string, input: GoldenLabels, actor?: string) {
  const [c] = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, id)).limit(1);
  if (!c) throw new Error("candidate không tồn tại");
  if (c.status !== "approved" && c.status !== "promoted") {
    throw new Error(`revise chỉ áp dụng cho approved/promoted — hiện '${c.status}' (draft/labeled sửa trực tiếp)`);
  }
  const invalid = validateGoldenLabels(input);
  if (invalid.length) throw new Error(`label vi phạm VN100-0 contract: ${invalid.join("; ")}`);
  const labels = normalizeLabels(input);
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
// Assert theo VN100-0 Label Contract v1 (docs/VN100-LABEL-CONTRACT.md).

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

    // geo_scope: admin_ids → resolvedCurrentIds; anchor → retrieval.anchor; radius_m → khoảng cách places.
    const geo = (c.geo_scope as GoldenGeoScope | null) ?? {};
    for (const g of geo.admin_ids ?? []) {
      if (!u.resolvedCurrentIds.includes(g)) { fail(`thiếu admin ${g} trong resolved`); ok = false; }
    }
    const anchor = x.retrieval.anchor;
    if (geo.anchor) {
      if (!anchor) {
        fail("geo_scope.anchor mong đợi nhưng response không có anchor");
        ok = false;
      } else {
        if (geo.anchor.label && !normalize(anchor.label).includes(normalize(geo.anchor.label))) {
          fail(`anchor='${anchor.label}', mong đợi '${geo.anchor.label}'`); ok = false;
        }
        if (typeof geo.anchor.lat === "number" && typeof geo.anchor.lng === "number" &&
            haversineKm(anchor.lat, anchor.lng, geo.anchor.lat, geo.anchor.lng) > 1) {
          fail(`anchor lệch >1km so với mong đợi`); ok = false;
        }
      }
    }
    const places = [...x.retrieval.places.exact, ...x.retrieval.places.unverified];
    if (typeof geo.radius_m === "number" && anchor) {
      for (const p of places) {
        const dKm = p.distanceKm ?? (p.lat != null && p.lng != null ? haversineKm(anchor.lat, anchor.lng, p.lat, p.lng) : null);
        if (dKm != null && dKm * 1000 > geo.radius_m) {
          fail(`place '${p.name}' ngoài radius_m=${geo.radius_m} (d=${Math.round(dKm * 1000)}m)`); ok = false;
        }
      }
    }

    if (c.specialty && u.specialty !== c.specialty) { fail(`specialty=${u.specialty ?? "∅"}, mong đợi ${c.specialty}`); ok = false; }
    if (c.abstention_expected && x.retrieval.places.exact.length > 0) {
      fail(`abstention mong đợi nhưng có ${x.retrieval.places.exact.length} exact`);
      ok = false;
    }
    const names = places.map((p) => normalize(p.name));
    const exactNames = x.retrieval.places.exact.map((p) => normalize(p.name));
    for (const e of (c.expected_entities as string[] | null) ?? []) {
      const ne = normalize(e);
      if (!names.some((n) => n.includes(ne))) { fail(`thiếu entity '${e}'`); ok = false; }
    }
    // relevance_labels: grade 3 → phải trong exact · 2 → exact∪unverified · ≤1 → không được trong exact.
    for (const [entity, grade] of Object.entries((c.relevance_labels as Record<string, number> | null) ?? {})) {
      const ne = normalize(entity);
      const inExact = exactNames.some((n) => n.includes(ne));
      const inAny = names.some((n) => n.includes(ne));
      if (grade >= 3 && !inExact) { fail(`relevance 3 '${entity}' không có trong exact`); ok = false; }
      else if (grade === 2 && !inAny) { fail(`relevance 2 '${entity}' không có trong exact∪unverified`); ok = false; }
      else if (grade <= 1 && inExact) { fail(`relevance ${grade} '${entity}' lại nằm trong exact`); ok = false; }
    }
    // authority_requirement: rung tối thiểu trên verification ladder cho mọi exact place.
    const minRank = AUTHORITY_MIN_RANK[(c.authority_requirement ?? "any") as GoldenAuthority] ?? -1;
    if (minRank >= 0) {
      for (const p of x.retrieval.places.exact) {
        const lvl = p.verificationLevel ?? "observed";
        if ((VERIFICATION_RANK[lvl] ?? 0) < minRank) {
          fail(`exact '${p.name}' verification=${lvl} < ${c.authority_requirement}`); ok = false;
        }
      }
    }
    // freshness_requirement: realtime/high → brain phải resolve freshness cụ thể.
    if ((c.freshness_requirement === "realtime" || c.freshness_requirement === "high") && u.freshness === "any") {
      fail(`freshness_requirement=${c.freshness_requirement} nhưng brain freshness=any`); ok = false;
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
