// ---------------------------------------------------------------------------
// VietScope · search-router adapter — backend PRODUCTION
//
// Facade KHÔNG tự ghép /v1/search + /v1/places/search + /v1/evidence: làm vậy là sao chép bộ não
// (routing, ranking) sang Next.js. Adapter chỉ gọi MỘT endpoint của brain:
//
//     POST {SEARCH_ROUTER_URL}/v1/retrieve        (Retrieval Contract v1 — docs/retrieve.contract.md)
//
// Snapshot production trong services/search-router đã mount endpoint này. 404/405 vẫn được xem là
// deployment drift và adapter báo 503 rõ ràng, không âm thầm chuyển engine.
// Không giữ state trong process (không circuit breaker cục bộ): chỉ timeout; trạng thái provider dùng chung ở core/Redis.
// ---------------------------------------------------------------------------
import { BackendUnavailableError, type BackendDescription, type RetrievalBackend } from "@/core/backend";
import type { RetrieveRequest, RetrieveResult } from "@/core/contract";
import { ContractError, fromWire, requestToWire } from "@/core/wire";

const DOC = "docs/PORTING-TO-SEARCH-ROUTER.md";

function cfg() {
  const url = process.env.SEARCH_ROUTER_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new BackendUnavailableError("RETRIEVAL_BACKEND=search-router nhưng chưa đặt SEARCH_ROUTER_URL");
  return {
    url,
    key: process.env.SEARCH_ROUTER_API_KEY?.trim() || null,
    timeoutMs: Math.max(1000, Number(process.env.SEARCH_ROUTER_TIMEOUT_MS ?? 30000)),
  };
}

function headers(key: string | null): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (key) h.authorization = `Bearer ${key}`;
  return h;
}

async function retrieve(req: RetrieveRequest): Promise<RetrieveResult> {
  const c = cfg();
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${c.url}/v1/retrieve`, {
      method: "POST",
      headers: headers(c.key),
      body: JSON.stringify(requestToWire(req)),
      signal: AbortSignal.timeout(c.timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new BackendUnavailableError(timeout ? `search-router quá ${c.timeoutMs}ms` : `không kết nối được search-router (${e instanceof Error ? e.message : "unknown"})`);
  }
  if (res.status === 404 || res.status === 405) {
    throw new BackendUnavailableError(`search-router chưa hỗ trợ POST /v1/retrieve (HTTP ${res.status}). Xem ${DOC}`);
  }
  if (res.status === 401 || res.status === 403) throw new BackendUnavailableError(`search-router từ chối API key (HTTP ${res.status})`);
  if (!res.ok) throw new BackendUnavailableError(`search-router lỗi HTTP ${res.status}`);

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new BackendUnavailableError("search-router trả về dữ liệu không phải JSON");
  }
  try {
    const out = fromWire(json, "search-router");
    out.timings = { ...out.timings, network_ms: Math.max(0, Math.round(performance.now() - t0) - (out.timings.total_ms ?? 0)) };
    return out;
  } catch (e) {
    if (e instanceof ContractError) throw new BackendUnavailableError(e.message);
    throw e;
  }
}

async function describe(): Promise<BackendDescription> {
  let c: ReturnType<typeof cfg> | null = null;
  try {
    c = cfg();
  } catch {
    return { id: "search-router", lanes: [{ id: "search-router", lane: "retrieval brain", enabled: false }], note: "chưa đặt SEARCH_ROUTER_URL" };
  }
  const t0 = performance.now();
  let health: unknown;
  let retrieveSupported: boolean | null = null;
  try {
    const r = await fetch(`${c.url}/v1/health`, { headers: headers(c.key), signal: AbortSignal.timeout(2500), cache: "no-store" });
    health = { ok: r.ok, ms: Math.round(performance.now() - t0), status: r.status };
  } catch (e) {
    health = { ok: false, ms: Math.round(performance.now() - t0), detail: e instanceof Error ? e.message : "unreachable" };
  }
  try {
    const r = await fetch(`${c.url}/v1/capabilities`, { headers: headers(c.key), signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { features?: unknown };
      retrieveSupported = JSON.stringify(j.features ?? j).includes("retrieve");
    }
  } catch {
    /* không bắt buộc */
  }
  return {
    id: "search-router",
    lanes: [{ id: "search-router", lane: "retrieval brain (SearXNG · OpenSearch · Qdrant · PostGIS)", enabled: true, endpoint: c.url, health: { ...(health as object), retrieve_contract_v1: retrieveSupported } }],
    note: retrieveSupported === false ? `search-router chưa quảng bá /v1/retrieve — xem ${DOC}` : undefined,
  };
}

export const searchRouterBackend: RetrievalBackend = {
  id: "search-router",
  capabilities: { coverage: true, adminResolve: true, stats: false },
  retrieve,
  /** Coverage signals sống trong retrieval brain (P-LEARNING-3) — facade chỉ đọc qua API, không ghi DB. */
  async coverage(limit: number) {
    const c = cfg();
    const r = await fetch(`${c.url}/v1/coverage/gaps?limit=${limit}`, { headers: headers(c.key), signal: AbortSignal.timeout(c.timeoutMs), cache: "no-store" });
    if (!r.ok) throw new BackendUnavailableError(`search-router /v1/coverage/gaps lỗi HTTP ${r.status}`);
    return { gaps: await r.json() };
  },
  describe,
  /** search-router đã có GET /v1/admin/resolve?q= — chuyển tiếp nguyên văn */
  async adminResolve(q: string) {
    const c = cfg();
    const r = await fetch(`${c.url}/v1/admin/resolve?q=${encodeURIComponent(q)}`, { headers: headers(c.key), signal: AbortSignal.timeout(c.timeoutMs), cache: "no-store" });
    if (!r.ok) throw new BackendUnavailableError(`search-router /v1/admin/resolve lỗi HTTP ${r.status}`);
    return r.json();
  },
};
