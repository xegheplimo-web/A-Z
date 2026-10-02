import { runEval } from "@/lib/eval";
import { gate } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /v1/eval/run — chạy lại benchmark vn-golden và lưu vào eval_runs. */
export async function POST(req: Request) {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const res = await runEval();
  return Response.json({ name: res.name, query_count: res.queryCount, metrics: res.metrics });
}
