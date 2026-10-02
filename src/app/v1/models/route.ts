import { MODELS } from "@/lib/pipeline";

export const dynamic = "force-static";

/** GET /v1/models — chỉ MỘT model public: vietscope-1 */
export async function GET() {
  return Response.json({
    object: "list",
    data: MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: 1735689600,
      owned_by: "vietscope",
      description: m.desc,
      capabilities: ["vi_query_understanding", "vn_admin_graph", "local_search", "citations", "verification", "data_flywheel", "streaming"],
    })),
  });
}
