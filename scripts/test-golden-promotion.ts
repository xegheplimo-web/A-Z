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
  const cleanupQueries = [q1, q2, q3].map((q) => redactText(q, 500));

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

    // --- approve thiếu labels → reject ---
    await setGoldenLabels(cand.id, { intent: "local_search" });
    await assert.rejects(approveGoldenCandidate(cand.id), /thiếu label bắt buộc/);
    console.log("PASS approve rejects missing required labels");

    // --- labels đầy đủ → labeled → approved → benchmark visible ---
    await setGoldenLabels(cand.id, FULL);
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
