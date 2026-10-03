// /ops/quality — Search Quality Dashboard (P-LEARNING-4)
// Ops console: dày, không marketing chrome. Đọc aggregate từ telemetry,
// không phải dữ liệu thô. Coverage gaps đến từ retrieval brain qua facade
// capability — embedded backend hiển thị coverage_gaps nội bộ tương đương.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { opsAccessOk } from "@/lib/ops";
import { qualityReport } from "@/lib/quality";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search Quality · Ops", robots: { index: false, follow: false } };

const WINDOWS = [
  { h: 24, label: "24h" },
  { h: 168, label: "7d" },
  { h: 720, label: "30d" },
];

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const ms = (v: number | null) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

export default async function OpsQualityPage({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  if (!(await opsAccessOk())) notFound(); // 404 — không lộ ops surface
  const { h } = await searchParams;
  const hours = [24, 168, 720].includes(Number(h)) ? Number(h) : 24;
  const r = await qualityReport(hours);

  return (
    <main id="main-content" className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-fog-2">VietScope Ops</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-paper">Search Quality</h1>
        </div>
        <nav className="flex gap-1 rounded-lg border border-line bg-ink-2/60 p-1 text-[12px]">
          {WINDOWS.map((w) => (
            <a
              key={w.h}
              href={`/ops/quality?h=${w.h}`}
              className={`rounded-md px-3 py-1 transition-colors ${
                w.h === hours ? "bg-gold/15 font-semibold text-gold" : "text-fog hover:text-paper"
              }`}
            >
              {w.label}
            </a>
          ))}
        </nav>
      </div>

      {/* metric strip */}
      <dl className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {[
          { k: "Searches", v: r.searches.toLocaleString("vi-VN"), warn: false },
          { k: "Zero-result", v: pct(r.zeroResultRate), warn: r.zeroResultRate > 10 },
          { k: "Low-result", v: pct(r.lowResultRate), warn: false },
          { k: "Exact local", v: pct(r.exactLocalRate), warn: r.exactLocalRate != null && r.exactLocalRate < 40 },
          { k: "Reformulate", v: pct(r.reformulationRate), warn: r.reformulationRate > 15 },
          { k: "CTR@3", v: pct(r.ctr.at3), warn: false },
          { k: "P50", v: ms(r.latency.p50), warn: false },
          { k: "P95", v: ms(r.latency.p95), warn: r.latency.p95 != null && r.latency.p95 > 5000 },
        ].map((x) => (
          <div key={x.k} className="rounded-xl border border-line bg-ink-2/60 px-3 py-3">
            <dt className="text-[10.5px] uppercase tracking-wide text-fog-2">{x.k}</dt>
            <dd className={`num-tabular mt-1 text-[18px] font-bold ${x.warn ? "text-flame-2" : "text-paper"}`}>{x.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { k: "CTR@1", v: pct(r.ctr.at1) },
          { k: "CTR@5", v: pct(r.ctr.at5) },
          { k: "Source-open", v: pct(r.sourceOpenRate) },
          { k: "Neg. feedback", v: pct(r.negativeFeedbackRate) },
          { k: "Coverage gap", v: pct(r.coverageGapRate) },
          { k: "Reformulate · low-quality", v: pct(r.reformulationLowQualityRate) },
          { k: "Intents", v: r.byIntent.map((i) => `${i.intent} ${i.count}`).join(" · ") || "—" },
          { k: "Window", v: `${hours}h` },
        ].map((x) => (
          <div key={x.k} className="rounded-xl border border-line/70 bg-ink-2/30 px-3 py-2.5">
            <dt className="text-[10.5px] uppercase tracking-wide text-fog-2">{x.k}</dt>
            <dd className="num-tabular mt-0.5 truncate text-[13.5px] font-semibold text-paper">{x.v}</dd>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* bad searches */}
        <section id="bad-searches" className="rounded-2xl border border-line bg-ink-2/60 p-4">
          <h2 className="text-[13px] font-semibold text-paper">Bad searches · review queue</h2>
          <p className="mt-0.5 text-[11px] text-fog-2">
            Telemetry chỉ phát hiện tín hiệu xấu. Human review quyết định trạng thái; chỉ <span className="text-flame-2">confirmed_bad</span> mới đủ điều kiện sang P-LEARNING-6.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-fog-2">
                  <th className="py-1.5 pr-2 font-medium">Query</th>
                  <th className="py-1.5 pr-2 text-right font-medium">n</th>
                  <th className="py-1.5 pr-2 text-right font-medium">zero</th>
                  <th className="py-1.5 pr-2 text-right font-medium">reform</th>
                  <th className="py-1.5 pr-2 font-medium">Review</th>
                  <th className="py-1.5 pr-2 text-right font-medium">score</th>
                  <th className="py-1.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {r.badSearches.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-fog-2">Không có search nào tích điểm xấu trong window.</td></tr>
                )}
                {r.badSearches.map((b, i) => {
                  const statusLabel = {
                    open: "Mở",
                    reviewed_good: "Không lỗi",
                    confirmed_bad: "Xác nhận lỗi",
                    ignored: "Bỏ qua",
                    promoted_to_golden: "Golden",
                  }[b.reviewStatus];
                  const statusClass =
                    b.reviewStatus === "confirmed_bad" ? "text-flame-2" :
                    b.reviewStatus === "reviewed_good" ? "text-jade" :
                    b.reviewStatus === "promoted_to_golden" ? "text-gold" : "text-fog-2";
                  return (
                    <tr key={i} className="border-b border-line/50 align-top last:border-0">
                      <td className="max-w-[260px] py-2 pr-2 text-paper">
                        <span className="block truncate">{b.query}</span>
                        {b.reviewNote && <span className="mt-0.5 block max-w-[260px] truncate text-[10.5px] text-fog-2">{b.reviewNote}</span>}
                      </td>
                      <td className="num-tabular py-2 pr-2 text-right text-fog">{b.searches}</td>
                      <td className="num-tabular py-2 pr-2 text-right text-fog">{b.zeroResult}</td>
                      <td className="num-tabular py-2 pr-2 text-right text-fog">{b.reformulated}</td>
                      <td className={`py-2 pr-2 text-[11px] font-semibold ${statusClass}`}>{statusLabel}</td>
                      <td className="num-tabular py-2 pr-2 text-right font-bold text-flame-2">{b.score}</td>
                      <td className="py-2 text-right">
                        {b.reviewStatus === "promoted_to_golden" ? (
                          <span className="text-[10.5px] text-gold">Đã khóa</span>
                        ) : (
                          <details className="relative inline-block text-left">
                            <summary className="cursor-pointer select-none text-[11px] text-gold">Review</summary>
                            <div className="mt-2 w-[250px] rounded-xl border border-line bg-ink p-3 text-left shadow-xl">
                              <form method="post" action="/ops/quality/review" className="space-y-2">
                                <input type="hidden" name="query" value={b.query} />
                                <input type="hidden" name="h" value={hours} />
                                <label className="block text-[10.5px] text-fog-2">
                                  Ghi chú
                                  <input
                                    name="note"
                                    maxLength={1000}
                                    defaultValue={b.reviewNote ?? ""}
                                    placeholder="Bắt buộc khi xác nhận lỗi"
                                    className="mt-1 w-full rounded-lg border border-line-2 bg-ink-2 px-2.5 py-2 text-[11px] text-paper outline-none focus:border-gold/50"
                                  />
                                </label>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <button type="submit" name="status" value="confirmed_bad" className="rounded-lg border border-flame/30 px-2 py-1.5 text-[10.5px] text-flame-2">Xác nhận lỗi</button>
                                  <button type="submit" name="status" value="reviewed_good" className="rounded-lg border border-jade/30 px-2 py-1.5 text-[10.5px] text-jade">Không lỗi</button>
                                  <button type="submit" name="status" value="ignored" className="rounded-lg border border-line px-2 py-1.5 text-[10.5px] text-fog">Bỏ qua</button>
                                  <button type="submit" name="status" value="open" className="rounded-lg border border-line px-2 py-1.5 text-[10.5px] text-fog">Mở lại</button>
                                </div>
                              </form>
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* coverage gaps */}
        <section className="rounded-2xl border border-line bg-ink-2/60 p-4">
          <h2 className="text-[13px] font-semibold text-paper">Coverage gaps</h2>
          <p className="mt-0.5 text-[11px] text-fog-2">Nhu cầu × thiếu dữ liệu, ghi trong retrieval brain (admin × category × tuần)</p>
          <table className="mt-3 w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-fog-2">
                <th className="py-1.5 pr-2 font-medium">Cell</th>
                <th className="py-1.5 pr-2 text-right font-medium">demand</th>
                <th className="py-1.5 pr-2 text-right font-medium">zero</th>
                <th className="py-1.5 text-right font-medium">week</th>
              </tr>
            </thead>
            <tbody>
              {r.coverageGaps.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-fog-2">Chưa có coverage signal nào trong brain.</td></tr>
              )}
              {(r.coverageGaps as { cell: string; demand: number; zero_result: number; week: string }[]).map((g, i) => (
                <tr key={i} className="border-b border-line/50 last:border-0">
                  <td className="max-w-[260px] truncate py-2 pr-2 text-paper">{g.cell}</td>
                  <td className="num-tabular py-2 pr-2 text-right text-fog">{g.demand}</td>
                  <td className="num-tabular py-2 pr-2 text-right text-fog">{g.zero_result}</td>
                  <td className="num-tabular py-2 text-right text-fog-2">{g.week}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-fog-2">
        CTR@k = clicked rank≤k / impressed rank≤k — impression chỉ ghi khi kết quả thực sự lọt viewport.
        Bad search queue là đầu vào review, không phải nhãn benchmark. P-LEARNING-5 lưu human judgment; chỉ confirmed_bad mới được P-LEARNING-6 tạo golden candidate.
      </p>
    </main>
  );
}
