"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ThumbsDown, ThumbsUp } from "lucide-react";

/** Nhãn phản hồi trên một trace → dữ liệu preference cho VietScope-LM sau này (§11) */
export function FeedbackWidget({ traceId, query }: { traceId: string | null; query: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(verdict: "good" | "bad") {
    if (busy || sent) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/v1/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trace_id: traceId, query, verdict }),
      });
      if (!response.ok) throw new Error("feedback unavailable");
      setSent(verdict);
    } catch {
      setError("Chưa gửi được phản hồi. Bạn có thể thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={busy}>
      <span className="mr-1 text-[11px] text-fog-2">Câu trả lời này có hữu ích với bạn?</span>
      {(["good", "bad"] as const).map((v) => (
        <button
          key={v}
          onClick={() => send(v)}
          disabled={busy || !!sent}
          aria-label={v === "good" ? "Hữu ích" : "Chưa tốt"}
          className={`flex size-7 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
            sent === v
              ? v === "good"
                ? "border-jade/50 bg-jade/15 text-jade"
                : "border-flame/50 bg-flame/15 text-flame-2"
              : "border-line bg-ink text-fog hover:border-line-2 hover:text-paper"
          }`}
        >
          {v === "good" ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
        </button>
      ))}
      <span role="status" aria-live="polite" className={`text-[11px] ${error ? "text-gold" : "text-jade"}`}>
        {sent ? "Đã ghi nhận. Cảm ơn bạn!" : busy ? "Đang gửi…" : error ?? ""}
      </span>
    </div>
  );
}

/** A discovery lead is not evidence. Open the reviewed observations workflow instead of setting verified:true. */
export function PromoteButton({ candidateId, name, specialty }: { candidateId: string; name: string; specialty: string | null }) {
  return <Link href={`/data/pilot?candidate=${encodeURIComponent(candidateId)}`} title={`Mở hồ sơ nguồn cho ${name}${specialty ? ` (${specialty})` : ""}`} className="flex shrink-0 items-center gap-1.5 rounded-md border border-gold/30 px-2 py-1 text-[10px] text-gold hover:bg-gold/10">Hồ sơ xác minh<ArrowUpRight className="size-3" /></Link>;
}
