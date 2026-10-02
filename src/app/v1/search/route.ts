import type { NextRequest } from "next/server";
import { vietscope } from "@/lib/model";
import { gate } from "@/lib/auth";
import { badRequest, guard, parseBody, parseGet, readJson } from "@/lib/http";
import { unify, type RetrievalOutcome } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Core Search API — kết quả có cấu trúc, KHÔNG gọi LLM và không synthesis. */
function shape(out: RetrievalOutcome, query: string, max = 10) {
  const R = out.retrieval;
  const u = R.understanding;
  return {
    model: "vietscope-1",
    backend: R.backend,
    query,
    trace_id: out.traceId,
    understanding: { intent: u.intent, intentLabel: u.intentLabel, normalized: u.normalized, specialty: u.specialty, freshness: u.freshness, locations: u.locations, transition: u.transition, compareTargets: u.compareTargets, fuzzy: u.fuzzy },
    budget: R.budget,
    results: unify(R, max),
    places: R.places,
    web: R.docs.map((d) => ({ title: d.title, url: d.url, domain: d.domain, snippet: d.snippet, publishedAt: d.publishedAt, sourceType: d.sourceType, authority: d.authority, origin: d.origin })),
    quality: { confidence: R.quality.confidence, coverage: R.quality.coverage, independent_sources: R.quality.independentSources },
    coverage: R.coverage,
    federation: R.federation,
    widening: R.widening,
    timings: out.timings,
  };
}

export const POST = guard(async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const p = parseBody(await readJson(req));
  if (!p.query) return badRequest("query is required");
  return Response.json(shape(await vietscope.retrieve(p.query, p.opts), p.query, p.opts.maxResults), { headers: { "x-vietscope-model": "vietscope-1" } });
});

export const GET = guard(async (req: NextRequest) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const p = parseGet(req);
  if (!p.query) return badRequest("q is required");
  return Response.json(shape(await vietscope.retrieve(p.query, p.opts), p.query, p.opts.maxResults), { headers: { "x-vietscope-model": "vietscope-1" } });
});
