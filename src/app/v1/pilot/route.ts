import { getBackend, requireCapability } from "@/core/backend";
import { PilotError, type PilotCommand } from "@/core/pilot";
import { isAdmin, hashKey } from "@/lib/auth";
import { guard } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read/write pilot data goes through the ONE selected retrieval backend. */
export const GET = guard(async (req: Request) => {
  const backend = await getBackend();
  if (!backend.capabilities.pilot || !backend.pilotSnapshot) return Response.json({ available: false, backend: backend.id, note: "Backend này chưa cung cấp API quản lý pilot. Không tự chuyển sang engine khác." });
  const result = await backend.pilotSnapshot();
  const write = isAdmin(req);
  // Public dashboard is aggregate-only. Source payloads and operator notes are not public.
  return Response.json({ ...result, capabilities: { write }, candidates: write ? result.candidates : [], privateData: !write }, { headers: { "cache-control": "private, no-store" } });
});

export const POST = guard(async (req: Request) => {
  if (!isAdmin(req)) return Response.json({ error: { message: "Cần khóa VIETSCOPE_ADMIN_KEY hợp lệ để ghi dữ liệu pilot." } }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) return Response.json({ error: { message: "Batch quá lớn (tối đa 1 MB)." } }, { status: 413 });
  let body: PilotCommand;
  try {
    const raw = await req.text();
    if (raw.length > 1_000_000) throw new Error("large payload");
    body = JSON.parse(raw) as PilotCommand;
    if (!body || typeof body !== "object" || !["ingest", "review", "plan", "claim"].includes(body.action)) throw new Error("invalid action");
  } catch { return Response.json({ error: { message: "JSON hoặc action không hợp lệ." } }, { status: 400 }); }
  const backend = await requireCapability("pilot");
  const actor = `admin:${hashKey(req.headers.get("authorization") ?? "").slice(0,16)}`;
  try {
    const result = await backend.pilotCommand!(body, actor);
    return Response.json({ ok: true, result });
  } catch (e) {
    if (e instanceof PilotError) return Response.json({ error: { message: e.message } }, { status: e.status });
    throw e;
  }
});
