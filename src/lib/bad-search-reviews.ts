// ---------------------------------------------------------------------------
// VietScope · P-LEARNING-5 — human review state for the live Bad Search Queue.
//
// The queue itself remains derived from telemetry in quality.ts. This module
// stores ONLY reviewer judgment keyed by query_safe. Telemetry score is not a
// benchmark label. "promoted_to_golden" is reserved for P-LEARNING-6.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { badSearchReviews } from "@/db/schema";
import { redactText } from "@/lib/telemetry";
import { eq } from "drizzle-orm";

export const BAD_SEARCH_REVIEW_STATUSES = [
  "open",
  "reviewed_good",
  "confirmed_bad",
  "ignored",
  "promoted_to_golden",
] as const;

export type BadSearchReviewStatus = (typeof BAD_SEARCH_REVIEW_STATUSES)[number];

export const REVIEWABLE_BAD_SEARCH_STATUSES = [
  "open",
  "reviewed_good",
  "confirmed_bad",
  "ignored",
] as const satisfies readonly BadSearchReviewStatus[];

export function isPromotableReviewStatus(status: BadSearchReviewStatus): boolean {
  return status === "confirmed_bad";
}

export async function setBadSearchReview(input: {
  query: string;
  status: BadSearchReviewStatus;
  note?: string | null;
}) {
  const querySafe = redactText(input.query, 500).trim();
  if (!querySafe) throw new Error("query is required");
  if (!REVIEWABLE_BAD_SEARCH_STATUSES.includes(input.status as (typeof REVIEWABLE_BAD_SEARCH_STATUSES)[number])) {
    throw new Error("promoted_to_golden is reserved for P-LEARNING-6");
  }

  const note = input.note ? redactText(input.note, 1000).trim() : null;
  if (input.status === "confirmed_bad" && !note) {
    throw new Error("confirmed_bad requires a review note");
  }

  const [existing] = await db
    .select({ status: badSearchReviews.status })
    .from(badSearchReviews)
    .where(eq(badSearchReviews.querySafe, querySafe))
    .limit(1);
  if (existing?.status === "promoted_to_golden") {
    throw new Error("promoted_to_golden is terminal");
  }

  const now = new Date();
  const [row] = await db
    .insert(badSearchReviews)
    .values({
      querySafe,
      status: input.status,
      note: input.status === "open" ? null : note,
      reviewedAt: input.status === "open" ? null : now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: badSearchReviews.querySafe,
      set: {
        status: input.status,
        note: input.status === "open" ? null : note,
        reviewedAt: input.status === "open" ? null : now,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}
