// ---------------------------------------------------------------------------
// VietScope · Search telemetry (P-LEARNING) — tín hiệu hành vi + privacy.
//
// 100% lượt search đã có structured trace ở search_traces. File này bổ sung:
//   • redactQuery   — lược PII cho tầng analytics dài hạn (query_safe)
//   • recordInteractions — impression/click/source/map/call/reformulate
//
// Nguyên tắc: telemetry phục vụ chất lượng search, không tracking người dùng.
// Không lưu IP, Authorization, cookie hay vị trí GPS chính xác lâu dài.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { searchInteractions } from "@/db/schema";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SESSION_RE = /^[a-z0-9-]{6,64}$/i;

export const INTERACTION_KINDS = new Set([
  "impression",
  "click",
  "source_open",
  "map_open",
  "call",
  "directions",
  "reformulate",
]);

/** Lược thông tin có thể định danh (email/SĐT/mã dài) khỏi text người dùng. */
export function redactText(text: string, max = 500): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?<!\d)(?:\+?84|0)\d{8,10}(?!\d)/g, "[sdt]")
    .replace(/\b\d{6,}\b/g, "[id]")
    .slice(0, max);
}

/** Lược thông tin có thể định danh ra khỏi query cho tầng phân tích dài hạn. */
export const redactQuery = (query: string): string => redactText(query, 500);

export interface InteractionEvent {
  kind: string;
  result_id?: string | null;
  rank?: number | null;
  meta?: Record<string, unknown> | null;
}

/** Whitelist meta theo loại event — không nhận JSON tự do từ client. */
const META_KEYS: Record<string, string[]> = { reformulate: ["from", "to"] };

function sanitizeMeta(kind: string, meta: Record<string, unknown> | null | undefined) {
  const allow = META_KEYS[kind];
  if (!allow || !meta || typeof meta !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    const v = meta[k];
    if (typeof v === "string" && v) out[k] = redactText(v, 200);
  }
  return Object.keys(out).length ? out : null;
}

/** Ghi một batch interaction events của một trace. Trả về số event đã ghi. */
export async function recordInteractions(
  traceId: string | null,
  sessionId: string | null,
  events: InteractionEvent[],
): Promise<number> {
  const rows = events
    .filter((e) => INTERACTION_KINDS.has(e.kind))
    .slice(0, 50)
    .map((e) => ({
      traceId,
      sessionId,
      kind: e.kind,
      resultId: e.result_id ? String(e.result_id).slice(0, 120) : null,
      rank: Number.isInteger(e.rank) && (e.rank as number) >= 1 && (e.rank as number) <= 99 ? (e.rank as number) : null,
      meta: sanitizeMeta(e.kind, e.meta),
    }));
  if (!rows.length) return 0;

  try {
    await db.insert(searchInteractions).values(rows);
    return rows.length;
  } catch (e) {
    console.error("interaction log failed", e);
    return 0;
  }
}
