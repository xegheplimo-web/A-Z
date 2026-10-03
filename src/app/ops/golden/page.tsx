// /ops/golden — P-LEARNING-6: confirmed_bad → human-labeled golden case.
// 3 vùng: Candidates (draft) · Needs labeling/approval · Approved benchmark.
// Telemetry chỉ đề cử; label đến từ người — không annotation platform cồng kềnh.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { opsAccessOk } from "@/lib/ops";
import { listGoldenCandidates, BENCHMARK_STATUSES, GOLDEN_FRESHNESS, GOLDEN_AUTHORITY, type GoldenGeoScope } from "@/lib/golden";
import { INTENTS } from "@/core/contract";
import type { GoldenCandidateRow } from "@/db/schema";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Golden Cases · Ops", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  labeled: "Đã label",
  approved: "Approved",
  promoted: "Promoted",
  superseded: "Superseded",
};
const STATUS_CLASS: Record<string, string> = {
  draft: "text-fog-2",
  labeled: "text-gold",
  approved: "text-jade",
  promoted: "text-gold",
  superseded: "text-fog-2 line-through",
};

function LabelForm({ c, op, extra }: { c: GoldenCandidateRow; op: "label" | "revise"; extra?: string }) {
  const g = (c.geoScope as GoldenGeoScope | null) ?? {};
  const geo = g.admin_ids?.join(", ") ?? "";
  const anchorLabel = g.anchor?.label ?? "";
  const radius = g.radius_m != null ? String(g.radius_m) : "";
  const ents = Array.isArray(c.expectedEntities) ? (c.expectedEntities as string[]).join(", ") : "";
  const rel = Object.entries((c.relevanceLabels as Record<string, number> | null) ?? {})
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
  return (
    <form method="post" action="/ops/golden/actions" className="mt-2 space-y-2 text-[11px]">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="id" value={c.id} />
      {extra}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-fog-2">Intent
          <select name="intent" defaultValue={c.intent ?? ""} className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper">
            <option value="">—</option>
            {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label className="text-fog-2">Specialty
          <input name="specialty" defaultValue={c.specialty ?? ""} className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper" />
        </label>
        <label className="col-span-2 text-fog-2">Geo admin_ids (phẩy)
          <input name="geo" defaultValue={geo} placeholder="new:07681" className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper" />
        </label>
        <label className="text-fog-2">Anchor label (query &ldquo;gần X&rdquo;)
          <input name="anchor" defaultValue={anchorLabel} placeholder="Neo" className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper" />
        </label>
        <label className="text-fog-2">Radius (m) — chỉ kèm anchor
          <input name="radius" defaultValue={radius} placeholder="2000" inputMode="numeric" className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper" />
        </label>
        <label className="col-span-2 text-fog-2">Expected entities (phẩy) — trống nếu abstain
          <input name="entities" defaultValue={ents} className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper" />
        </label>
        <label className="col-span-2 text-fog-2">Relevance labels — entity:grade 0..3
          <input name="relevance" defaultValue={rel} placeholder="Nhà thuốc ABC:3, Quán ăn X:0" className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper" />
        </label>
        <label className="text-fog-2">Freshness
          <select name="freshness" defaultValue={c.freshnessRequirement ?? ""} className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper">
            <option value="">—</option>
            {GOLDEN_FRESHNESS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="text-fog-2">Authority
          <select name="authority" defaultValue={c.authorityRequirement ?? ""} className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper">
            <option value="">—</option>
            {GOLDEN_AUTHORITY.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-2 text-fog-2">
          <input type="checkbox" name="abstain" defaultChecked={c.abstentionExpected} />
          Abstention expected (đúng = 0 exact)
        </label>
        <label className="col-span-2 text-fog-2">Note
          <input name="note" defaultValue={c.reviewNote ?? ""} maxLength={1000} className="mt-0.5 w-full rounded-lg border border-line-2 bg-ink-2 px-2 py-1.5 text-paper" />
        </label>
      </div>
      <button type="submit" className="rounded-lg border border-gold/40 px-3 py-1.5 font-semibold text-gold">
        {op === "revise" ? "Tạo version mới (supersede cũ)" : "Lưu labels"}
      </button>
    </form>
  );
}

export default async function OpsGoldenPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  if (!(await opsAccessOk())) notFound();
  const { err } = await searchParams;
  const all = await listGoldenCandidates();
  const live = all.filter((c) => c.status !== "superseded");
  const drafts = live.filter((c) => c.status === "draft" || c.status === "labeled");
  const approved = live.filter((c) => (BENCHMARK_STATUSES as readonly string[]).includes(c.status));
  const superseded = all.filter((c) => c.status === "superseded");

  return (
    <main id="main-content" className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-fog-2">VietScope Ops</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-paper">Golden Cases</h1>
        </div>
        <nav className="text-[12px] text-fog-2">
          <a href="/ops/quality" className="text-gold hover:underline">← quality</a>
        </nav>
      </div>

      {err && <p className="mt-4 rounded-lg border border-flame/40 bg-flame/10 px-3 py-2 text-[12px] text-flame-2">{err}</p>}

      <p className="mt-3 text-[12px] leading-relaxed text-fog-2">
        Pipeline: <span className="text-paper">confirmed_bad → draft → labeled → approved → promoted</span>.
        Chỉ approved/promoted vào benchmark (suite <code>golden-promoted</code>, chạy record:false).
        Sửa approved case tạo version mới và supersede bản cũ — không overwrite.
      </p>

      {/* Manual nomination — positive control. Dry-run record:false, không làm bẩn telemetry. */}
      <form method="post" action="/ops/golden/actions" className="mt-5 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-ink-2/60 p-4">
        <input type="hidden" name="op" value="nominate" />
        <label className="min-w-[260px] flex-1 text-[11px] text-fog-2">
          Nominate benchmark case (positive control)
          <input name="query" required maxLength={500} placeholder="nhà thuốc gần Neo"
            className="mt-1 w-full rounded-lg border border-line-2 bg-ink-2 px-3 py-2 text-[12.5px] text-paper" />
        </label>
        <button type="submit" className="rounded-lg border border-gold/40 px-3 py-2 text-[11px] font-semibold text-gold">
          Chạy &amp; tạo candidate
        </button>
        <p className="w-full text-[10.5px] text-fog-2">
          Reuse trace gần nhất nếu có; không có → dry-run record:false. review_id=null, không đụng bad_search_reviews.
        </p>
      </form>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* candidates cần hành động */}
        <section className="rounded-2xl border border-line bg-ink-2/60 p-4">
          <h2 className="text-[13px] font-semibold text-paper">Candidates · cần label/approve</h2>
          {drafts.length === 0 && <p className="mt-3 text-[12px] text-fog-2">Chưa có candidate nào — tạo từ bad-search confirmed_bad trong /ops/quality.</p>}
          <ul className="mt-3 space-y-3">
            {drafts.map((c) => (
              <li key={c.id} className="rounded-xl border border-line/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-semibold text-paper">{c.querySafe}</span>
                  <span className={`text-[10.5px] font-semibold ${STATUS_CLASS[c.status]}`}>
                    v{c.version} · {STATUS_LABEL[c.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-fog-2">
                  {c.source === "manual_nomination" ? "manual nomination · positive control" : "bad-search review · failure-derived"}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-gold">Label / sửa</summary>
                  <LabelForm c={c} op="label" />
                </details>
                {c.status === "labeled" && (
                  <form method="post" action="/ops/golden/actions" className="mt-2">
                    <input type="hidden" name="op" value="approve" />
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className="rounded-lg border border-jade/40 px-3 py-1.5 text-[11px] font-semibold text-jade">Approve</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* approved benchmark cases */}
        <section className="rounded-2xl border border-line bg-ink-2/60 p-4">
          <h2 className="text-[13px] font-semibold text-paper">Benchmark cases · approved/promoted</h2>
          {approved.length === 0 && <p className="mt-3 text-[12px] text-fog-2">Chưa có case nào.</p>}
          <ul className="mt-3 space-y-3">
            {approved.map((c) => (
              <li key={c.id} className="rounded-xl border border-line/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-semibold text-paper">{c.querySafe}</span>
                  <span className={`text-[10.5px] font-semibold ${STATUS_CLASS[c.status]}`}>
                    v{c.version} · {STATUS_LABEL[c.status]}
                  </span>
                </div>
                <p className="mt-1 text-[10.5px] text-fog-2">
                  {c.source === "manual_nomination" ? "manual" : "review"} · {c.intent} · {c.specialty ?? "—"} · {c.authorityRequirement ?? "—"} · {c.abstentionExpected ? "abstain" : `${(c.expectedEntities as string[] | null)?.length ?? 0} entities`}
                </p>
                <div className="mt-2 flex gap-2">
                  {c.status === "approved" && (
                    <form method="post" action="/ops/golden/actions">
                      <input type="hidden" name="op" value="promote" />
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" className="rounded-lg border border-gold/40 px-3 py-1.5 text-[11px] font-semibold text-gold">Promote → golden</button>
                    </form>
                  )}
                  <details>
                    <summary className="cursor-pointer text-[11px] text-fog-2">Revise</summary>
                    <LabelForm c={c} op="revise" />
                  </details>
                </div>
              </li>
            ))}
          </ul>
          {superseded.length > 0 && (
            <p className="mt-4 text-[10.5px] text-fog-2">
              {superseded.length} version cũ đã superseded — lịch sử giữ trong golden_candidate_events, không overwrite.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
