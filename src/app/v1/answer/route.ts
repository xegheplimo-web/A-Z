import type { NextRequest } from "next/server";
import { renderMarkdown, usageFor, vietscope } from "@/lib/model";
import { gate, recordUsage } from "@/lib/auth";
import { badRequest, guard, parseBody, parseGet, readJson } from "@/lib/http";
import type { VietScopeResponse } from "@/lib/pipeline";
import { claimsToWire } from "@/lib/evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Answer Engine — retrieve → synthesis → verification: answer + citations (claim → source → passage offsets). */
function shape(d: VietScopeResponse) {
  const text = renderMarkdown(d).full;
  return {
    model: d.model,
    backend: d.backend,
    query: d.query,
    trace_id: d.trace_id,
    synthesizer: d.synthesizer,
    output_text: text,
    answer: d.answer,
    citations: d.citations,
    verification: { verified_ratio: d.verification.verifiedRatio, citation_precision: d.verification.citationPrecision, citation_coverage: d.verification.citationCoverage, claims: claimsToWire(d.verification.claims) },
    places: d.understanding.intent === "local_search" ? d.places : undefined,
    quality: d.quality,
    budget: d.budget,
    timings: d.timings,
    usage: { ...usageFor(d, d.query, text), ...d.usage },
  };
}

async function run(req: Request, p: ReturnType<typeof parseBody>) {
  const data = await vietscope.respond(p.query, p.opts);
  const body = shape(data);
  await recordUsage(req, body.usage);
  return Response.json(body);
}

export const POST = guard(async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const p = parseBody(await readJson(req));
  if (!p.query) return badRequest("query is required");
  return run(req, p);
});

export const GET = guard(async (req: NextRequest) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const p = parseGet(req);
  if (!p.query) return badRequest("q is required");
  return run(req, p);
});
