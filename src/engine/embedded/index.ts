// ---------------------------------------------------------------------------
// VietScope · Embedded engine — IMPLEMENTATION THAM CHIẾU của Retrieval Contract v1
//
// Vai trò: dev/offline, fixture cho benchmark VN_GOLDEN, và là "đặc tả chạy được" để port sang
// search-router (xem docs/PORTING-TO-SEARCH-ROUTER.md). KHÔNG phải bộ não production.
//
// Quy tắc ranh giới (scripts/check-boundaries.mjs kiểm tra):
//   • chỉ src/core/backend.ts được import module này (dynamic import)
//   • facade (src/lib, src/app) không đọc bảng của brain (places/documents/admin_units/…)
// Khi RETRIEVAL_BACKEND=search-router, module này KHÔNG được nạp → chỉ còn một retrieval brain.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { adminUnits, coverageGaps, documents, placeCandidates, places } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import type { BackendDescription, PromoteArgs, RetrievalBackend } from "@/core/backend";
import type {
  BudgetDTO, CandidateDTO, DocDTO, PlaceDTO, ProviderStatus, QualityDTO, RetrieveRequest, RetrieveResult, UnderstandingDTO,
} from "@/core/contract";
import { clamp, formatDistance, isOpenNow } from "@/lib/vi";
import { callOptsForBudget, planWithLLM } from "@/lib/inference";
import { understandQuery, type QueryUnderstanding } from "./understand";
import { chooseBudget } from "./budget";
import { invalidateUnitsCache, loadUnits, retrieve, retrieveDocs, type RetrievalResult, type ScoredDoc, type ScoredPlace } from "./retrieve";
import { fuseRRF, hubConfig, hubHealth, searchHub, stageCandidatesFromWeb } from "./federation";
import { listGaps, promoteCandidate, recordCoverageGap } from "./coverage";
import { ensureIndexes } from "./indexes";
import { pilotCommand, pilotSnapshot, recordPilotDemand } from "./pilot";
import { normalize } from "@/lib/vi";

// --- mapping nội bộ → DTO ------------------------------------------------------------
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

function toPlaceDTO(p: ScoredPlace): PlaceDTO {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    categoryLabel: p.categoryLabel,
    address: p.address,
    provinceId: p.provinceId,
    specialties: p.specialties,
    rating: p.rating,
    reviewCount: p.reviewCount ?? 0,
    priceLabel: p.priceLabel,
    phone: p.phone,
    hours: p.open24 ? "Mở cửa 24/7" : p.hours,
    openNow: isOpenNow(p.hours, p.open24),
    distanceKm: p.distanceKm,
    distanceLabel: formatDistance(p.distanceKm),
    image: p.image,
    source: p.source,
    verified: p.verified,
    verificationLevel: p.verified ? "verified" : "observed",
    note: p.note,
    score: Math.round(p.score * 10) / 10,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    updatedAt: iso(p.updatedAt),
    why: p.why,
  };
}

function toDocDTO(d: ScoredDoc): DocDTO {
  return {
    id: d.id,
    title: d.title,
    url: d.url,
    domain: d.domain,
    sourceType: d.sourceType as DocDTO["sourceType"],
    snippet: d.snippet,
    content: d.content,
    authority: d.authority,
    publishedAt: iso(d.publishedAt),
    entities: d.entities ?? [],
    score: Math.round(d.score * 10) / 10,
    why: d.why,
    origin: d.origin ?? "corpus",
  };
}

function toUnderstandingDTO(u: QueryUnderstanding): UnderstandingDTO {
  return {
    raw: u.raw,
    normalized: u.normalized,
    tokens: u.tokens,
    intent: u.intent,
    intentLabel: u.intentLabel,
    specialty: u.specialty,
    categories: u.categories,
    freshness: u.freshness,
    locations: u.locations.map((l) => ({ id: l.unit.id, name: l.unit.name, type: l.unit.type, status: l.unit.status, matchedTerm: l.matchedTerm, fuzzy: !!l.fuzzy })),
    resolvedCurrentIds: u.resolvedCurrentIds,
    transition: u.transition,
    compareTargets: u.compareTargets,
    fuzzy: { used: u.fuzzyUsed, notes: u.fuzzyNotes },
  };
}

