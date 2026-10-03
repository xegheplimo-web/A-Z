// P-LEARNING-6 regression: golden promotion invariants.
//   reviewed_good/ignored/open → reject · confirmed_bad → draft
//   missing labels → reject approve · approve → benchmark-visible
//   promote → review.promoted_to_golden · revise → superseded + v(n+1)
//   events → append-only
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { badSearchReviews, goldenCandidateEvents, goldenCandidates } from "../src/db/schema";
import { setBadSearchReview } from "../src/lib/bad-search-reviews";
import {
  approveGoldenCandidate,
  createGoldenCandidate,
  exportGoldenBenchmark,
  nominateGoldenCandidate,
  promoteGoldenCandidate,
  reviseGoldenCandidate,
  setGoldenLabels,
} from "../src/lib/golden";
import { redactText } from "../src/lib/telemetry";

const FULL = {
  intent: "local_search",
  geoScope: { admin_ids: ["new:07681"] },
  specialty: "nhà thuốc",
  expectedEntities: ["Nhà Thuốc Test"],
  freshnessRequirement: "current",
  authorityRequirement: "corroborated_or_better",
  abstentionExpected: false,
  reviewNote: "golden test",
};

async function main() {
  const q1 = `golden-${randomUUID().slice(0, 8)}`;
  const q2 = `golden-${randomUUID().slice(0, 8)}`;
  const q3 = `golden-${randomUUID().slice(0, 8)}`;
  const q4 = `golden-nom-${randomUUID().slice(0, 8)}`;
  const cleanupQueries = [q1, q2, q3, q4].map((q) => redactText(q, 500));

  try {
    // --- non-confirmed_bad reviews không được tạo candidate ---
    await setBadSearchReview({ query: q2, status: "reviewed_good", note: "ok thật" });
    await assert.rejects(createGoldenCandidate({ querySafe: redactText(q2, 500) }), /chỉ confirmed_bad/);
    await setBadSearchReview({ query: q3, status: "ignored", note: "skip" });
    await assert.rejects(createGoldenCandidate({ querySafe: redactText(q3, 500) }), /chỉ confirmed_bad/);
    await assert.rejects(createGoldenCandidate({ querySafe: "no-review-xyz" }), /chưa có human review/);
    console.log("PASS non-confirmed_bad reviews cannot create candidates");

    // --- confirmed_bad → draft candidate ---
    await setBadSearchReview({ query: q1, status: "confirmed_bad", note: "sai scope" });
    const cand = await createGoldenCandidate({ querySafe: redactText(q1, 500) });
    assert.equal(cand.status, "draft");
    assert.equal(cand.version, 1);
    assert.ok(cand.reviewId);
    await assert.rejects(createGoldenCandidate({ querySafe: redactText(q1, 500) }), /đã có candidate/);
    console.log("PASS confirmed_bad → draft, no duplicate active");

    // --- VN100-0 label contract: vocabulary/shape vi phạm reject tại write-time ---
    await assert.rejects(setGoldenLabels(cand.id, { freshnessRequirement: "bogus" }), /freshness .* ngoài enum/);
    await assert.rejects(setGoldenLabels(cand.id, { authorityRequirement: "high" }), /authority .* ngoài enum/);
    await assert.rejects(setGoldenLabels(cand.id, { intent: "made_up_intent" }), /intent .* không thuộc contract/);
    await assert.rejects(setGoldenLabels(cand.id, { geoScope: { radius_m: 2000 } }), /radius_m chỉ có nghĩa kèm anchor/);
    await assert.rejects(setGoldenLabels(cand.id, { geoScope: { anchor: {} } }), /anchor cần label hoặc lat\+lng/);
    await assert.rejects(setGoldenLabels(cand.id, { geoScope: { anchor: { label: "Neo" }, radius_m: -5 } }), /radius_m phải là số > 0/);
    await assert.rejects(setGoldenLabels(cand.id, { relevanceLabels: { "X": 5 } }), /ngoài thang 0\.\.3/);
    await assert.rejects(setGoldenLabels(cand.id, { expectedEntities: ["A"], abstentionExpected: true }), /mâu thuẫn/);
    {
      const after = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, cand.id));
      assert.equal(after[0].status, "draft", "violation không được đổi trạng thái");
    }
    console.log("PASS VN100-0 contract violations rejected at write-time");

    // --- approve thiếu labels → reject ---
    await setGoldenLabels(cand.id, { intent: "local_search" });
    await assert.rejects(approveGoldenCandidate(cand.id), /thiếu label bắt buộc/);
    console.log("PASS approve rejects missing required labels");

    // --- labels đầy đủ → labeled → approved → benchmark visible ---
    await setGoldenLabels(cand.id, FULL);
    {
      const [stored] = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, cand.id));
      assert.equal(stored.freshnessRequirement, "high", "alias 'current' phải normalize → 'high'");
    }
    const approved = await approveGoldenCandidate(cand.id);
    assert.equal(approved.status, "approved");
    const bench = await exportGoldenBenchmark();
    assert.ok(bench.some((b) => b.id === cand.id), "approved case phải nằm trong benchmark export");
    console.log("PASS approved case enters benchmark export");

    // --- promote → review.promoted_to_golden (terminal) ---
    const promoted = await promoteGoldenCandidate(cand.id);
    assert.equal(promoted.status, "promoted");
    const [review] = await db.select().from(badSearchReviews).where(eq(badSearchReviews.id, cand.reviewId!));
    assert.equal(review.status, "promoted_to_golden");
    await assert.rejects(
      setBadSearchReview({ query: q1, status: "open" }),
      /terminal|reserved/,
    );
    console.log("PASS promote flips review → promoted_to_golden (terminal)");

    // --- revise promoted → superseded + version 2 ---
    const v2 = await reviseGoldenCandidate(cand.id, { ...FULL, reviewNote: "v2 fix" });
    assert.equal(v2.version, 2);
    assert.equal(v2.status, "labeled");
    assert.equal(v2.supersedesId, cand.id);
    const [old] = await db.select().from(goldenCandidates).where(eq(goldenCandidates.id, cand.id));
    assert.equal(old.status, "superseded");
    console.log("PASS revise → superseded old + version+1");

    // --- events append-only ---
    const events = await db.select().from(goldenCandidateEvents).where(inArray(goldenCandidateEvents.candidateId, [cand.id, v2.id]));
    const types = events.map((e) => e.eventType);
    assert.ok(types.includes("candidate_created") && types.includes("labeled") && types.includes("approved") && types.includes("promoted") && types.includes("superseded"));
    console.log(`PASS append-only events: ${types.join(" → ")}`);

    // --- manual nomination: positive control, không đụng bad_search_reviews ---
    const nom = await nominateGoldenCandidate({ query: q4 });
    assert.equal(nom.status, "draft");
    assert.equal(nom.source, "manual_nomination");
    assert.equal(nom.reviewId, null);
    assert.ok((nom.evidenceSnapshot as { source_kind?: string } | null)?.source_kind === "dry_run", "không trace → dry-run snapshot");
    assert.equal(nom.traceId, null, "dry-run không được tạo trace giả");
    await assert.rejects(nominateGoldenCandidate({ query: q4 }), /đã có candidate/);
    await setGoldenLabels(nom.id, FULL);
    const nomApproved = await approveGoldenCandidate(nom.id);
    assert.equal(nomApproved.status, "approved");
    const nomPromoted = await promoteGoldenCandidate(nom.id);
    assert.equal(nomPromoted.status, "promoted");
    const [noReview] = await db.select().from(badSearchReviews).where(eq(badSearchReviews.querySafe, redactText(q4, 500))).limit(1);
    assert.equal(noReview, undefined, "manual nomination không được tạo/đụng review row");
    const bench2 = await exportGoldenBenchmark();
    const nomCase = bench2.find((b) => b.id === nom.id);
    assert.equal(nomCase?.source, "manual_nomination", "benchmark export phải mang source");
    const nomEvents = await db.select().from(goldenCandidateEvents).where(eq(goldenCandidateEvents.candidateId, nom.id));
    const createEvt = nomEvents.find((e) => e.eventType === "candidate_created");
    assert.equal((createEvt?.payload as { source?: string } | null)?.source, "manual_nomination");
    console.log("PASS manual nomination → draft → approve → promote, review table untouched");

    // --- revise giữ nguyên source trên version mới ---
    const nomV2 = await reviseGoldenCandidate(nom.id, { ...FULL, reviewNote: "v2" });
    assert.equal(nomV2.source, "manual_nomination", "revise phải copy source của version cũ");
    assert.equal(nomV2.reviewId, null);
    console.log("PASS revise preserves source across versions");

    console.log("all golden promotion assertions passed");
  } finally {
    const cands = await db.select({ id: goldenCandidates.id }).from(goldenCandidates).where(inArray(goldenCandidates.querySafe, cleanupQueries));
    if (cands.length) {
      await db.delete(goldenCandidateEvents).where(inArray(goldenCandidateEvents.candidateId, cands.map((c) => c.id)));
      await db.delete(goldenCandidates).where(inArray(goldenCandidates.id, cands.map((c) => c.id)));
    }
    await db.delete(badSearchReviews).where(inArray(badSearchReviews.querySafe, cleanupQueries));
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
