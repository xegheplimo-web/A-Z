// ---------------------------------------------------------------------------
// VietScope · Retrieval Contract v1
//
// Đây là RANH GIỚI duy nhất giữa hai nửa của hệ thống:
//
//   Facade (Next.js)  : vietscope-1 · OpenAI API · MCP · UI · auth · synthesis · verification
//   Retrieval Brain   : understand → route → federate → resolve → fuse → rerank → quality gate
//
// Chỉ có MỘT retrieval brain tại runtime (chọn bằng RETRIEVAL_BACKEND):
//   search-router → production (SearXNG, OpenSearch, Qdrant, PostGIS…)
//   embedded      → engine tham chiếu trong repo này (dev / offline / fixture benchmark)
//
// Mọi thứ phía facade chỉ được đọc các kiểu trong file này, không đọc bảng của brain.
// ---------------------------------------------------------------------------

export const CONTRACT_VERSION = "1";

export const INTENTS = ["local_search", "legal", "market_price", "weather", "compare", "admin_info", "product", "news", "general"] as const;
export type Intent = (typeof INTENTS)[number];

export type Budget = "fast" | "standard" | "research";
export type ModeInput = "auto" | "fast" | "standard" | "balanced" | "research" | "deep" | null | undefined;
export type SourceType = "law" | "government" | "news" | "community" | "product" | "web";

export interface ProviderStatus {
  provider: string;
  lane: string;
  status: "ok" | "empty" | "disabled" | "timeout" | "error" | "circuit_open" | "skipped";
  ms: number;
  count: number;
  detail?: string;
}

// --- request -------------------------------------------------------------------
export interface RetrieveRequest {
  query: string;
  /** câu hỏi người dùng ngay trước đó (hội thoại) — để brain kế thừa địa danh/chuyên ngành */
  context?: string | null;
  mode?: ModeInput;
  location?: { lat: number; lng: number } | null;
  maxResults?: number;
  /** false = không ghi coverage gap / trace phía brain (benchmark, test) */
  record?: boolean;
}

// --- response ------------------------------------------------------------------
export interface LocationDTO {
  id: string;
  name: string;
  type: string;
  status: string;
  matchedTerm: string;
  fuzzy: boolean;
}

export interface UnderstandingDTO {
  raw: string;
  normalized: string;
  tokens: string[];
  intent: Intent;
  intentLabel: string;
  specialty: string | null;
  categories: string[];
  freshness: "today" | "recent" | "any";
  locations: LocationDTO[];
  /** đơn vị hành chính HIỆN HÀNH sau khi resolve địa danh lịch sử */
  resolvedCurrentIds: string[];
  transition: { from: string; to: string[]; date: string | null } | null;
  compareTargets: [string, string] | null;
  fuzzy: { used: boolean; notes: string[] };
}

export interface BudgetDTO {
  name: Budget;
  reason: string;
  targetMs: string;
  multiHop: boolean;
  readEvidence: boolean;
}

export interface PlaceDTO {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  address: string;
  provinceId: string;
  specialties: string[];
  rating: number | null;
  reviewCount: number;
  priceLabel: string | null;
  phone: string | null;
  hours: string | null;
  openNow: boolean | null;
  distanceKm: number | null;
  distanceLabel: string | null;
  image: string | null;
  source: string;
  verified: boolean;
  note: string | null;
  score: number;
  lat: number | null;
  lng: number | null;
  updatedAt: string | null;
  why: string[];
}

export interface CandidateDTO {
  id: string;
  name: string;
  specialty: string | null;
  address: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  evidence: string | null;
}

export interface DocDTO {
  id: string;
  title: string;
  url: string;
  domain: string;
  sourceType: SourceType;
  snippet: string;
  content: string;
  authority: number;
  publishedAt: string | null;
  entities: string[];
  score: number;
  why: string[];
  origin: string;
}

export interface QualityDTO {
  /** độ tin cậy của RETRIEVAL (chưa tính verification của câu trả lời) */
  confidence: number;
  coverage: "good" | "partial" | "none";
  independentSources: number;
  avgAuthority: number;
}

export interface RetrieveResult {
  backend: string;
  understanding: UnderstandingDTO;
  budget: BudgetDTO;
  places: { exact: PlaceDTO[]; unverified: PlaceDTO[]; related: PlaceDTO[]; candidates: CandidateDTO[] };
  docs: DocDTO[];
  coverage: { gap: boolean; reason: string | null; widened: boolean };
  anchor: { lat: number; lng: number; label: string } | null;
  scope: { provinces: string[]; communes: string[] };
  quality: QualityDTO;
  federation: ProviderStatus[];
  widening: string[];
  /** understand_ms · retrieve_ms · rerank_ms · load_graph_ms · total_ms (+ network_ms do adapter thêm) */
  timings: Record<string, number>;
}
