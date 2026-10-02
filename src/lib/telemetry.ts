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

export const INTERACTION_KINDS = new Set([
  "impression",
  "click",
  "source_open",
  "map_open",
  "call",
  "directions",
  "reformulate",
]);

/** Lược thông tin có thể định danh ra khỏi query cho tầng phân tích dài hạn. */
export function redactQuery(query: string): string {
  return query
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?<!\d)(?:\+?84|0)\d{8,10}(?!\d)/g, "[sdt]")
    .replace(/\b\d{6,}\b/g, "[id]")
    .slice(0, 500);
}

export interface InteractionEvent {
  kind: string;
  result_id?: string | null;
  rank?: number | null;
  meta?: Record<string, unknown> | null;
}

/** Meta của event `reformulate` chứa query cũ/mới — cũng phải lược PII. */
function sanitizeMeta(kind: string, meta: Record<string, unknown> | null | undefined) {
  if (!meta || typeof meta !== "object") return null;
  if (kind !== "reformulate") return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = typeof v === "string" ? redactQuery(v) : v;
  }
  return out;
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
      rank: Number.isInteger(e.rank) ? (e.rank as number) : null,
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
