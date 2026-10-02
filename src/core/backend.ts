// ---------------------------------------------------------------------------
// VietScope · RetrievalBackend — điểm chọn MỘT retrieval brain tại runtime
//
//   RETRIEVAL_BACKEND=embedded        (mặc định — dev / offline / fixture benchmark)
//   RETRIEVAL_BACKEND=search-router   (production; cần SEARCH_ROUTER_URL)
//
// Chỉ backend được chọn mới được nạp (dynamic import) — hai engine KHÔNG chạy song song.
// Nếu search-router không dùng được, mặc định trả lỗi 503 rõ ràng (không âm thầm đổi engine).
// Đổi engine tạm thời chỉ khi bật tường minh: RETRIEVAL_FALLBACK=embedded.
// ---------------------------------------------------------------------------
import type { RetrieveRequest, RetrieveResult } from "./contract";
import type { PilotCommand, PilotSnapshot } from "./pilot";

export type BackendKind = "embedded" | "search-router";

export interface BackendLane {
  id: string;
  lane: string;
  enabled: boolean;
  records?: number;
  endpoint?: string | null;
  health?: unknown;
}

export interface BackendDescription {
  id: string;
  lanes: BackendLane[];
  flywheel?: Record<string, unknown>;
  note?: string;
}

export interface BackendStats {
  places: number;
  adminUnits: number;
  documents: number;
  provinces: number;
}

export interface PromoteArgs {
  candidateId: string;
  verified?: boolean;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  hours?: string | null;
  note?: string | null;
}

export interface RetrievalBackend {
  readonly id: BackendKind;
  readonly capabilities: { coverage: boolean; adminResolve: boolean; stats: boolean; pilot?: boolean };
  retrieve(req: RetrieveRequest): Promise<RetrieveResult>;
  describe(): Promise<BackendDescription>;
  stats?(): Promise<BackendStats>;
  adminResolve?(q: string): Promise<unknown>;
  coverage?(limit: number): Promise<unknown>;
  promote?(args: PromoteArgs): Promise<unknown>;
  pilotSnapshot?(): Promise<PilotSnapshot>;
  pilotCommand?(command: PilotCommand, actor: string): Promise<unknown>;
}

export class BackendUnavailableError extends Error {
  readonly code = "backend_unavailable";
  constructor(message: string, readonly backend: string = "search-router") {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

export class NotSupportedError extends Error {
  readonly code = "not_supported_by_backend";
  constructor(feature: string, backend: string) {
    super(`backend “${backend}” không hỗ trợ ${feature}`);
    this.name = "NotSupportedError";
  }
}

export function backendKind(): BackendKind {
  return process.env.RETRIEVAL_BACKEND?.trim() === "search-router" ? "search-router" : "embedded";
}

export async function getBackend(kind: BackendKind = backendKind()): Promise<RetrievalBackend> {
  if (kind === "search-router") return (await import("@/engine/search-router/adapter")).searchRouterBackend;
  return (await import("@/engine/embedded")).embeddedBackend;
}

/** retrieve() với fallback có chủ đích (RETRIEVAL_FALLBACK=embedded) */
export async function retrieveVia(req: RetrieveRequest): Promise<RetrieveResult> {
  const primary = await getBackend();
  try {
    return await primary.retrieve(req);
  } catch (e) {
    if (e instanceof BackendUnavailableError && process.env.RETRIEVAL_FALLBACK?.trim() === "embedded" && primary.id !== "embedded") {
      const fb = await (await getBackend("embedded")).retrieve(req);
      fb.federation.unshift({ provider: primary.id, lane: "retrieval brain", status: "error", ms: 0, count: 0, detail: `${e.message} → fallback embedded (RETRIEVAL_FALLBACK)` });
      fb.widening.unshift(`⚠ ${primary.id} không dùng được → tạm dùng engine embedded (chất lượng/độ phủ thấp hơn)`);
      return fb;
    }
    throw e;
  }
}

export async function requireCapability<K extends "coverage" | "adminResolve" | "stats" | "pilot">(cap: K): Promise<RetrievalBackend> {
  const b = await getBackend();
  if (!b.capabilities[cap]) throw new NotSupportedError(cap, b.id);
  return b;
}