// --- quality gate của RETRIEVAL (chưa gồm verification — việc của facade) ----------------
function retrievalQuality(u: QueryUnderstanding, r: RetrievalResult, docs: ScoredDoc[]): QualityDTO {
  const independent = new Set(docs.map((d) => d.domain)).size;
  const top = docs.slice(0, 3);
  const avgAuthority = top.length ? top.reduce((s, d) => s + d.authority, 0) / top.length : 0;
  const official = docs.some((d) => d.sourceType === "law" || d.sourceType === "government");
  let conf: number;
  if (u.intent === "local_search") {
    const ev = r.places.exact.length;
    const un = r.places.unverified.length;
    conf = ev > 0 ? 0.6 + Math.min(0.25, 0.08 * ev) : un > 0 ? 0.3 + Math.min(0.1, 0.05 * un) : 0.08;
    conf += Math.min(0.08, 0.03 * docs.filter((d) => d.why.some((w) => w.includes("nhắc"))).length);
  } else if (docs.length === 0) {
    conf = 0.05;
  } else {
    conf = 0.2 + 0.35 * avgAuthority + 0.07 * Math.min(4, independent) + ((u.intent === "legal" || u.intent === "weather") && official ? 0.12 : 0);
  }
  const confidence = Math.round(clamp(conf, 0, 0.97) * 100) / 100;
  return {
    confidence,
    coverage: confidence >= 0.7 ? "good" : confidence >= 0.35 ? "partial" : "none",
    independentSources: independent,
    avgAuthority: Math.round(avgAuthority * 100) / 100,
  };
}

// --- multi-hop (RESEARCH): gap analysis → sub-queries → thêm lane --------------------------
async function multiHopLanes(u: QueryUnderstanding, units: Awaited<ReturnType<typeof loadUnits>>, mainDocs: ScoredDoc[]) {
  const plan = await planWithLLM(u.raw, u, mainDocs.map((d) => d.title), callOptsForBudget("research"));
  if (plan) {
    const lanes: ScoredDoc[][] = [];
    for (const sq of plan.subqueries) lanes.push(await retrieveDocs(understandQuery(sq, units), units));
    return { lanes, subqueries: plan.subqueries, planner: `llm:${plan.model}` };
  }
  const covered = mainDocs.map((d) => `${d.titleSearch} ${d.contentSearch}`).join(" ");
  const FILLER = new Set(["nghien", "cuu", "xu", "huong", "phan", "tich", "bao", "cao", "nam", "tong", "quan", "toan", "canh", "du", "danh", "gia"]);
  const uncovered = u.tokens.filter((t) => t.length > 3 && !FILLER.has(t) && !/^\d+$/.test(t) && !covered.includes(t));
  const subs = new Set<string>();
  u.raw
    .split(/\s+(?:và|với|so với|cũng như)\s+|[,;]/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 6 && s !== u.raw)
    .forEach((s) => subs.add(s));
  if (uncovered.length) subs.add(uncovered.slice(0, 3).join(" "));
  const core = u.tokens.filter((t) => !FILLER.has(t) && !/^\d+$/.test(t)).slice(0, 4);
  if (core.length) subs.add(`${core.join(" ")} số liệu mới nhất`);
  const subqueries = [...subs].slice(0, 3);
  const lanes: ScoredDoc[][] = [];
  for (const sq of subqueries) lanes.push(await retrieveDocs(understandQuery(sq, units), units));
  return { lanes, subqueries, planner: "deterministic" };
}

