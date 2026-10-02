// ---------------------------------------------------------------------------
// VietScope · Retrieval core (deterministic ranking — BM25-adjacent scoring
// trong Postgres corpus, geo graph resolution, precision-first quality gate)
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { adminUnits, places, documents, placeCandidates } from "@/db/schema";
import { and, desc, eq, getTableColumns, inArray, like, or, sql, type SQL } from "drizzle-orm";
import type { AdminUnit, DocumentRow, Place, PlaceCandidate } from "@/db/schema";
import type { QueryUnderstanding } from "./understand";
import { clamp, freshnessScore, haversineKm, normalize } from "@/lib/vi";

// --- Cache địa danh (load 1 lần / process) -----------------------------------
let unitsCache: AdminUnit[] | null = null;
export async function loadUnits(): Promise<AdminUnit[]> {
  if (!unitsCache) unitsCache = await db.select().from(adminUnits);
  return unitsCache;
}
export function invalidateUnitsCache() {
  unitsCache = null;
}

// --- Scored result types ------------------------------------------------------
export interface ScoredPlace extends Place {
  score: number;
  exact: boolean;
  distanceKm: number | null;
  why: string[];
}

export interface ScoredDoc extends DocumentRow {
  score: number;
  why: string[];
  /** lane nguồn: corpus nội bộ hay provider ngoài (Search Hub) */
  origin?: "corpus" | "search-hub";
}

export interface RetrieveOptions {
  /** vị trí người dùng (cho truy vấn kiểu "gần đây") */
  userLoc?: { lat: number; lng: number } | null;
  /** bán kính (km) khi chỉ có userLoc, không có địa danh trong câu hỏi */
  nearRadiusKm?: number;
}

export interface RetrievalResult {
  places: {
    exact: ScoredPlace[];
    related: ScoredPlace[];
    unverified: ScoredPlace[];
    candidates: PlaceCandidate[];
  };
  docs: ScoredDoc[];
  coverage: { gap: boolean; reason: string | null; widened: boolean };
  anchor: { lat: number; lng: number; label: string } | null;
  /** phạm vi địa lý đã resolve (hiện hành) — dùng để đo outside-area */
  scope: { provinces: string[]; communes: string[] };
}

export const FOOD_CATS = new Set([
  "gio-cha", "pho", "bun-cha", "banh-cuon", "banh-mi", "com", "bun-bo", "mi-quang",
  "banh-da-cua", "com-chay", "cha-ca", "dac-san", "an-dem", "cafe",
]);

const esc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
/** Trần số dòng kéo về process cho mỗi truy vấn — CANDIDATE GENERATION nằm ở SQL, ranking mới ở đây */
export const ROW_CAP = 400;

/**
 * Chọn ứng viên địa điểm ngay trong SQL (index theo province/category), KHÔNG quét cả bảng.
 * exact = (category ∈ categories) ∨ specialty/name LIKE; related = cùng phạm vi, cùng nhóm ăn uống/category.
 * Production thay bằng PostGIS + OpenSearch; contract giữ nguyên.
 */
