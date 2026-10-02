import { VietScopeModel, resolveQuery, vietscope, type ChatMessage } from "@/lib/model";
import { gate, recordUsage } from "@/lib/auth";
import { SSE_HEADERS, badRequest, guard, parseLocation, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/responses — OpenAI Responses API.
 *   client.responses.create(model="vietscope-1", input="Tìm quán cafe đẹp ở Yên Dũng")
 * Output: output_text + output[].content[].annotations (url_citation) + trường mở rộng `vietscope`.
 */
export const POST = guard(async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const body = await readJson(req);

  let input: string | ChatMessage[];
  if (typeof body.input === "string") input = body.input;
  else if (Array.isArray(body.input)) input = body.input as ChatMessage[];
  else return badRequest("input must be a string or an array of messages");

  const query = resolveQuery(input);
  if (!query) return badRequest("input is empty");

  const { mode } = VietScopeModel.resolveModel(typeof body.model === "string" ? body.model : undefined);
  const runOpts = { mode, location: parseLocation(body) };

  if (body.stream) {
    return new Response(vietscope.streamResponsesLive(input, runOpts, (u) => void recordUsage(req, u)), { headers: { ...SSE_HEADERS, "x-vietscope-model": "vietscope-1" } });
  }
  const data = await vietscope.respond(input, runOpts);
  const out = vietscope.toResponses(data, query);
  await recordUsage(req, { prompt_tokens: out.usage.input_tokens, completion_tokens: out.usage.output_tokens, estimated: out.usage.estimated });
  return Response.json(out, { headers: { "x-vietscope-model": data.model } });
});
