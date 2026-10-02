import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Deprecated unsafe shortcut. Canonical writes now require observation-level evidence and review. */
export async function POST(req: Request) {
  if (!isAdmin(req)) return Response.json({ error: { message: "Cần quyền quản trị để xác minh dữ liệu." } }, { status: 403 });
  return Response.json({ error: { type: "observations_required", message: "Không thể xác minh địa điểm chỉ bằng verified:true. Nhập nguồn và đối chiếu qua /v1/pilot (ingest → review).", workspace: "/data/pilot" } }, { status: 409 });
}
