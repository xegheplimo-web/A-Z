"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";

export function RunEvalButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/v1/eval/run", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      start(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  const loading = busy || pending;
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 rounded-xl border border-gold/35 bg-gold/10 px-4 py-2 text-[12.5px] font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-60"
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        Chạy lại benchmark
      </button>
      {err && <span className="text-[12px] text-flame-2">{err}</span>}
    </div>
  );
}
