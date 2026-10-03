import { opsAccessOk } from "@/lib/ops";
import {
  REVIEWABLE_BAD_SEARCH_STATUSES,
  setBadSearchReview,
  type BadSearchReviewStatus,
} from "@/lib/bad-search-reviews";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /ops/quality/review — human judgment over a telemetry-derived bad
 * search. Browser uses the existing HttpOnly ops session; Bearer/internal
 * access still works through opsAccessOk().
 *
 * P-LEARNING-5 never creates golden data. "promoted_to_golden" is reserved
 * for P-LEARNING-6 and is rejected here.
 */
export async function POST(req: Request) {
  if (!(await opsAccessOk())) return new Response(null, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > 4096) {
    return Response.json({ error: { message: "payload too large", type: "invalid_request_error" } }, { status: 413 });
  }

  const form = await req.formData();
  const query = String(form.get("query") ?? "").trim().slice(0, 500);
  const status = String(form.get("status") ?? "") as BadSearchReviewStatus;
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  const hours = [24, 168, 720].includes(Number(form.get("h"))) ? Number(form.get("h")) : 24;

  if (!query) return Response.json({ error: { message: "query is required", type: "invalid_request_error" } }, { status: 400 });
  if (!REVIEWABLE_BAD_SEARCH_STATUSES.includes(status as (typeof REVIEWABLE_BAD_SEARCH_STATUSES)[number])) {
    return Response.json({ error: { message: "invalid review status", type: "invalid_request_error" } }, { status: 400 });
  }

  try {
    await setBadSearchReview({ query, status, note });
  } catch (e) {
    return Response.json(
      { error: { message: e instanceof Error ? e.message : "review failed", type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  return Response.redirect(new URL(`/ops/quality?h=${hours}#bad-searches`, req.url), 303);
}
