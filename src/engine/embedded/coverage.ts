// ---------------------------------------------------------------------------
// VietScope · Coverage Engine (P5) + Entity Resolution
//
//   SEARCH COVERAGE GAP → coverage_gaps (đếm số lần vấp) → Coverage Engine
//   PLACE CANDIDATE → verify → entity resolution → canonical_places
//
// Đây là vòng flywheel: mỗi lần tìm không ra dữ liệu đều trở thành việc cụ thể
// cho tầng thu thập, và mỗi ứng viên web được xác minh đều thành dữ liệu riêng.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { adminUnits, coverageGaps, places, placeCandidates } from "@/db/schema";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import type { QueryUnderstanding } from "./understand";
import type { RetrievalResult, ScoredPlace } from "./retrieve";
import { editDistance } from "./fuzzy";
import { normalize, slugify } from "@/lib/vi";

// --- Ghi nhận lỗ hổng phủ dữ liệu ---------------------------------------------
export function gapKey(u: QueryUnderstanding): string {
  const loc = u.locations[0]?.unit.id ?? u.resolvedCurrentIds[0] ?? "vn";
  return [u.intent, u.specialty ?? "-", loc].join("|");
}

/** Đề xuất lane mà Coverage Engine nên chạy để lấp lỗ hổng này */
export function suggestAction(u: QueryUnderstanding): string {
  if (u.intent === "local_search") {
    return `acquire lane places: local OSM PBF + permitted web discovery cho “${u.specialty ?? u.tokens.join(" ")}” quanh ${u.locations[0]?.unit.name ?? "khu vực hỏi"} → place_candidates`;
  }
  if (u.intent === "legal") return "crawl lane legal: vanban.chinhphu.vn + congbao + gdt.gov.vn (RSS + sitemap)";
  if (u.intent === "market_price") return "nối provider market realtime (giá vàng/xăng/tỷ giá) thay vì corpus tĩnh";
  if (u.intent === "weather") return "nối provider KTTV live (nchmf.gov.vn) — không dùng corpus";
  return "mở rộng corpus web/news cho chủ đề này";
}

export async function recordCoverageGap(u: QueryUnderstanding, r: RetrievalResult): Promise<boolean> {
  const missing =
    (u.intent === "local_search" && r.places.exact.length === 0) ||
    (u.intent !== "local_search" && r.docs.length === 0) ||
    r.coverage.gap;
  if (!missing) return false;
  const key = gapKey(u);
  const reason =
    r.coverage.reason ??
    (u.intent === "local_search"
      ? `không có địa điểm canonical đã xác minh cho “${u.specialty ?? u.tokens.join(" ")}”`
      : "không có nguồn nào trong corpus khớp câu hỏi");
  try {
    const existing = await db.select().from(coverageGaps).where(eq(coverageGaps.key, key)).limit(1);
    if (existing.length) {
      await db
        .update(coverageGaps)
        .set({ hits: (existing[0].hits ?? 0) + 1, lastSeenAt: new Date(), querySample: u.raw, reason })
        .where(eq(coverageGaps.id, existing[0].id));
    } else {
      await db.insert(coverageGaps).values({
        key,
        intent: u.intent,
        querySample: u.raw,
        specialty: u.specialty,
        locationId: u.locations[0]?.unit.id ?? null,
        provinceId: u.resolvedCurrentIds.find((id) => id.startsWith("t_")) ?? null,
        reason,
        hits: 1,
        status: "open",
        action: suggestAction(u),
      });
    }
    return true;
  } catch (e) {
    console.error("coverage gap log failed", e);
    return false;
  }
}

export async function listGaps(limit = 25) {
  return db.select().from(coverageGaps).orderBy(desc(coverageGaps.hits)).limit(limit);
}

// --- Entity resolution: ứng viên web có trùng một place đã có không? ----------
export async function resolveCandidate(nameSearch: string, provinceId: string | null): Promise<ScoredPlace | null> {
  // Candidate generation ở SQL (không load cả bảng): cùng tỉnh + trùng đầu/cuối tên.
  // Production: phone exact → domain exact → lân cận không gian → name trigram → address similarity.
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
  const w = nameSearch.split(" ").filter(Boolean);
  const head = w.slice(0, 2).join(" ");
  const tail = w.slice(-2).join(" ");
  const rows = await db
    .select()
    .from(places)
    .where(and(provinceId ? eq(places.provinceId, provinceId) : undefined, or(like(places.nameSearch, `%${esc(head)}%`), like(places.nameSearch, `%${esc(tail)}%`))))
    .limit(80);
  let best: { p: (typeof rows)[number]; d: number } | null = null;
  for (const p of rows) {
    const d = editDistance(nameSearch, p.nameSearch, 3);
    if (d <= 2 && (!best || d < best.d)) best = { p, d };
  }
  return best ? { ...best.p, score: 0, exact: false, distanceKm: null, why: [] } : null;
}

export interface PromoteInput {
  candidateId: string;
  verified?: boolean;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  hours?: string | null;
  note?: string | null;
}

export interface PromoteResult {
  action: "created" | "linked_existing";
  placeId: string;
  name: string;
  duplicateOf?: string | null;
  verified: boolean;
  note: string;
}

/** VERIFY → ENTITY RESOLUTION → CANONICAL PLACE */
export async function promoteCandidate(_input: PromoteInput): Promise<PromoteResult> {
  void _input;
  // A candidate is a lead, not independent evidence. No mutation through a caller's verified flag.
  throw new Error("Candidate chưa có hồ sơ observations. Nhập và đối chiếu nguồn tại /data/pilot trước khi ghi canonical.");
}