// --- retrieve: understand → budget → retrieve → widen → RRF → flywheel --------------------------
async function retrieveEmbedded(req: RetrieveRequest): Promise<RetrieveResult> {
  await ensureIndexes();
  const t0 = performance.now();
  const units = await loadUnits();
  const tUnits = performance.now();

  const widening: string[] = [];
  let effective = req.query;
  if (req.context && req.query.trim().split(/\s+/).length < 5) {
    const uLast = understandQuery(req.query, units);
    const uPrev = understandQuery(req.context, units);
    if (!uLast.locations.length && uPrev.locations.length) {
      effective = `${effective} ${uPrev.locations[0].matchedTerm}`;
      widening.push(`ngữ cảnh hội thoại: kế thừa địa danh “${uPrev.locations[0].unit.name}”`);
    }
    if (!uLast.specialty && uPrev.specialty) {
      effective = `${uPrev.specialty} ${effective}`;
      widening.push(`ngữ cảnh hội thoại: kế thừa chuyên ngành “${uPrev.specialty}”`);
    }
  }
  const u = understandQuery(effective, units);
  const tUnderstand = performance.now();

  const policy = chooseBudget(u, req.mode ?? "auto");
  const federation: ProviderStatus[] = [];
  const hubQuery = u.transition?.to.length ? `${u.raw} ${u.transition.to[u.transition.to.length - 1]}` : u.raw;
  const hubOpts = { maxResults: Math.max(policy.maxSources, 5), mode: policy.hubMode, timeoutMs: policy.hubTimeoutMs } as const;

  const tR0 = performance.now();
  let r: RetrievalResult;
  let hubDocs: ScoredDoc[] = [];
  if (u.intent === "local_search") {
    r = await retrieve(u, { userLoc: req.location });
    const n = r.places.exact.length + r.places.unverified.length;
    federation.push({ provider: "canonical-places", lane: "places · SQL candidate generation", status: n ? "ok" : "empty", ms: Math.round(performance.now() - tR0), count: n });
    if (r.places.exact.length < 2 && hubConfig()) {
      widening.push(`canonical chỉ có ${r.places.exact.length} địa điểm xác minh → mở rộng sang web (Search Hub)`);
      const h = await searchHub(hubQuery, hubOpts);
      hubDocs = h.docs;
      federation.push(h.status);
    } else {
      federation.push({ provider: "search-hub", lane: "web · news · gov · legal", status: "skipped", ms: 0, count: 0, detail: hubConfig() ? "canonical đã đủ — không fan-out" : "chưa cấu hình SEARCH_HUB_URL" });
    }
  } else {
    const [rr, h] = await Promise.all([retrieve(u, { userLoc: req.location }), searchHub(hubQuery, hubOpts)]);
    r = rr;
    hubDocs = h.docs;
    federation.push(h.status);
  }
  federation.splice(u.intent === "local_search" ? 1 : 0, 0, { provider: "corpus", lane: "documents · full-text (GIN)", status: r.docs.length ? "ok" : "empty", ms: Math.round(performance.now() - tR0), count: r.docs.length });

  let extraLanes: ScoredDoc[][] = [];
  if (policy.multiHop) {
    const hop = await multiHopLanes(u, units, r.docs);
    extraLanes = hop.lanes;
    widening.push(`gap analysis (${hop.planner}) → ${hop.subqueries.length} sub-query: ${hop.subqueries.map((s) => `“${s}”`).join(" · ")}`);
    federation.push({ provider: "multi-hop", lane: "research planner", status: extraLanes.some((l) => l.length) ? "ok" : "empty", ms: Math.round(performance.now() - tR0), count: extraLanes.reduce((s, l) => s + l.length, 0) });
  }
  const tRetrieve = performance.now();

  const limit = Math.max(8, policy.maxSources);
  const lanes = [r.docs, ...extraLanes, hubDocs].filter((l) => l.length > 0);
  const fused = lanes.length > 1 ? fuseRRF(lanes, limit) : (lanes[0] ?? []).slice(0, limit);
  const tFuse = performance.now();

  if (req.record !== false && u.intent === "local_search" && hubDocs.length && r.places.exact.length < 2) {
    const staged = await stageCandidatesFromWeb(u, hubDocs, r.scope.provinces[0] ?? null);
    if (staged) widening.push(`flywheel: đưa ${staged} ứng viên địa điểm mới vào staging (pending verify)`);
  }

  const result: RetrievalResult = { ...r, docs: fused };
  if (req.record !== false) {
    await Promise.all([recordCoverageGap(u, result), recordPilotDemand(u, result)]).catch(e => console.error("coverage write failed", e));
  }

  const budget: BudgetDTO = { name: policy.budget, reason: policy.reason, targetMs: policy.targetMs, multiHop: policy.multiHop, readEvidence: policy.readEvidence };
  const toCand = (c: (typeof r.places.candidates)[number]): CandidateDTO => ({ id: c.id, name: c.name, specialty: c.specialty, address: c.address, sourceUrl: c.sourceUrl, sourceTitle: c.sourceTitle, evidence: c.evidence });
  return {
    backend: "embedded",
    understanding: toUnderstandingDTO(u),
    budget,
    places: { exact: r.places.exact.map(toPlaceDTO), unverified: r.places.unverified.map(toPlaceDTO), related: r.places.related.map(toPlaceDTO), candidates: r.places.candidates.map(toCand) },
    docs: fused.map(toDocDTO),
    coverage: r.coverage,
    anchor: r.anchor,
    scope: r.scope,
    quality: retrievalQuality(u, result, fused),
    federation,
    widening,
    timings: {
      load_graph_ms: Math.round(tUnits - t0),
      understand_ms: Math.round(tUnderstand - tUnits),
      retrieve_ms: Math.round(tRetrieve - tUnderstand),
      rerank_ms: Math.round(tFuse - tRetrieve),
      total_ms: Math.round(performance.now() - t0),
    },
  };
}

// --- các khả năng phụ (dữ liệu của brain) ------------------------------------------------------
async function count(t: typeof places | typeof documents | typeof adminUnits | typeof placeCandidates) {
  const [r] = await db.select({ c: sql<number>`count(*)` }).from(t);
  return Number(r?.c ?? 0);
}

