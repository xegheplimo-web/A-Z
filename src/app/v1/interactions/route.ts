import { gate } from "@/lib/auth";
import { readJson, badRequest } from "@/lib/http";
import { recordInteractions, INTERACTION_KINDS, type InteractionEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/interactions — tín hiệu hành vi trên một search (P-LEARNING).
 *
 *   { trace_id?, session?, events: [{ kind, result_id?, rank?, meta? }] }
 *
 * kind ∈ impression | click | source_open | map_open | call | directions |
 * reformulate. Browser-side endpoint: rate-limit theo IP, không yêu cầu API
 * key, không lưu IP hay định danh người dùng lâu dài.
 */
export async function POST(req: Request) {
  const blocked = await gate(req, { skipAuth: true });
  if (blocked) return blocked;
  const body = await readJson(req);
  const events = Array.isArray(body?.events) ? (body.events as InteractionEvent[]) : null;
  if (!events || !events.length) return badRequest("events[] is required");
  const traceId = typeof body.trace_id === "string" && body.trace_id.length <= 64 ? body.trace_id : null;
  const session = typeof body.session === "string" && body.session.length <= 64 ? body.session : null;
  const written = await recordInteractions(traceId, session, events);
  return Response.json({ ok: true, recorded: written });
}
