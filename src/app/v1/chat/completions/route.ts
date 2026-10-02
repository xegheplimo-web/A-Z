import { VietScopeModel, resolveQuery, vietscope, type ChatMessage } from "@/lib/model";
import { gate, recordUsage } from "@/lib/auth";
import { SSE_HEADERS, badRequest, guard, parseLocation, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /v1/chat/completions — OpenAI-compatible facade của vietscope-1.
 * Citation: marker [n] + chân trang "Nguồn"; dữ liệu có cấu trúc nằm trong trường mở rộng `vietscope`.
 * usage: token THẬT từ LLM provider; nếu không có thì ước lượng và gắn `estimated: true` (không dùng để tính tiền).
 */
export const POST = guard(async (req: Request) => {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const body = await readJson(req);
  const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
  const query = resolveQuery(messages);
  if (!query) return badRequest("messages must include a user turn");

  const { mode } = VietScopeModel.resolveModel(typeof body.model === "string" ? body.model : undefined);
  const runOpts = { mode, location: parseLocation(body) };

  if (body.stream) {
    return new Response(vietscope.streamChatLive(messages, runOpts, (u) => void recordUsage(req, u)), { headers: { ...SSE_HEADERS, "x-vietscope-model": "vietscope-1" } });
  }
  const data = await vietscope.respond(messages, runOpts);
  const completion = vietscope.toChatCompletion(data, query);
  await recordUsage(req, completion.usage);
  return Response.json(completion, { headers: { "x-vietscope-model": data.model } });
});
