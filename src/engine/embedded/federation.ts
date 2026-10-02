// ---------------------------------------------------------------------------
// VietScope · Source Federation
// Provider "search-hub" = search-router của repo VietScope (SearXNG, OpenSearch,
// Qdrant, reader…) gọi qua HTTP. Không cấu hình → lane tự tắt, hệ thống vẫn chạy
// bằng canonical places + corpus nội bộ.
//   SEARCH_HUB_URL      vd http://search-router:8888
//   SEARCH_HUB_API_KEY  Bearer key (dsa_live_…)
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { placeCandidates } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ScoredDoc } from "./retrieve";
import type { QueryUnderstanding } from "./understand";
import { clamp, normalize } from "@/lib/vi";

import type { ProviderStatus } from "@/core/contract";
export type { ProviderStatus };

export function hubConfig(): { url: string; key: string | null } | null {
  const url = process.env.SEARCH_HUB_URL?.trim().replace(/\/+$/, "");
  if (!url) return null;
  return { url, key: process.env.SEARCH_HUB_API_KEY?.trim() || null };
}

// --- circuit breaker đơn giản (closed → open sau 3 lỗi liên tiếp, half-open sau 30s)
const circuit = { fails: 0, openUntil: 0 };

function headers(key: string | null): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (key) h.authorization = `Bearer ${key}`;
  return h;
}

function mapSourceType(lane: string | null | undefined, authority: string | null | undefined, domain: string): ScoredDoc["sourceType"] {
  const s = `${lane ?? ""} ${authority ?? ""} ${domain}`.toLowerCase();
  if (/\.gov\.vn|gov|official|government/.test(s)) return "government";
  if (/legal|law|vbpl|congbao/.test(s)) return "law";
  if (/news|press|bao/.test(s)) return "news";
  if (/forum|social|community|reddit|facebook/.test(s)) return "community";
  if (/product|ecom|shop|retail/.test(s)) return "product";
  return "web";
}

interface HubSource {
  source_id?: string;
  title?: string;
  url?: string;
  canonical_url?: string;
  domain?: string;
  description?: string;
  content?: string;
  score?: number;
  authority_score?: number | null;
  authority_type?: string | null;
  source_lane?: string | null;
  published_at?: string | null;
  fingerprint?: string;
}

