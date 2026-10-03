"use client";

// ---------------------------------------------------------------------------
// InteractionProbe — telemetry client cho một lượt search (P-LEARNING).
//
// Mount một lần trong SearchResults:
//   • session_id tạm per-tab (sessionStorage) — đủ phát hiện reformulation,
//     không định danh người dùng xuyên phiên.
//   • phát hiện query được viết lại nhanh (<15s) → event `reformulate`.
//   • impression thật: IntersectionObserver — chỉ ghi khi ≥50% phần tử
//     [data-imp] lọt viewport ≥400ms (render ≠ nhìn thấy).
//   • delegation click trên [data-track] → click / source_open / map_open /
//     call / directions.
// Không render gì; không gửi IP/cookie — server chỉ rate-limit theo IP.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from "react";

const SESSION_KEY = "vs.sid";
const LAST_Q_KEY = "vs.lastq";
const REFORMULATE_MS = 15_000;
const VIEW_MIN_RATIO = 0.5;
const VIEW_MIN_MS = 400;

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
    if (!fired.current) {
      fired.current = true;
      // Reformulation: query trước trong cùng tab <15s và khác → query cũ chưa đủ.
      try {
        const prev = sessionStorage.getItem(LAST_Q_KEY);
        if (prev) {
          const p = JSON.parse(prev) as { q?: string; ts?: number };
          if (p.q && p.q !== query && Date.now() - (p.ts ?? 0) < REFORMULATE_MS) {
            post(traceId, [{ kind: "reformulate", meta: { from: p.q.slice(0, 160), to: query.slice(0, 160) } }]);
          }
        }
        sessionStorage.setItem(LAST_Q_KEY, JSON.stringify({ q: query, ts: Date.now() }));
      } catch {}
    }

    // Impression thật qua IntersectionObserver: phần tử phải ≥50% trong
    // viewport ≥400ms mới tính — kết quả dưới fold không bị đếm là "đã thấy".
    const wanted = new Map(impressions.map((i) => [i.result_id, i.rank]));
    const seen = new Set<string>();
    const pending = new Map<Element, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as Element;
          const id = el.getAttribute("data-result-id");
          if (!id || seen.has(id)) continue;
          if (e.intersectionRatio >= VIEW_MIN_RATIO) {
            if (pending.has(el)) continue;
            pending.set(
              el,
              window.setTimeout(() => {
                pending.delete(el);
                if (seen.has(id)) return;
                seen.add(id);
                post(traceId, [{ kind: "impression", result_id: id, rank: wanted.get(id) }]);
                io.unobserve(el);
              }, VIEW_MIN_MS),
            );
          } else {
            window.clearTimeout(pending.get(el));
            pending.delete(el);
          }
        }
      },
      { threshold: [VIEW_MIN_RATIO] },
    );
    document.querySelectorAll("[data-imp]").forEach((el) => io.observe(el));

    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-track]");
      if (!el) return;
      const kind = el.getAttribute("data-track");
      if (!kind) return;
      const events: EventBody[] = [];
      // click ⇒ impression: user có thể click trước khi timer 400ms kịp ghi
      // (navigation xảy ra trước). Flush impression ngay nếu chưa có —
      // analytics union cũng chuẩn hóa, đây là để không mất event.
      const impEl = el.hasAttribute("data-imp") ? el : el.closest("[data-imp]");
      const impId = impEl?.getAttribute("data-result-id") ?? el.getAttribute("data-result-id");
      if (impId && wanted.has(impId) && !seen.has(impId)) {
        seen.add(impId);
        if (impEl && pending.has(impEl)) {
          window.clearTimeout(pending.get(impEl));
          pending.delete(impEl);
          io.unobserve(impEl);
        }
        events.push({ kind: "impression", result_id: impId, rank: wanted.get(impId) });
      }
      events.push({
        kind,
        result_id: el.getAttribute("data-result-id") ?? undefined,
        rank: el.getAttribute("data-rank") ? Number(el.getAttribute("data-rank")) : undefined,
      });
      post(traceId, events);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      io.disconnect();
      pending.forEach((t) => window.clearTimeout(t));
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [traceId, query, impressions]);

  return null;
}
