import { db } from "@/db";
import { feedback } from "@/db/schema";
import { gate } from "@/lib/auth";
import { readJson, badRequest } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/feedback — nhãn của người dùng/agent trên một trace.
 * Đây là dữ liệu preference để sau này dựng VietScope Citation/Tool-Use Dataset (§11).
 *   { trace_id?, query, verdict: "good"|"bad"|"mixed", useful_place_ids?, comment? }
 */
export async function POST(req: Request) {
  const blocked = await gate(req, { skipAuth: true });
  if (blocked) return blocked;
  const body = await readJson(req);
  const query = String(body.query ?? "").trim().slice(0, 500);
  const verdict = String(body.verdict ?? "").toLowerCase();
  if (!query) return badRequest("query is required");
  if (!["good", "bad", "mixed"].includes(verdict)) return badRequest('verdict must be "good" | "bad" | "mixed"');
  const useful = Array.isArray(body.useful_place_ids) ? (body.useful_place_ids as unknown[]).map(String).slice(0, 30) : [];
  const [row] = await db
    .insert(feedback)
    .values({
      traceId: typeof body.trace_id === "string" ? body.trace_id : null,
      query,
      verdict,
      usefulPlaceIds: useful,
      comment: typeof body.comment === "string" ? body.comment.slice(0, 1000) : null,
    })
    .returning({ id: feedback.id });
  return Response.json({ ok: true, id: row.id, verdict, query });
}
