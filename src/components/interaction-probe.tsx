"use client";

// ---------------------------------------------------------------------------
// InteractionProbe — telemetry client cho một lượt search (P-LEARNING).
//
// Mount một lần trong SearchResults:
//   • session_id tạm per-tab (sessionStorage) — đủ phát hiện reformulation,
//     không định danh người dùng xuyên phiên.
//   • phát hiện query được viết lại nhanh (<15s) → event `reformulate`.
//   • gửi batch `impression` cho mọi kết quả đã render (shown ≠ clicked).
//   • delegation click trên [data-track] → click / source_open / map_open /
//     call / directions.
// Không render gì; không gửi IP/cookie — server chỉ rate-limit theo IP.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from "react";

const SESSION_KEY = "vs.sid";
const LAST_Q_KEY = "vs.lastq";
const REFORMULATE_MS = 15_000;

interface Impression {
  result_id: string;
  rank: number;
}

interface EventBody {
  kind: string;
  result_id?: string;
  rank?: number;
  meta?: Record<string, unknown>;
}

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

function post(traceId: string | null, events: EventBody[]) {
  if (!events.length) return;
  fetch("/v1/interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trace_id: traceId, session: sessionId(), events }),
    keepalive: true,
  }).catch(() => {});
}

export function InteractionProbe({
  traceId,
  query,
  impressions,
}: {
  traceId: string | null;
  query: string;
  impressions: Impression[];
}) {
  const fired = useRef(false);

  useEffect(() => {
    // Batch một lần duy nhất; listener phải gắn kể cả khi StrictMode remount.
    if (!fired.current) {
      fired.current = true;
      const events: EventBody[] = [];

      // Reformulation: query trước trong cùng tab <15s và khác → query cũ chưa đủ.
      try {
        const prev = sessionStorage.getItem(LAST_Q_KEY);
        if (prev) {
          const p = JSON.parse(prev) as { q?: string; ts?: number };
          if (p.q && p.q !== query && Date.now() - (p.ts ?? 0) < REFORMULATE_MS) {
            events.push({ kind: "reformulate", meta: { from: p.q.slice(0, 160), to: query.slice(0, 160) } });
          }
        }
        sessionStorage.setItem(LAST_Q_KEY, JSON.stringify({ q: query, ts: Date.now() }));
      } catch {}

      for (const imp of impressions.slice(0, 60)) {
        events.push({ kind: "impression", result_id: imp.result_id, rank: imp.rank });
      }
      post(traceId, events);
    }

    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-track]");
      if (!el) return;
      const kind = el.getAttribute("data-track");
      if (!kind) return;
      post(traceId, [
        {
          kind,
          result_id: el.getAttribute("data-result-id") ?? undefined,
          rank: el.getAttribute("data-rank") ? Number(el.getAttribute("data-rank")) : undefined,
        },
      ]);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [traceId, query, impressions]);

  return null;
}
