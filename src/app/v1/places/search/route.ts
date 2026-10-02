import type { NextRequest } from "next/server";
import { vietscope } from "@/lib/model";
import { gate } from "@/lib/auth";
import { badRequest, guard, parseBody, parseGet, readJson } from "@/lib/http";
import type { RetrievalOutcome } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Local Search API — facade của retrieve(local): exact (verified) tách khỏi web-unverified và related. Hỗ trợ lat/lon. */
function shape(out: RetrievalOutcome, query: string) {
  const R = out.retrieval;
  return {
    model: "vietscope-1",
    backend: R.backend,
    query,
    trace_id: out.traceId,
    specialty: R.understanding.specialty,
    location: R.understanding.locations,
    transition: R.understanding.transition,
    places: R.places,
    quality: { confidence: R.quality.confidence, coverage: R.quality.coverage },
    coverage: R.coverage,
    federation: R.federation,
    widening: R.widening,
    timings: out.timings,
  };
}

export const GET = guard(async (req: NextRequest) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const p = parseGet(req);
  if (!p.query) return badRequest("q is required");
  return Response.json(shape(await vietscope.retrieve(p.query, { ...p.opts, mode: "fast" }), p.query));
});

export const POST = guard(async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const p = parseBody(await readJson(req), "fast");
  if (!p.query) return badRequest("query is required");
  return Response.json(shape(await vietscope.retrieve(p.query, p.opts), p.query));
});
