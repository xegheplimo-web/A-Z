"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, ChevronDown, Cpu, Database, Landmark, Layers, ListChecks, MapPin, ScanText, Workflow } from "lucide-react";
import type { VietScopeResponse } from "@/lib/pipeline";
import clsx from "clsx";

/** Bảng vết pipeline — minh họa cơ chế Compound Search Model */
export function TracePanel({ data }: { data: VietScopeResponse }) {
  const [open, setOpen] = useState(false);
  const u = data.understanding;
  const t = data.timings;

  const stages = [
    {
      icon: ScanText,
      name: "HIỂU CÂU HỎI",
      ms: t.understand_ms,
      detail: `normalize → "${u.normalized.slice(0, 60)}${u.normalized.length > 60 ? "…" : ""}" · intent = ${u.intent} · freshness = ${u.freshness}`,
    },
    {
      icon: MapPin,
      name: "ENTITY / ĐỊA DANH",
      ms: undefined,
      detail:
        u.locations.length > 0
          ? u.locations
              .map(
                (l) =>
                  `${l.name}${l.status !== "current" ? " (lịch sử → " + (u.transition?.to.join(" + ") ?? "?") + ")" : ""}`
              )
              .join(" · ") + (u.specialty ? ` · specialty = "${u.specialty}"` : "")
          : `không địa danh cụ thể${u.specialty ? ` · specialty = "${u.specialty}"` : ""}`,
    },
    {
      icon: Workflow,
      name: `SOURCE ROUTER · BUDGET ${data.budget.name.toUpperCase()}`,
      ms: undefined,
      detail: `${routerDetail(data)} — ${data.budget.reason}${data.budget.multiHop ? " · multi-hop" : ""}`,
    },
    {
      icon: Database,
      name: "TÌM SONG SONG (FEDERATION)",
      ms: t.retrieve_ms,
      detail: data.federation
        .map((f) => `${f.provider}: ${f.status}${f.status === "ok" || f.status === "empty" ? ` · ${f.count} · ${f.ms}ms` : f.detail ? ` (${f.detail})` : ""}`)
        .join("  |  "),
    },
    ...(data.widening.length
      ? [{ icon: Layers, name: "PROGRESSIVE WIDENING", ms: undefined, detail: data.widening.join(" → ") }]
      : []),
    {
      icon: ListChecks,
      name: "DEDUP · RRF · XẾP HẠNG",
      ms: t.rerank_ms,
      detail: `exact ${data.quality.exactCount} · unverified ${data.quality.unverifiedCount} · related ${data.quality.relatedCount} · ${data.quality.sourceDiversity} domains · avgAuthority ${data.quality.avgAuthority.toFixed(2)}`,
    },
    {
      icon: Brain,
      name: "TRẢ LỜI → VERIFY → CITATIONS",
      ms: t.synthesize_ms + (t.verify_ms ?? 0),
      detail: `${data.quality.citedClaims} claim có citation đã verify · ${data.quality.unsupportedClaims} claim gắn cờ · verified ${Math.round(data.verification.verifiedRatio * 100)}% · tin cậy ${Math.round(data.quality.confidence * 100)}% (${data.quality.coverageLabel})`,
    },
  ];

  return (
    <div className="rise rise-2 overflow-hidden rounded-2xl border border-line bg-ink-2/60">
      <button
        onClick={() => setOpen((o) => !o)}
        type="button"
        aria-expanded={open}
        aria-controls="search-trace-details"
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left"
      >
        <Cpu className="size-4 text-gold" />
        <span className="text-[12px] font-medium text-fog">Chi tiết tìm kiếm</span>
        <span className="num-tabular rounded-md border border-line bg-ink px-2 py-0.5 text-[10.5px] text-fog-2">
          {t.total_ms}ms
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="ml-auto">
          <ChevronDown className="size-4 text-fog-2" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 210, damping: 26 }}
          >
            <div id="search-trace-details" className="space-y-0.5 px-4 pb-4">
              {stages.map((s, i) => (
                <div key={s.name} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < stages.length - 1 && (
                    <span className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-line-2" />
                  )}
                  <span
                    className={clsx(
                      "z-10 flex size-7 shrink-0 items-center justify-center rounded-lg border",
                      i === stages.length - 1
                        ? "border-jade/40 bg-jade/15 text-jade"
                        : "border-line-2 bg-ink text-gold"
                    )}
                  >
                    <s.icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-fog">
                        {s.name}
                      </span>
                      {s.ms !== undefined && (
                        <span className="num-tabular text-[10px] text-jade/80">{s.ms}ms</span>
                      )}
                    </div>
                    <p className="mt-0.5 break-words text-[11.5px] leading-relaxed text-fog-2">{s.detail}</p>
                  </div>
                </div>
              ))}
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-ink px-3 py-2 text-[10.5px] text-fog-2">
                <Layers className="size-3 text-gold" />
                model = <code className="text-gold">{data.model}</code> · graph {t.load_graph_ms}ms ·
                backend: {data.backend} · synthesis: {data.synthesizer}
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-jade/25 bg-jade/8 px-3 py-2 text-[10.5px] leading-relaxed text-jade/90">
                <Landmark className="size-3 shrink-0" />
                Mọi bước routing/geocoding/ranking đều deterministic — kiểm thử được, đo được benchmark.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function routerDetail(data: VietScopeResponse): string {
  const intent = data.understanding.intent;
  const lanes: string[] = [];
  if (intent === "local_search") lanes.push("Canonical Places", "flywheel candidates");
  if (intent === "legal") lanes.push("văn bản chính thống", "cổng chính phủ");
  if (intent === "market_price") lanes.push("market feed (news)", "freshness ưu tiên");
  if (intent === "weather") lanes.push("KTTV (gov)", "bản tin mới nhất");
  if (intent === "compare") lanes.push("official product", "review/cộng đồng");
  if (intent === "admin_info") lanes.push("Vietnam Admin Graph");
  if (lanes.length === 0) lanes.push("web corpus");
  lanes.push("documents evidence");
  return lanes.join(" + ");
}