export async function searchHub(
  query: string,
  opts: { maxResults: number; mode: "fast" | "balanced" | "deep"; timeoutMs: number }
): Promise<{ docs: ScoredDoc[]; status: ProviderStatus }> {
  const t0 = performance.now();
  const base = { provider: "search-hub", lane: "web · news · gov · legal" };
  const cfg = hubConfig();
  if (!cfg) {
    return { docs: [], status: { ...base, status: "disabled", ms: 0, count: 0, detail: "chưa cấu hình SEARCH_HUB_URL" } };
  }
  if (Date.now() < circuit.openUntil) {
    return { docs: [], status: { ...base, status: "circuit_open", ms: 0, count: 0, detail: "provider tạm ngắt sau nhiều lỗi liên tiếp" } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${cfg.url}/v1/search`, {
      method: "POST",
      headers: headers(cfg.key),
      body: JSON.stringify({
        query,
        max_results: opts.maxResults,
        mode: opts.mode,
        language: "vi",
        citations: false,
        stream: false,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { results?: HubSource[] };
    const now = new Date();
    const docs: ScoredDoc[] = (json.results ?? [])
      .filter((r) => r.url && r.title)
      .map((r, i) => {
        const url = r.canonical_url || r.url!;
        let domain = r.domain || "";
        if (!domain) {
          try {
            domain = new URL(url).hostname.replace(/^www\./, "");
          } catch {
            domain = "unknown";
          }
        }
        const content = (r.content || r.description || "").slice(0, 12000);
        const snippet = (r.description || content).slice(0, 320);
        return {
          id: `hub-${r.fingerprint || r.source_id || i}`,
          title: r.title!,
          titleSearch: normalize(r.title!),
          url,
          domain,
          sourceType: mapSourceType(r.source_lane, r.authority_type, domain),
          snippet,
          content,
          contentSearch: normalize(content),
          authority: clamp(r.authority_score ?? 0.5, 0, 1),
          publishedAt: r.published_at ? new Date(r.published_at) : null,
          entities: [],
          createdAt: now,
          score: r.score ?? 0,
          why: ["Search Hub"],
          origin: "search-hub" as const,
        };
      });
    circuit.fails = 0;
    return {
      docs,
      status: { ...base, status: docs.length ? "ok" : "empty", ms: Math.round(performance.now() - t0), count: docs.length },
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    circuit.fails++;
    if (circuit.fails >= 3) circuit.openUntil = Date.now() + 30_000;
    return {
      docs: [],
      status: {
        ...base,
        status: aborted ? "timeout" : "error",
        ms: Math.round(performance.now() - t0),
        count: 0,
        detail: aborted ? `quá ${opts.timeoutMs}ms` : e instanceof Error ? e.message : "unknown",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function hubHealth(): Promise<{ configured: boolean; ok: boolean | null; ms: number | null; detail?: string }> {
  const cfg = hubConfig();
  if (!cfg) return { configured: false, ok: null, ms: null };
  const t0 = performance.now();
  try {
    const res = await fetch(`${cfg.url}/v1/health`, { headers: headers(cfg.key), signal: AbortSignal.timeout(2500), cache: "no-store" });
    return { configured: true, ok: res.ok, ms: Math.round(performance.now() - t0), detail: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { configured: true, ok: false, ms: Math.round(performance.now() - t0), detail: e instanceof Error ? e.message : "unreachable" };
  }
}

// --- Normalize / dedup / RRF ------------------------------------------------------
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const params = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|fbclid|gclid|ref$)/i.test(k));
    const q = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
    return `${host}${u.pathname.replace(/\/+$/, "")}${q}`;
  } catch {
    return raw.toLowerCase();
  }
}

/** Reciprocal Rank Fusion + dedup theo URL chuẩn hoá. Giữ bản có authority cao hơn. */
export function fuseRRF(lanes: ScoredDoc[][], limit: number, k = 60): ScoredDoc[] {
  const acc = new Map<string, { doc: ScoredDoc; rrf: number; lanes: Set<string> }>();
  lanes.forEach((lane, li) => {
    lane.forEach((doc, rank) => {
      const key = canonicalUrl(doc.url);
      const add = 1 / (k + rank + 1);
      const cur = acc.get(key);
      if (!cur) {
        acc.set(key, { doc, rrf: add, lanes: new Set([`${li}`]) });
      } else {
        cur.rrf += add;
        cur.lanes.add(`${li}`);
        if (doc.authority > cur.doc.authority) cur.doc = { ...doc, origin: cur.doc.origin };
      }
    });
  });
  return [...acc.values()]
    .map(({ doc, rrf, lanes: l }) => ({
      ...doc,
      score: Math.round(rrf * 10000) / 10 + (l.size > 1 ? 5 : 0),
      why: l.size > 1 ? [...doc.why, "xuất hiện ở nhiều lane (corroborated)"] : doc.why,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Data flywheel: kết quả web cho truy vấn local chưa có canonical → place_candidates (pending). */
export async function stageCandidatesFromWeb(
  u: QueryUnderstanding,
  hubDocs: ScoredDoc[],
  provinceId: string | null,
  max = 4
): Promise<number> {
  if (!u.specialty || hubDocs.length === 0) return 0;
  // Precision-first: chỉ staging nguồn có nhắc tới địa bàn hỏi (tên gõ, tên đơn vị, hoặc đơn vị hiện hành sau sáp nhập)
  const locTerms = new Set<string>();
  for (const l of u.locations) {
    locTerms.add(l.matchedTerm);
    locTerms.add(l.unit.nameSearch.replace(/^(tinh|tp|thanh pho|huyen|thi xa|xa|phuong) /, ""));
  }
  for (const t of u.transition?.to ?? []) locTerms.add(normalize(t).replace(/^(tinh|tp|thanh pho|huyen|thi xa|xa|phuong) /, ""));
  const mentionsArea = (d: ScoredDoc) => locTerms.size === 0 || [...locTerms].some((t) => t.length >= 3 && `${d.titleSearch} ${d.contentSearch}`.includes(t));
  let staged = 0;
  for (const d of hubDocs.filter(mentionsArea).slice(0, max)) {
    try {
      const existing = await db.select({ id: placeCandidates.id }).from(placeCandidates).where(eq(placeCandidates.sourceUrl, d.url)).limit(1);
      if (existing.length) continue;
      const name = d.title.split(/\s[-|–—]\s/)[0].slice(0, 120);
      await db.insert(placeCandidates).values({
        name,
        nameSearch: normalize(name),
        specialty: u.specialty,
        specialtySearch: normalize(u.specialty),
        address: u.locations[0]?.unit.name ?? null,
        addressSearch: u.locations[0] ? normalize(u.locations[0].unit.name) : null,
        provinceId,
        sourceUrl: d.url,
        sourceTitle: d.title.slice(0, 200),
        evidence: d.snippet.slice(0, 300),
        status: "pending",
        discoveredVia: "search-hub",
      });
      staged++;
    } catch {
      /* bỏ qua lỗi từng bản ghi */
    }
  }
  return staged;
}
