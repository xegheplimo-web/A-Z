import type { NextRequest } from "next/server";
import { requireCapability } from "@/core/backend";
import { gate } from "@/lib/auth";
import { badRequest, guard } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /v1/admin/resolve?q=yên dũng — Vietnam Admin Graph (dữ liệu của RETRIEVAL BRAIN; search-router: chuyển tiếp nguyên văn). */
export const GET = guard(async (req: NextRequest) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 120).trim();
  if (!q) return badRequest("q is required");
  const b = await requireCapability("adminResolve");
  return Response.json(await b.adminResolve!(q));
});