async function placeCandidatesSQL(
  u: QueryUnderstanding,
  scope: { provinces: Set<string>; communes: Set<string>; anchor: { lat: number; lng: number } | null; userAnchored: boolean; radiusKm: number }
): Promise<Place[]> {
  const sp = u.specialty ? normalize(u.specialty) : null;
  const terms = [...new Set([...(sp ? [sp] : []), ...u.specialtyTerms.map(normalize)])].filter((t) => t.length >= 3).slice(0, 12);

  let scopeCond: SQL | undefined;
  if (scope.provinces.size) {
    scopeCond = inArray(places.provinceId, [...scope.provinces]);
  } else if (scope.userAnchored && scope.anchor) {
    const dLat = (scope.radiusKm * 2) / 111;
    const dLng = dLat / Math.max(0.2, Math.cos((scope.anchor.lat * Math.PI) / 180));
    scopeCond = and(
      sql`${places.lat} between ${scope.anchor.lat - dLat} and ${scope.anchor.lat + dLat}`,
      sql`${places.lng} between ${scope.anchor.lng - dLng} and ${scope.anchor.lng + dLng}`
    );
  }

  const specMatch: SQL | undefined =
    sp || u.categories.length
      ? or(
          u.categories.length ? inArray(places.category, u.categories) : undefined,
          ...terms.map((t) => like(places.specialtiesSearch, `%${esc(t)}%`)),
          ...terms.map((t) => like(places.nameSearch, `%${esc(t)}%`))
        )
      : undefined;

  const order = sql`${places.verified} desc, ${places.rating} desc nulls last`;
  const exactRows = await db.select().from(places).where(and(sql`${places.dataClass} <> 'pilot-fixture'`, scopeCond, scope.communes.size ? inArray(places.communeId, [...scope.communes]) : undefined, specMatch)).orderBy(order).limit(ROW_CAP);

  let relatedRows: Place[] = [];
  if (scopeCond) {
    const specCat = u.categories[0];
    const catCond = specCat ? (FOOD_CATS.has(specCat) ? inArray(places.category, [...FOOD_CATS]) : eq(places.category, specCat)) : undefined;
    relatedRows = await db.select().from(places).where(and(sql`${places.dataClass} <> 'pilot-fixture'`, scopeCond, catCond)).orderBy(order).limit(ROW_CAP / 2);
  }
  const byId = new Map<string, Place>();
  for (const p of [...exactRows, ...relatedRows]) byId.set(p.id, p);
  return [...byId.values()];
}

/**
 * Chọn ứng viên tài liệu: full-text (GIN) ∪ chính sách lane theo intent (SourceRouter).
 * Trước đây: select * from documents rồi chấm điểm toàn corpus trong JS.
 */
async function docCandidates(u: QueryUnderstanding) {
  const words = new Set<string>();
  const add = (s: string) => normalize(s).split(" ").forEach((w) => /^[a-z0-9]{3,}$/.test(w) && words.add(w));
  u.tokens.forEach(add);
  if (u.specialty) add(u.specialty);
  u.locations.forEach((l) => add(l.unit.nameSearch.replace(/^(tinh|tp|thanh pho|huyen|thi xa|xa|phuong) /, "")));
  (u.compareTargets ?? []).forEach(add);
  const q = [...words].slice(0, 24).join(" | ");

  // cột `fts` (tsvector sinh sẵn + GIN) — không kéo về process
  const { fts: _fts, ...docCols } = getTableColumns(documents);
  void _fts;
  const fts = q
    ? await db
        .select(docCols)
        .from(documents)
        .where(sql`${documents.fts} @@ to_tsquery('simple', ${q})`)
        .orderBy(sql`ts_rank_cd(${documents.fts}, to_tsquery('simple', ${q})) desc`)
        .limit(120)
    : [];

  const laneTypes =
    u.intent === "legal" ? ["law", "government"]
    : u.intent === "market_price" ? ["news"]
    : u.intent === "weather" ? ["government", "news"]
    : u.intent === "compare" ? ["product", "news", "community"]
    : [];
  const lane = laneTypes.length
    ? await db.select(docCols).from(documents).where(inArray(documents.sourceType, laneTypes)).orderBy(desc(documents.authority), sql`${documents.publishedAt} desc nulls last`).limit(30)
    : [];

  const byId = new Map<string, (typeof fts)[number]>();
  for (const d of [...fts, ...lane]) byId.set(d.id, d);
  return [...byId.values()];
}

const SOURCE_TRUST: Record<string, number> = {
  osm: 8,
  registry: 10,
  merchant: 9,
  web: 2,
};

