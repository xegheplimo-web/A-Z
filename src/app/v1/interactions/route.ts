import { gate } from "@/lib/auth";
import { readJson, badRequest } from "@/lib/http";
import { recordInteractions, UUID_RE, SESSION_RE, type InteractionEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 16 * 1024;
const MAX_EVENTS = 50;

/**
 * POST /v1/interactions — tín hiệu hành vi trên một search (P-LEARNING).
 *
 *   { trace_id?, session?, events: [{ kind, result_id?, rank?, meta? }] }
 *
 * kind ∈ impression | click | source_open | map_open | call | directions |
 * reformulate. Browser-side endpoint: rate-limit theo IP, không yêu cầu API
 * key, không lưu IP hay định danh người dùng lâu dài. Payload bị siết:
 * body ≤16KB, ≤50 events, trace_id phải UUID, meta theo whitelist từng kind.
 */
export async function POST(req: Request) {
  const blocked = await gate(req, { skipAuth: true });
  if (blocked) return blocked;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) {
    return Response.json({ error: { message: "payload too large", type: "invalid_request_error", code: 413 } }, { status: 413 });
  }
  const body = await readJson(req);
  const events = Array.isArray(body?.events) ? (body.events as InteractionEvent[]) : null;
  if (!events || !events.length) return badRequest("events[] is required");
  if (events.length > MAX_EVENTS) return badRequest(`events[] tối đa ${MAX_EVENTS}`);
  const traceId = typeof body.trace_id === "string" && UUID_RE.test(body.trace_id) ? body.trace_id : null;
  const session = typeof body.session === "string" && SESSION_RE.test(body.session) ? body.session : null;
  const written = await recordInteractions(traceId, session, events);
  return Response.json({ ok: true, recorded: written });
}
