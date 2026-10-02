// ---------------------------------------------------------------------------
// VietScope · MCP adapter (roadmap P3) — streamable HTTP, JSON-RPC 2.0
//
// Đúng nguyên tắc §4: agent (Hermes) KHÔNG phải gọi search_places → search →
// read → search lần nữa. Chỉ MỘT tool:
//
//   vietscope_retrieve(query, location?, max_results?, evidence?, mode?)
//     → intent + results + related + evidence + quality + timings
//
// Agent chỉ việc reasoning/synthesize trên kết quả có cấu trúc.
// ---------------------------------------------------------------------------
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { vietscope } from "@/lib/model";
import { gate } from "@/lib/auth";
import { parseLocation } from "@/lib/http";
import type { ModeInput } from "@/core/contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROTOCOL = "2025-06-18";
const SERVER = { name: "vietscope-mcp", version: "1.0.0" };

// Session STATELESS: id = <nonce>.<iat>.<hmac> — không cần RAM/Redis, mọi instance đều xác thực được.
// (Trước đây: Set<string> trong process → request thứ 2 vào server khác báo "unknown session".)
// Bí mật: MCP_SESSION_SECRET, mặc định dẫn xuất từ DATABASE_URL (chung giữa các instance cùng DB).
const SESSION_TTL_MS = 24 * 3600 * 1000;
const secret = () => process.env.MCP_SESSION_SECRET?.trim() || createHash("sha256").update(`vietscope-mcp:${process.env.DATABASE_URL ?? "dev"}`).digest("hex");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");
function mintSession(): string {
  const payload = `${randomBytes(9).toString("base64url")}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}
function verifySession(id: string | null): boolean {
  if (!id) return false;
  const parts = id.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const iat = Number(parts[1]);
  return Number.isFinite(iat) && Date.now() - iat < SESSION_TTL_MS;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOL = {
  name: "vietscope_retrieve",
  title: "VietScope Retrieve (vietscope-1)",
  description:
    "Bộ não tìm kiếm của VietScope cho tiếng Việt. Một lệnh gọi duy nhất thực hiện: hiểu câu hỏi tiếng Việt (kể cả không dấu/typo), " +
    "resolve địa danh Việt Nam (bao gồm tên cũ đã sáp nhập), chọn nguồn theo intent, tìm song song trên canonical places + corpus + web, " +
    "chuẩn hoá → dedup → RRF → xếp hạng → quality gate → trả evidence kèm citation. " +
    "Dùng cho mọi loại câu hỏi: địa điểm/ăn uống, pháp luật, giá thị trường, thời tiết, so sánh sản phẩm, tin tức. " +
    "Agent KHÔNG cần gọi thêm công cụ tìm kiếm nào khác.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Câu hỏi tiếng Việt tự nhiên, ví dụ: quán giò chả ngon ở Yên Dũng" },
      location: {
        type: "object",
        description: "Vị trí người dùng (tùy chọn) cho truy vấn kiểu 'gần đây'",
        properties: { lat: { type: "number" }, lng: { type: "number" } },
      },
      max_results: { type: "integer", minimum: 1, maximum: 30, description: "Số kết quả tối đa (mặc định 10)" },
      evidence: { type: "string", enum: ["auto", "off", "full"], description: "Mức trả evidence/passage (mặc định auto)" },
      mode: { type: "string", enum: ["auto", "fast", "standard", "research"], description: "Budget nội bộ; auto = router tự chọn" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      intent: { type: "object" },
      results: { type: "array" },
      related: { type: "array" },
      evidence: { type: "array" },
      quality: { type: "object" },
      coverage: { type: "object" },
      timings: { type: "object" },
    },
    additionalProperties: true,
  },
};

function ok(id: number | string | null | undefined, result: unknown, extra: Record<string, string> = {}) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers: extra });
}
function fail(id: number | string | null | undefined, code: number, message: string, extra: Record<string, string> = {}) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status: 200, headers: extra });
}

async function callTool(params: Record<string, unknown>) {
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const query = String(args.query ?? "").trim().slice(0, 500);
  if (!query) {
    return {
      content: [{ type: "text", text: "Thiếu tham số `query`." }],
      isError: true,
    };
  }
  const mode = (typeof args.mode === "string" ? args.mode : "auto") as ModeInput;
  const evidence = args.evidence === "off" || args.evidence === "full" ? args.evidence : "auto";
  const maxResults = typeof args.max_results === "number" ? args.max_results : undefined;

  const out = await vietscope.retrieve(query, { mode, location: parseLocation(args), maxResults });
  const payload = vietscope.toRetrieve(out, query, evidence, maxResults ?? 10);
  const R = out.retrieval;
  const full = (() => {
    // bản tóm tắt dạng text để agent/model đọc nhanh
    const lines: string[] = [`intent: ${payload.intent.type}${payload.intent.specialty ? ` · specialty: ${payload.intent.specialty}` : ""}${payload.intent.location ? ` · location: ${payload.intent.location}` : ""} · backend: ${payload.backend}`];
    lines.push(`quality: confidence ${payload.quality.confidence} · coverage ${payload.quality.coverage} · ${payload.quality.independent_sources} nguồn độc lập`);
    if (R.places.exact.length) {
      lines.push("địa điểm đã xác minh:");
      R.places.exact.slice(0, 6).forEach((p) => lines.push(`- ${p.name} — ${p.address}${p.rating ? ` · ${p.rating.toFixed(1)}★` : ""}${p.distanceLabel ? ` · ${p.distanceLabel}` : ""}`));
    }
    if (R.places.unverified.length) lines.push(`chưa xác minh (từ web): ${R.places.unverified.map((p) => p.name).join("; ")}`);
    if (payload.evidence.length) {
      lines.push("evidence (passage · offset ký tự):");
      payload.evidence.slice(0, 5).forEach((e) => lines.push(`[${e.source}] ${e.title} — ${e.domain} (ký tự ${e.start}–${e.end}): “${e.text.slice(0, 140)}”`));
    }
    if (R.coverage.gap) lines.push(`COVERAGE GAP: ${R.coverage.reason}`);
    return lines.join("\n");
  })();

  return {
    content: [{ type: "text", text: full }],
    structuredContent: payload,
    isError: false,
  };
}

async function handleOne(req: RpcRequest, sessionId: string | null): Promise<Response | null> {
  const method = req.method ?? "";
  const params = req.params ?? {};
  const isNotification = req.id === undefined || req.id === null;
  const hdr: Record<string, string> = { "mcp-protocol-version": PROTOCOL };
  if (sessionId) hdr["mcp-session-id"] = sessionId;

  switch (method) {
    case "initialize": {
      const sid = mintSession();
      return ok(req.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          "VietScope là Vietnam-first Search & Answer Engine dưới dạng một model duy nhất (vietscope-1). " +
          "Chỉ cần gọi tool `vietscope_retrieve` với câu hỏi tiếng Việt; hệ thống tự hiểu intent, địa danh (kể cả tên cũ đã sáp nhập), " +
          "chọn nguồn, tìm, xếp hạng và trả evidence kèm citation.",
      }, { "mcp-session-id": sid, "mcp-protocol-version": PROTOCOL });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notification: không trả body
    case "ping":
      return ok(req.id, {});
    case "tools/list":
      return ok(req.id, { tools: [TOOL] }, hdr);
    case "tools/call": {
      if (params.name !== TOOL.name) return fail(req.id, -32602, `Unknown tool: ${String(params.name)}`);
      try {
        return ok(req.id, await callTool(params), hdr);
      } catch (e) {
        return ok(req.id, { content: [{ type: "text", text: `Lỗi: ${e instanceof Error ? e.message : "unknown"}` }], isError: true }, hdr);
      }
    }
    default:
      if (isNotification) return null;
      return fail(req.id, -32601, `Method not found: ${method}`, hdr);
  }
}

export async function POST(req: Request) {
  const blocked = await gate(req);
  if (blocked) return blocked;

  const incoming = req.headers.get("mcp-session-id");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(null, -32700, "Parse error");
  }
  const requests = (Array.isArray(body) ? body : [body]) as RpcRequest[];
  if (requests.some((r) => r?.jsonrpc !== "2.0")) return fail(null, -32600, "Invalid Request: jsonrpc must be '2.0'");

  // session: bắt buộc sau initialize (trừ chính initialize và notification)
  const needsSession = requests.some((r) => r.method !== "initialize" && r.id != null);
  if (needsSession && (!incoming || !verifySession(incoming))) {
    return Response.json(
      { jsonrpc: "2.0", id: requests[0]?.id ?? null, error: { code: -32001, message: "Missing or unknown mcp-session-id — call initialize first" } },
      { status: 400 }
    );
  }

  const out: Response[] = [];
  for (const r of requests) {
    const res = await handleOne(r, incoming);
    if (res) out.push(res);
  }
  if (!out.length) return new Response(null, { status: 202 });
  if (out.length === 1) return out[0];
  const merged = await Promise.all(out.map(async (r) => r.json()));
  return Response.json(merged, { headers: { "mcp-protocol-version": PROTOCOL, ...(incoming ? { "mcp-session-id": incoming } : {}) } });
}

export async function GET() {
  return Response.json(
    { error: { message: "VietScope MCP không mở SSE stream ở GET; dùng POST (JSON-RPC). REST: /v1/retrieve", type: "method_not_allowed" } },
    { status: 405, headers: { allow: "POST" } }
  );
}

export async function DELETE(req: Request) {
  void req; // session stateless: không có gì để xoá phía server
  return new Response(null, { status: 204 });
}
