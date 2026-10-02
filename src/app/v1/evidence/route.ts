import { retrieveOnly } from "@/lib/pipeline";
import { passagesFor } from "@/lib/evidence";
import { gate } from "@/lib/auth";
import { badRequest, guard, parseBody, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/evidence — passage-level evidence với offset ký tự trong nội dung nguồn.
 * Input: { query, max_passages?, max_per_source? }  — không gọi LLM.
 */
export const POST = guard(async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const raw = await readJson(req);
  const p = parseBody(raw);
  if (!p.query) return badRequest("query is required");
  const maxPassages = Math.min(20, Math.max(1, Number(raw.max_passages ?? 8)));
  const perSource = Math.min(5, Math.max(1, Number(raw.max_per_source ?? 2)));
  const { retrieval: R, timings } = await retrieveOnly(p.query, { ...p.opts, log: false });
  return Response.json({
    model: "vietscope-1",
    backend: R.backend,
    query: p.query,
    intent: R.understanding.intent,
    passages: passagesFor(p.query, R.docs, perSource, maxPassages),
    sources: R.docs.map((d, i) => ({ n: i + 1, title: d.title, url: d.url, domain: d.domain, source_type: d.sourceType, authority: d.authority, origin: d.origin })),
    quality: { confidence: R.quality.confidence, coverage: R.quality.coverage, independent_sources: R.quality.independentSources },
    timings,
  });
});
