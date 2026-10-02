import { requireCapability } from "@/core/backend";
import { gate } from "@/lib/auth";
import { guard } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /v1/coverage — Coverage Engine: chỗ dữ liệu Việt Nam còn thiếu + ứng viên chờ verify.
 * Dữ liệu này thuộc RETRIEVAL BRAIN; backend nào không có khả năng này sẽ trả 501.
 */
export const GET = guard(async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 25)));
  const b = await requireCapability("coverage");
  return Response.json({ model: "vietscope-1", backend: b.id, ...((await b.coverage!(limit)) as object) });
});