async function describe(): Promise<BackendDescription> {
  const [pl, dc, ad, cd, hub, gaps, open] = await Promise.all([
    count(places), count(documents), count(adminUnits), count(placeCandidates), hubHealth(), listGaps(5),
    db.select({ c: sql<number>`count(*)` }).from(coverageGaps).where(eq(coverageGaps.status, "open")),
  ]);
  const cfg = hubConfig();
  return {
    id: "embedded",
    lanes: [
      { id: "canonical-places", lane: "places", enabled: true, records: pl },
      { id: "corpus", lane: "documents · evidence", enabled: true, records: dc },
      { id: "admin-graph", lane: "địa giới hành chính", enabled: true, records: ad },
      { id: "search-hub", lane: "web · news · gov · legal (lane tuỳ chọn, chỉ cho engine embedded)", enabled: !!cfg, endpoint: cfg?.url ?? null, health: hub },
    ],
    flywheel: {
      place_candidates: cd,
      coverage_gaps_open: Number(open[0]?.c ?? 0),
      top_gaps: gaps.map((g) => ({ query: g.querySample, specialty: g.specialty, hits: g.hits, action: g.action })),
    },
    note: "Engine tham chiếu (dev/offline/benchmark). Production dùng RETRIEVAL_BACKEND=search-router.",
  };
}

export const embeddedBackend: RetrievalBackend = {
  id: "embedded",
  capabilities: { coverage: true, adminResolve: true, stats: true, pilot: true },
  pilotSnapshot,
  pilotCommand,
  retrieve: retrieveEmbedded,
  describe,

  async stats() {
    const [pl, ad, dc] = await Promise.all([count(places), count(adminUnits), count(documents)]);
    const [prov] = await db.select({ c: sql<number>`count(*)` }).from(adminUnits).where(sql`type = 'province' AND status = 'current'`);
    return { places: pl, adminUnits: ad, documents: dc, provinces: Number(prov?.c ?? 0) };
  },

  /** Vietnam Admin Graph: resolve địa danh (kể cả lịch sử) → đơn vị hiện hành + transition */
  async adminResolve(q: string) {
    const units = await loadUnits();
    const n = normalize(q);
    const matched = units.filter((u) => u.nameSearch === n || u.nameSearch.includes(n) || u.searchAliases.some((a) => a === n || a.includes(n)));
    const byId = new Map(units.map((u) => [u.id, u]));
    const out = matched.slice(0, 8).map((u) => ({
      id: u.id, name: u.name, type: u.type, status: u.status,
      parent: u.parentId ? (byId.get(u.parentId)?.name ?? u.parentId) : null,
      mergedInto: u.mergedInto ? { id: u.mergedInto, name: byId.get(u.mergedInto)?.name } : null,
      replacedBy: (u.replacedBy ?? []).map((id) => ({ id, name: byId.get(id)?.name })),
      mergedDate: u.mergedDate, aliases: u.aliases, lat: u.lat, lng: u.lng,
    }));
    return { query: q, count: out.length, results: out };
  },

  async coverage(limit: number) {
    const [gaps, pending, byStatus] = await Promise.all([
      listGaps(limit),
      db.select().from(placeCandidates).where(eq(placeCandidates.status, "pending")).orderBy(desc(placeCandidates.createdAt)).limit(limit),
      db.select({ status: placeCandidates.status, n: sql<number>`count(*)` }).from(placeCandidates).groupBy(placeCandidates.status),
    ]);
    return {
      gaps: gaps.map((g) => ({ id: g.id, key: g.key, intent: g.intent, specialty: g.specialty, province_id: g.provinceId, query_sample: g.querySample, reason: g.reason, hits: g.hits, status: g.status, action: g.action, last_seen_at: g.lastSeenAt })),
      candidates_pending: pending.map((c) => ({ id: c.id, name: c.name, specialty: c.specialty, address: c.address, province_id: c.provinceId, source_url: c.sourceUrl, source_title: c.sourceTitle, evidence: c.evidence, discovered_via: c.discoveredVia })),
      flywheel: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
    };
  },

  async promote(args: PromoteArgs) {
    const res = await promoteCandidate(args);
    invalidateUnitsCache();
    return res;
  },
};

// Móc kiểm thử: scripts/conformance.ts dùng cờ này để CHỨNG MINH khi RETRIEVAL_BACKEND=search-router
// engine embedded không hề được nạp (chỉ một retrieval brain tại runtime).
(globalThis as Record<string, unknown>).__vietscope_embedded_loaded = true;
