import { vietscope } from "@/lib/model";
import { gate } from "@/lib/auth";
import { badRequest, guard, parseBody, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/retrieve — "retrieval brain" của vietscope-1, dành cho AI agents.
 * KHÔNG gọi LLM, KHÔNG synthesis: backend (search-router | embedded) làm toàn bộ
 * understand → budget → federated retrieve → widen → fuse → quality gate.
 * Input : { query, location?, max_results?, evidence?: auto|off|full, mode?: auto|fast|standard|research }
 * Output: { intent, results, related, evidence(passage+offset), quality, coverage, federation, timings }
 */
export const POST = guard(async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const p = parseBody(await readJson(req));
  if (!p.query) return badRequest("query is required");
  const out = await vietscope.retrieve(p.query, p.opts);
  return Response.json(vietscope.toRetrieve(out, p.query, p.evidence, p.opts.maxResults ?? 10), { headers: { "x-vietscope-model": "vietscope-1" } });
});
