import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { badSearchReviews } from "../src/db/schema";
import {
  isPromotableReviewStatus,
  setBadSearchReview,
  type BadSearchReviewStatus,
} from "../src/lib/bad-search-reviews";
import { redactText } from "../src/lib/telemetry";

async function main() {
  const rawQuery = `review-${randomUUID()} goi 0901234567 qa@example.com`;
  const querySafe = redactText(rawQuery, 500);
  try {
    const good = await setBadSearchReview({
      query: rawQuery,
      status: "reviewed_good",
      note: "khong phai loi, lien he 0987654321",
    });
    assert.equal(good.querySafe, querySafe);
    assert.equal(good.status, "reviewed_good");
    assert.match(good.note ?? "", /\[sdt\]/);
    assert.ok(!(good.note ?? "").includes("0987654321"));
    console.log("PASS review write redacts query/note");

    await assert.rejects(
      setBadSearchReview({ query: rawQuery, status: "confirmed_bad", note: "" }),
      /requires a review note/,
    );
    console.log("PASS confirmed_bad requires note");

    const bad = await setBadSearchReview({
      query: rawQuery,
      status: "confirmed_bad",
      note: "ket qua sai scope",
    });
    assert.equal(bad.status, "confirmed_bad");
    assert.equal(isPromotableReviewStatus(bad.status as BadSearchReviewStatus), true);
    assert.equal(isPromotableReviewStatus("reviewed_good"), false);
    console.log("PASS only confirmed_bad is promotable");

    await assert.rejects(
      setBadSearchReview({
        query: rawQuery,
        status: "promoted_to_golden",
        note: "must be P-LEARNING-6",
      }),
      /reserved for P-LEARNING-6/,
    );
    console.log("PASS P-LEARNING-5 cannot promote to golden");

    const reopened = await setBadSearchReview({ query: rawQuery, status: "open" });
    assert.equal(reopened.status, "open");
    assert.equal(reopened.note, null);
    assert.equal(reopened.reviewedAt, null);
    console.log("PASS review can reopen without creating a label");
  } finally {
    await db.delete(badSearchReviews).where(eq(badSearchReviews.querySafe, querySafe));
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