// --- Documents evidence retrieval (mọi lane đều dùng) ------------------------
export async function retrieveDocs(u: QueryUnderstanding, units: AdminUnit[]): Promise<ScoredDoc[]> {
  const docPool = await docCandidates(u);
  const queryNodes = [...u.tokens].filter((t) => t.length > 2);
  const scoredDocs: ScoredDoc[] = docPool.map((d) => {
    const why: string[] = [];
    let score = 0;
    const hay = `${d.titleSearch} ${d.contentSearch}`;
    let overlap = 0;
    for (const t of queryNodes) {
      if (hay.includes(t)) overlap++;
    }
    if (queryNodes.length) score += (overlap / queryNodes.length) * 30;
    if (u.specialty) {
      const sp = normalize(u.specialty);
      if (hay.includes(sp)) {
        score += 20;
        why.push(`có nhắc "${u.specialty}"`);
      }
    }
    for (const l of u.locations) {
      const short = l.unit.nameSearch.replace(/^(tinh|tp|thanh pho|huyen|thi xa|xa|phuong) /, "");
      if (hay.includes(short)) {
        score += 12;
        why.push(`đúng địa danh ${l.unit.name}`);
      }
    }
    for (const t of u.compareTargets ?? []) {
      if (hay.includes(normalize(t.replace(/^(VinFast|Hyundai)\s?/i, "").trim())) || hay.includes(normalize(t))) {
        score += 16;
        why.push(`có mặt ${t}`);
      }
    }
    for (const e of d.entities) {
      if (
        u.tokens.some((t) => e.replace(/-/g, " ").includes(t)) ||
        (u.specialty && normalize(u.specialty).replace(/ /g, "-") === e)
      ) {
        score += 5;
      }
    }
    if (u.intent === "legal" && (d.sourceType === "law" || d.sourceType === "government")) {
      score += 24;
      why.push("nguồn chính thống");
    }
    if (u.intent === "market_price" && d.sourceType === "news") score += 12;
    if (u.intent === "weather" && (d.sourceType === "government" || d.sourceType === "news")) score += 14;
    score += d.authority * 14;
    if (u.freshness === "today") score += freshnessScore(d.publishedAt, 3) * 18;
    else score += freshnessScore(d.publishedAt, 60) * 8;

    return { ...d, score, why, origin: "corpus" as const };
  });
  return scoredDocs
    .filter((d) => d.score > 24)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function textHit(needle: string, hay: string): number {
  if (!needle || !hay) return 0;
  if (hay.includes(needle)) return needle.length > 4 ? 2 : 1.5;
  const parts = needle.split(" ");
  const hit = parts.filter((p) => p.length > 1 && hay.includes(p)).length;
  return parts.length ? hit / parts.length : 0;
}

export async function retrieve(u: QueryUnderstanding, opts: RetrieveOptions = {}): Promise<RetrievalResult> {
  const t0 = performance.now();
  const units = await loadUnits();
  const byId = new Map(units.map((x) => [x.id, x]));

  // Chỉ local_search mới chạm tới Canonical Places (SourceRouter policy)
  if (u.intent !== "local_search") {
    const docs0 = await retrieveDocs(u, units);
    return {
      places: { exact: [], related: [], unverified: [], candidates: [] },
      docs: docs0,
      coverage: { gap: false, reason: null, widened: false },
      anchor: null,
      scope: { provinces: [], communes: [] },
    };
  }

  // --- Anchor địa lý ------------------------------------------------------------
  let anchor: RetrievalResult["anchor"] = null;
  const locUnits = u.locations.map((l) => l.unit);
  const primaryCommune = locUnits.find((x) => x.type === "commune" && x.status === "current");
  const primaryProv =
    locUnits.find((x) => x.type === "province" && x.status === "current") ??
    (u.resolvedCurrentIds.map((id) => byId.get(id)).find((x) => x && x.type === "province") as AdminUnit | undefined);
  const resolvedCommune = u.resolvedCurrentIds.map(id => byId.get(id)).find(unit => unit?.type === "commune");
  const anchorUnit = primaryCommune ?? resolvedCommune ?? primaryProv;
  if (anchorUnit?.lat && anchorUnit?.lng) {
    anchor = { lat: anchorUnit.lat, lng: anchorUnit.lng, label: anchorUnit.name };
  }
  const userAnchored = !anchor && !!opts.userLoc;
  if (userAnchored && opts.userLoc) {
    anchor = { lat: opts.userLoc.lat, lng: opts.userLoc.lng, label: "vị trí của bạn" };
  }
  const nearbyQuery = /(?:^| )(gan|neo)(?: |$)/.test(u.normalized);
  const nearRadius = opts.nearRadiusKm ?? (nearbyQuery ? 5 : 30);

  // --- Places --------------------------------------------------------------------
  const provinceScope = new Set<string>();
  const communeScope = new Set<string>();
  for (const id of u.resolvedCurrentIds) {
    const unit = byId.get(id);
    if (!unit) continue;
    if (unit.type === "province") provinceScope.add(id);
    if (unit.type === "commune") {
      communeScope.add(id);
      if (unit.parentId) provinceScope.add(unit.parentId);
    }
    if (unit.type === "district" && unit.parentId) provinceScope.add(unit.parentId);
  }
  const hasLocation = provinceScope.size > 0 || communeScope.size > 0;

  const pool = await placeCandidatesSQL(u, { provinces: provinceScope, communes: communeScope, anchor, userAnchored, radiusKm: nearRadius });

  const scored: ScoredPlace[] = pool.map((p) => {
    const why: string[] = [];
    let score = 0;
    const inCommune = p.communeId ? communeScope.has(p.communeId) : false;
    const inProvince = provinceScope.has(p.provinceId);

    // Text relevance
    let specialtyMax = 0;
    for (const term of u.specialtyTerms) {
      const n = normalize(term);
      if (n.length < 2) continue;
      const hitName = textHit(n, p.nameSearch);
      const hitSpec = textHit(n, p.specialtiesSearch);
      const hitAddr = textHit(n, p.addressSearch);
      specialtyMax = Math.max(specialtyMax, hitSpec * 22 + hitName * 16 + hitAddr * 4);
    }
    if (u.specialty) {
      const nSp = normalize(u.specialty);
      if (p.specialtiesSearch.includes(nSp)) {
        specialtyMax += 18;
        why.push(`đúng chuyên ngành “${u.specialty}”`);
      }
      if (p.nameSearch.includes(nSp)) specialtyMax += 8;
    }
    if (u.categories.includes(p.category)) {
      score += 14;
      why.push(`category = ${p.categoryLabel}`);
    }
    score += specialtyMax;

    // Geo relevance
    if (hasLocation) {
      if (inCommune) {
        score += 30;
        why.push("đúng địa bàn");
      } else if (inProvince) {
        score += 12;
      } else {
        score -= 26; // ngoài khu vực → phạt nặng (precision-first)
        why.push("ngoài khu vực hỏi");
      }
    }
    let distanceKm: number | null = null;
    if (anchor && p.lat && p.lng) {
      distanceKm = haversineKm(anchor.lat, anchor.lng, p.lat, p.lng);
      score += clamp(8 - distanceKm * 0.5, -10, 8);
    }

    // Authority / trust
    score += SOURCE_TRUST[p.source] ?? 0;
    if (p.verified) {
      score += 6;
      why.push("đã xác minh");
    }
    if (p.rating) score += clamp(p.rating - 3.6, 0, 1.2) * 5;
    if (p.reviewCount) score += Math.min(4, Math.log10(1 + p.reviewCount) * 1.6);

    // Không có specialty → dùng token chung
    if (!u.specialty && u.intent === "local_search") {
      for (const t of u.tokens) {
        if (t.length > 2 && (p.nameSearch.includes(t) || p.specialtiesSearch.includes(t))) score += 3;
      }
    }

    const strictSpecialty = u.specialty === "giò chả" || u.specialty === "sắt thép";
    const specialtyMatch = u.specialty
      ? p.specialtiesSearch.includes(normalize(u.specialty)) || (!strictSpecialty && u.categories.includes(p.category))
      : u.categories.includes(p.category);
    const geoMatch = hasLocation ? (communeScope.size ? inCommune : inProvince) : userAnchored ? distanceKm !== null && distanceKm <= nearRadius : false;
    const exact = specialtyMatch && geoMatch && (!nearbyQuery || !anchor || (distanceKm !== null && distanceKm <= nearRadius));
    if (userAnchored && distanceKm !== null) score += clamp(10 - distanceKm * 0.8, -12, 10);
    return { ...p, score, exact, distanceKm, why };
  });

  // Phân nhóm: exact verified / exact unverified / related (cùng tỉnh, khác chuyên ngành)
  const relevantPool = scored.filter((p) =>
    hasLocation
      ? (communeScope.size ? communeScope.has(p.communeId ?? "") : provinceScope.has(p.provinceId)) && (!nearbyQuery || p.distanceKm !== null && p.distanceKm <= nearRadius)
      : userAnchored ? p.distanceKm !== null && p.distanceKm <= nearRadius * 2 : true
  );
  const exactAll = relevantPool
    .filter((p) => p.exact && p.score > 14)
    .sort((a, b) => b.score - a.score);
  const specCat = u.categories[0];
  const specIsFood = specCat ? FOOD_CATS.has(specCat) : null;
  const relatedPool = !hasLocation && !userAnchored
    ? []
    : relevantPool
        .filter((p) => !exactAll.some((e) => e.id === p.id) && p.score > 6)
        .filter((p) => {
          if (!specCat) return true;
          // related ăn uống chỉ gợi ý ăn uống — không trộn cây xăng/nhà nghỉ
          if (specIsFood) return FOOD_CATS.has(p.category);
          return p.category === specCat;
        })
        .sort((a, b) => {
          const aCat = a.category === specCat ? 8 : 0;
          const bCat = b.category === specCat ? 8 : 0;
          return b.score + bCat - (a.score + aCat);
        })
        .slice(0, 8);
  // Trần kết quả: ở quy mô lớn danh sách exact có thể lên hàng trăm → luôn cắt theo điểm
  const exactVerified = exactAll.filter((p) => p.verified).slice(0, 20);
  const exactUnverified = exactAll.filter((p) => !p.verified).slice(0, 10);

  // --- Flywheel candidates --------------------------------------------------------
  let cands: PlaceCandidate[] = [];
  let coverageGap = false;
  let gapReason: string | null = null;
  if (u.intent === "local_search") {
    const allCands = await db
      .select()
      .from(placeCandidates)
      .where(and(eq(placeCandidates.status, "pending"), provinceScope.size ? inArray(placeCandidates.provinceId, [...provinceScope]) : undefined))
      .limit(200);
    cands = allCands.filter((c) => {
      const sp = u.specialty ? (c.specialtySearch ?? "").includes(normalize(u.specialty)) : false;
      const geo = !hasLocation || provinceScope.has(c.provinceId ?? "");
      const addrHit = hasLocation
        ? locUnits.some((lu) => lu.type !== "province" && (c.addressSearch ?? "").includes(lu.nameSearch.replace(/^(xa|phuong|thi tran|huyen|tp) /, "")))
        : true;
      return (sp || (u.specialty && (c.specialtySearch ?? "") === normalize(u.specialty))) && geo && addrHit;
    });
    if (exactVerified.length === 0 && exactUnverified.length === 0) {
      coverageGap = true;
      gapReason = !hasLocation && !userAnchored
        ? "Cần địa danh hoặc vị trí của bạn để xác định khu vực tìm kiếm."
        : u.specialty ? `Chưa có địa điểm canonical nào đủ bằng chứng bán “${u.specialty}” tại khu vực này`
        : "Chưa có địa điểm canonical phù hợp tại khu vực này";
    } else if (exactVerified.length === 0) {
      gapReason = "Có dữ liệu từ web nhưng chưa đủ bằng chứng xác minh";
    }
  }

  // --- Documents ------------------------------------------------------------------
  const docs = await retrieveDocs(u, units);

  void t0;
  return {
    places: { exact: exactVerified, unverified: exactUnverified, related: relatedPool, candidates: cands },
    docs,
    coverage: { gap: coverageGap, reason: gapReason, widened: hasLocation && exactAll.length === 0 && relatedPool.length > 0 },
    anchor,
    scope: { provinces: [...provinceScope], communes: [...communeScope] },
  };
}
