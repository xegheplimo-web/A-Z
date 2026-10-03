// ---------------------------------------------------------------------------
// VietScope · Search Quality Analytics (P-LEARNING-4)
//
// Aggregate-only đọc từ telemetry đã có — không thêm event/table mới:
//   search_traces      → volume, zero/low/exact, latency, coverage-gap rate
//   search_interactions → CTR@k (trên impression THẬT), reformulation,
//                         source/map open
//   feedback            → negative-feedback rate
//   coverage_signals    → top coverage gaps (qua backend.coverage() — sống
//                         trong retrieval brain, không đọc thẳng DB)
//
// CTR@k = clicked rank<=k / impressed rank<=k — click-only sẽ sai khi người
// dùng chưa scroll tới kết quả. Click ngầm kéo theo impression (click ⇒
// impression): user có thể click trước khi timer viewport 400ms kịp ghi,
// nên tập "impressed" là impression ∪ click → CTR không thể vượt 100%.
// Dedup (trace_id, result_id, kind) ở tầng analytics vì client có thể gửi
// lại impression trong edge case.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { badSearchReviews } from "@/db/schema";
import { requireCapability } from "@/core/backend";
import type { BadSearchReviewStatus } from "@/lib/bad-search-reviews";
import { inArray, sql } from "drizzle-orm";

export interface QualityReport {
  windowHours: number;
  searches: number;
  zeroResultRate: number;
  lowResultRate: number;
  exactLocalRate: number | null; // null khi không có local search
  reformulationRate: number;
  reformulationLowQualityRate: number;
  ctr: { at1: number | null; at3: number | null; at5: number | null };
  sourceOpenRate: number;
  negativeFeedbackRate: number;
  coverageGapRate: number;
  latency: { p50: number | null; p95: number | null };
  byIntent: { intent: string; count: number }[];
  badSearches: BadSearch[];
  coverageGaps: unknown[];
}

export interface BadSearch {
  query: string;
  searches: number;
  zeroResult: number;
  reformulated: number;
  negativeFeedback: number;
  score: number;
  reviewStatus: BadSearchReviewStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
}

