import type { NextRequest } from "next/server";
import type { RunOptions } from "./pipeline";
import type { ModeInput } from "@/core/contract";
import { BackendUnavailableError, NotSupportedError } from "@/core/backend";

export interface ParsedRequest {
  query: string;
  opts: RunOptions;
  evidence: "auto" | "off" | "full";
  raw: Record<string, unknown>;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export function parseLocation(raw: Record<string, unknown>): { lat: number; lng: number } | null {
  const loc = (raw.location ?? raw.user_location) as Record<string, unknown> | undefined;
  const lat = num(loc?.lat ?? loc?.latitude ?? raw.lat);
  const lng = num(loc?.lng ?? loc?.lon ?? loc?.longitude ?? raw.lon ?? raw.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function parseBody(raw: Record<string, unknown>, defaultMode: ModeInput = "auto"): ParsedRequest {
  const q = String(raw.query ?? raw.q ?? raw.input ?? "").trim().slice(0, 500);
  const mode = (typeof raw.mode === "string" ? raw.mode : defaultMode) as ModeInput;
  const max = num(raw.max_results);
  const ev = raw.evidence === "off" || raw.evidence === "full" ? raw.evidence : "auto";
  // Retrieval Contract `record:false` (alias `log`) — benchmark/test không
  // ghi trace/coverage vào demand thật. Mặc định record.
  const noRecord = raw.record === false || raw.record === "false" || raw.log === false;
  return { query: q, opts: { mode, location: parseLocation(raw), maxResults: max ?? undefined, log: noRecord ? false : undefined }, evidence: ev, raw };
}

export function parseGet(req: NextRequest): ParsedRequest {
  const sp = req.nextUrl.searchParams;
  return parseBody({
    q: sp.get("q") ?? "",
    mode: sp.get("mode") ?? "auto",
    lat: sp.get("lat"),
    lon: sp.get("lon") ?? sp.get("lng"),
    max_results: sp.get("limit") ?? sp.get("max_results"),
    record: sp.get("record"),
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Bọc route handler: chuyển lỗi backend thành JSON có cấu trúc thay vì 500 trống */
export function guard<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof BackendUnavailableError) {
        return Response.json({ error: { message: e.message, type: "backend_unavailable", code: 503, backend: e.backend } }, { status: 503, headers: { "retry-after": "5" } });
      }
      if (e instanceof NotSupportedError) {
        return Response.json({ error: { message: e.message, type: "not_supported_by_backend", code: 501 } }, { status: 501 });
      }
      console.error("route error", e);
      return Response.json({ error: { message: "internal error", type: "server_error", code: 500 } }, { status: 500 });
    }
  };
}

export function badRequest(message: string) {
  return Response.json({ error: { message, type: "invalid_request_error", code: 400 } }, { status: 400 });
}

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;