export async function qualityReport(hours = 24): Promise<QualityReport> {
  const h = Math.min(720, Math.max(1, hours));

  const [traceAgg, interactAgg, reformAgg, intentRows, badRows, fbAgg] = await Promise.all([
    // --- trace volume + chất lượng + latency ---
    db.execute(sql`
      SELECT count(*) AS searches,
             count(*) FILTER (WHERE results_total = 0) AS zero,
             count(*) FILTER (WHERE results_total > 0 AND results_total < 3) AS low,
             count(*) FILTER (WHERE intent = 'local_search') AS local_total,
             count(*) FILTER (WHERE intent = 'local_search' AND exact_count > 0) AS exact_local,
             count(*) FILTER (WHERE coverage_gap) AS gaps,
             percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
        FROM search_traces
       WHERE created_at > now() - make_interval(hours => ${h})`),
    // --- interaction dedup (trace_id, result_id, kind) ---
    db.execute(sql`
      WITH ded AS (
        SELECT DISTINCT trace_id, result_id, kind, rank
          FROM search_interactions
         WHERE created_at > now() - make_interval(hours => ${h})
      ),
      -- click ⇒ impression: kết quả bị click coi như đã lọt viewport
      imp AS (
        SELECT DISTINCT trace_id, result_id, rank FROM ded
         WHERE kind IN ('impression', 'click')
      )
      SELECT
        (SELECT count(*) FROM imp WHERE rank <= 1) AS imp1,
        (SELECT count(*) FROM imp WHERE rank <= 3) AS imp3,
        (SELECT count(*) FROM imp WHERE rank <= 5) AS imp5,
        (SELECT count(*) FROM ded WHERE kind = 'click' AND rank <= 1) AS clk1,
        (SELECT count(*) FROM ded WHERE kind = 'click' AND rank <= 3) AS clk3,
        (SELECT count(*) FROM ded WHERE kind = 'click' AND rank <= 5) AS clk5,
        (SELECT count(DISTINCT trace_id) FROM ded WHERE kind = 'reformulate') AS reform_traces,
        (SELECT count(DISTINCT trace_id) FROM ded WHERE kind = 'source_open') AS src_open_traces,
        (SELECT count(*) FROM ded WHERE kind = 'map_open') AS map_open,
        (SELECT count(*) FROM ded WHERE kind = 'click') AS clicks`),
    // --- reformulation sau search chất lượng thấp ---
    // Reformulate event gắn vào trace MỚI; query cũ nằm ở meta.from (đã
    // redacted) → join về trace cũ qua query_safe trong cửa sổ 15s.
    db.execute(sql`
      SELECT count(*) AS reform_low
        FROM search_interactions i
       WHERE i.kind = 'reformulate'
         AND i.created_at > now() - make_interval(hours => ${h})
         AND EXISTS (
           SELECT 1 FROM search_traces t
            WHERE t.created_at BETWEEN i.created_at - interval '15 seconds' AND i.created_at
              AND t.query_safe = i.meta->>'from'
              AND (t.results_total = 0 OR t.coverage_gap)
         )`),
    db.execute(sql`
      SELECT intent, count(*) AS n
        FROM search_traces
       WHERE created_at > now() - make_interval(hours => ${h})
       GROUP BY intent ORDER BY n DESC`),
    // --- Bad Search Queue: scoring trên telemetry, group theo query_safe ---
    db.execute(sql`
      WITH flags AS (
        SELECT t.id, coalesce(t.query_safe, t.normalized) AS q,
               (t.results_total = 0) AS zero,
               t.coverage_gap AS gap,
               (t.latency_ms > 3000) AS slow,
               -- Chỉ phạt query CŨ bị bỏ (user rời đi). Trace mới mang event
               -- 'reformulate' là câu người dùng sửa lại — không phải lỗi.
               EXISTS (SELECT 1 FROM search_interactions i
                        WHERE i.kind = 'reformulate' AND i.meta->>'from' = coalesce(t.query_safe, t.normalized)
                          AND i.created_at BETWEEN t.created_at AND t.created_at + interval '30 seconds') AS reformulated,
               EXISTS (SELECT 1 FROM feedback f WHERE f.trace_id = t.id AND f.verdict = 'bad') AS neg_fb,
               NOT EXISTS (SELECT 1 FROM search_interactions i
                            WHERE i.trace_id = t.id
                              AND i.kind IN ('click','source_open','map_open','call')) AS no_click,
               EXISTS (SELECT 1 FROM search_interactions i
                        WHERE i.trace_id = t.id AND i.kind = 'click' AND i.rank >= 5) AS low_rank_click
          FROM search_traces t
         WHERE t.created_at > now() - make_interval(hours => ${h})
      )
      SELECT q AS query, count(*) AS searches,
             count(*) FILTER (WHERE zero) AS zero_result,
             count(*) FILTER (WHERE reformulated) AS reformulated,
             count(*) FILTER (WHERE neg_fb) AS negative_feedback,
             sum(zero::int * 4 + reformulated::int * 3 + neg_fb::int * 4
                 + no_click::int * 1 + slow::int * 1 + gap::int * 2 + low_rank_click::int * 2) AS score
        FROM flags WHERE q IS NOT NULL
        GROUP BY q HAVING sum(zero::int * 4 + reformulated::int * 3 + neg_fb::int * 4
                 + no_click::int * 1 + slow::int * 1 + gap::int * 2 + low_rank_click::int * 2) > 0
        ORDER BY score DESC LIMIT 15`),
    db.execute(sql`
      SELECT count(*) AS total, count(*) FILTER (WHERE verdict = 'bad') AS bad
        FROM feedback
       WHERE created_at > now() - make_interval(hours => ${h})`),
  ]);

  const ta = (traceAgg.rows?.[0] ?? {}) as Record<string, string | null>;
  const ia = (interactAgg.rows?.[0] ?? {}) as Record<string, string | null>;
  const ra = (reformAgg.rows?.[0] ?? {}) as Record<string, string | null>;
  const fa = (fbAgg.rows?.[0] ?? {}) as Record<string, string | null>;

  const rawBadRows = badRows.rows as Record<string, string>[];
  const reviewRows = rawBadRows.length
    ? await db
        .select({
          querySafe: badSearchReviews.querySafe,
          status: badSearchReviews.status,
          note: badSearchReviews.note,
          reviewedAt: badSearchReviews.reviewedAt,
        })
        .from(badSearchReviews)
        .where(inArray(badSearchReviews.querySafe, rawBadRows.map((r) => r.query)))
    : [];
  const reviewByQuery = new Map(reviewRows.map((r) => [r.querySafe, r]));

  const searches = Number(ta.searches ?? 0);
  const localTotal = Number(ta.local_total ?? 0);
  const ctr = (c: string | null, i: string | null) =>
    Number(i) > 0 ? Math.round((Number(c) / Number(i)) * 1000) / 10 : null;

  // coverage gaps — từ retrieval brain qua capability, fail-safe khi embedded/offline
  let gaps: unknown[] = [];
  try {
    const b = await requireCapability("coverage");
    const cov = (await b.coverage!(15)) as { gaps?: unknown[] };
    gaps = cov.gaps ?? [];
  } catch {
    /* backend không có coverage (embedded, router down) */
  }

  return {
    windowHours: h,
    searches,
    zeroResultRate: searches ? Math.round((Number(ta.zero) / searches) * 1000) / 10 : 0,
    lowResultRate: searches ? Math.round((Number(ta.low) / searches) * 1000) / 10 : 0,
    exactLocalRate: localTotal ? Math.round((Number(ta.exact_local) / localTotal) * 1000) / 10 : null,
    reformulationRate: searches ? Math.round((Number(ia.reform_traces) / searches) * 1000) / 10 : 0,
    reformulationLowQualityRate: searches ? Math.round((Number(ra.reform_low) / searches) * 1000) / 10 : 0,
    ctr: {
      at1: ctr(ia.clk1, ia.imp1),
      at3: ctr(ia.clk3, ia.imp3),
      at5: ctr(ia.clk5, ia.imp5),
    },
    // distinct trace có ≥1 source_open / searches — mở nhiều nguồn trong
    // một lượt tìm chỉ tính một lần
    sourceOpenRate: searches ? Math.round((Number(ia.src_open_traces) / searches) * 1000) / 10 : 0,
    negativeFeedbackRate: Number(fa.total) ? Math.round((Number(fa.bad) / Number(fa.total)) * 1000) / 10 : 0,
    coverageGapRate: searches ? Math.round((Number(ta.gaps) / searches) * 1000) / 10 : 0,
    latency: { p50: ta.p50 != null ? Number(ta.p50) : null, p95: ta.p95 != null ? Number(ta.p95) : null },
    byIntent: (intentRows.rows as { intent: string; n: string }[]).map((r) => ({ intent: r.intent, count: Number(r.n) })),
    badSearches: rawBadRows.map((r) => {
      const review = reviewByQuery.get(r.query);
      return {
        query: r.query,
        searches: Number(r.searches),
        zeroResult: Number(r.zero_result),
        reformulated: Number(r.reformulated),
        negativeFeedback: Number(r.negative_feedback),
        score: Number(r.score),
        reviewStatus: (review?.status ?? "open") as BadSearchReviewStatus,
        reviewNote: review?.note ?? null,
        reviewedAt: review?.reviewedAt?.toISOString() ?? null,
      };
    }),
    coverageGaps: gaps,
  };
}
