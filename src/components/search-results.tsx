// Server components — hiển thị kết quả pipeline VietScope
import {
  BadgeCheck,
  Clock,
  ExternalLink,
  FileText,
  Landmark,
  MapPin,
  Navigation,
  Newspaper,
  Package,
  Phone,
  Radar,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Users,
  ChevronDown,
  Info,
} from "lucide-react";
import type { VietScopeResponse, PublicPlace } from "@/lib/pipeline";
import { TracePanel } from "./trace-panel";
import { RelatedForm } from "./related-form";
import { FeedbackWidget, PromoteButton } from "./flywheel-actions";

const SRC_ICON: Record<string, typeof Newspaper> = {
  news: Newspaper,
  law: Landmark,
  government: Landmark,
  community: Users,
  product: Package,
  web: FileText,
};

const SRC_LABEL: Record<string, string> = {
  news: "Tin tức",
  law: "Văn bản QPPL",
  government: "Chính quyền",
  community: "Cộng đồng",
  product: "Sản phẩm",
  web: "Web",
};

const CATEGORY_GRADIENT: Record<string, string> = {
  cafe: "from-amber-900/80 to-amber-700/40",
  "gio-cha": "from-rose-900/80 to-rose-700/40",
  pho: "from-orange-900/80 to-orange-700/40",
  default: "from-slate-800/90 to-slate-700/40",
};

function Cite({ n }: { n: number }) {
  return (
    <a href={`#src-${n}`} className="cite no-underline" title={`Nguồn ${n}`}>
      {n}
    </a>
  );
}

/** Render text có marker [n] thành citation chips */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const mm = p.match(/^\[(\d+)\]$/);
        if (mm) return <Cite key={i} n={Number(mm[1])} />;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function SearchResults({ data }: { data: VietScopeResponse }) {
  const { understanding: und, answer, places, sources, web, quality, coverage } = data;
  const isLocal = und.intent === "local_search";
  const intentNames: Record<string, string> = {
    local_search: "Địa điểm", legal: "Pháp luật", market_price: "Thị trường", weather: "Thời tiết",
    compare: "So sánh", admin_info: "Địa danh & hành chính", product: "Sản phẩm", news: "Tin tức", general: "Tìm kiếm tổng hợp",
  };

  return (
    <div className="space-y-6">
      {/* Chỉ hiện ngữ cảnh có ích cho người tìm kiếm; chẩn đoán nằm trong Chi tiết tìm kiếm. */}
      <div className="rise flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fog-2">
        <span className="flex items-center gap-1.5 font-medium text-gold"><Sparkles className="size-3.5" />{intentNames[und.intent] ?? "Tìm kiếm tổng hợp"}</span>
        {und.specialty && <span className="flex items-center gap-1.5"><ShoppingBag className="size-3" />{und.specialty}</span>}
        {und.locations.slice(0, 2).map((l) => <span key={l.id} className="flex items-center gap-1.5"><MapPin className="size-3" />{l.name}{l.status !== "current" && <span className="text-[9px] text-fog-2/80">· tên cũ</span>}</span>)}
        {und.fuzzy?.used && <span className="flex items-start gap-1.5 text-[10px] leading-relaxed"><Info className="mt-0.5 size-3 shrink-0" />Gợi ý sửa lỗi gõ: {und.fuzzy.notes[0]}</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ============ MAIN COLUMN ============ */}
        <div className="min-w-0 space-y-6">
          {/* ---------- Answer: open canvas — nội dung quan trọng hơn container ---------- */}
          <section className="rise rise-1">
            <div className="border-b border-line/60 pb-5">
              <p className="mb-3 text-[11px] uppercase tracking-[0.14em] text-fog-2">Câu trả lời</p>
              <h1 className="text-[21px] font-semibold leading-[1.5] tracking-[-0.03em] text-paper sm:text-[25px]">{answer.headline}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-fog-2">
                {sources.length ? <a href="#sources" className="flex items-center gap-1.5 rounded-sm hover:text-paper"><FileText className="size-3.5" />{sources.length} nguồn tham khảo</a> : <span>Chưa có đủ nguồn phù hợp</span>}
                {answer.claimsUnsupported > 0 && <span className="flex items-center gap-1.5 text-gold/90"><ShieldAlert className="size-3" />{answer.claimsUnsupported} nội dung cần kiểm chứng thêm</span>}
              </div>
            </div>
            <div className="space-y-5 py-6">
              {answer.blocks.map((b, i) => {
                if (b.kind === "table" && b.table) {
                  return (
                    <div key={i} className="overflow-x-auto rounded-xl border border-line">
                      <table className="w-full min-w-[520px] text-left text-[12.5px]">
                        <thead>
                          <tr className="border-b border-line bg-ink-3/70">
                            {b.table.columns.map((c) => (
                              <th key={c} className="px-3.5 py-2.5 font-semibold text-paper">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {b.table.rows.map((row, ri) => (
                            <tr key={ri} className="border-b border-line/60 last:border-0">
                              {row.map((cell, ci) => (
                                <td
                                  key={ci}
                                  className={`px-3.5 py-2.5 align-top ${ci === 0 ? "font-medium text-fog" : "text-paper"}`}
                                >
                                  <RichText text={cell} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }
                if (b.kind === "list" && b.items) {
                  return <ul key={i} className="space-y-3 pl-5 text-[14px] leading-[1.9] text-fog">
                    {b.items.map((item, j) => <li key={j} className="list-disc marker:text-gold/70">{item.text}{(item.citations ?? []).map((n) => <Cite key={n} n={n} />)}</li>)}
                  </ul>;
                }
                if (b.kind === "callout") {
                  return (
                    <div
                      key={i}
                      className={`flex gap-3 rounded-xl border px-4 py-3.5 text-[13.5px] leading-relaxed ${
                        b.supported === false
                          ? "border-flame/30 bg-flame/8 text-flame-2/95"
                          : "border-gold/25 bg-gold/8 text-paper"
                      }`}
                    >
                      {b.supported === false ? (
                        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-gold" />
                      )}
                      <p>
                        {b.text}
                        {(b.citations ?? []).map((n) => (
                          <Cite key={n} n={n} />
                        ))}
                      </p>
                    </div>
                  );
                }
                return (
                  <div key={i} className={b.supported === false ? "border-l-2 border-gold/50 pl-4" : undefined}>
                    {b.supported === false && <span className="mb-2 block text-[10px] font-medium text-gold">Chưa đủ bằng chứng — cần đối chiếu nguồn</span>}
                    <p className="text-[15px] leading-[1.9] text-fog">{b.text}{(b.citations ?? []).map((n) => <Cite key={n} n={n} />)}</p>
                  </div>
                );
              })}
              <div className="border-t border-line/70 pt-4">
                <FeedbackWidget traceId={data.trace_id} query={data.query} />
              </div>
            </div>
          </section>

          {/* ---------- Places: exact ---------- */}
          {isLocal && places.exact.length > 0 && (
            <section className="rise rise-2">
              <SectionHead
                title={`Địa điểm đã xác minh (${places.exact.length})`}
                sub="Khớp nhu cầu theo dữ liệu hiện có. Nên liên hệ trước khi đến."
                icon={<ShieldCheck className="size-4 text-jade" />}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {places.exact.map((p) => (
                  <PlaceCard key={p.id} p={p} />
                ))}
              </div>
            </section>
          )}

          {/* ---------- Places: web chưa xác minh ---------- */}
          {isLocal && places.unverified.length > 0 && (
            <section className="rise rise-3">
              <SectionHead
                title={`Tìm thấy thêm từ web (${places.unverified.length})`}
                sub="Có thông tin liên quan, nhưng chưa đủ bằng chứng để xác minh."
                icon={<ShieldAlert className="size-4 text-gold" />}
                tone="amber"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {places.unverified.map((p) => (
                  <PlaceCard key={p.id} p={p} dim />
                ))}
              </div>
            </section>
          )}

          {/* ---------- Flywheel candidates ---------- */}
          {places.candidates.length > 0 && (
            <details className="rise rise-3 rounded-2xl border border-dashed border-line-2 bg-ink-2/30 p-4">
              <summary className="flex items-center justify-between gap-3 text-[12px] text-fog">
                <span className="flex items-center gap-2"><Radar className="size-3.5 text-gold/80" />{places.candidates.length} địa điểm mới đang chờ xác minh</span><ChevronDown className="details-arrow size-3.5" />
              </summary>
              <div className="mt-4 space-y-2">
                {places.candidates.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-ink/70 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-paper">{c.name}</div>
                      <div className="truncate text-[11.5px] text-fog-2">
                        {c.address} · từ “{c.sourceTitle}”
                      </div>
                    </div>
                    <PromoteButton candidateId={c.id} name={c.name} specialty={c.specialty} />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-fog-2">
                Đây là dữ liệu đang chờ kiểm tra, không phải kết quả đã xác minh. Các thao tác ghi nhận dữ liệu dành cho người quản lý bản trải nghiệm.
              </p>
            </details>
          )}

          {/* ---------- Related places ---------- */}
          {isLocal && places.related.length > 0 && (
            <section className="rise rise-4">
              <SectionHead
                title={`Có thể phù hợp gần khu vực (${places.related.length})`}
                sub="Gợi ý trong khu vực, có thể không khớp hoàn toàn nhu cầu của bạn."
                icon={<Navigation className="size-4 text-fog" />}
                tone="dim"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {places.related.slice(0, 4).map((p) => (
                  <PlaceCard key={p.id} p={p} compact dim />
                ))}
              </div>
            </section>
          )}

          {/* ---------- Web results ---------- */}
          {web.length > 0 && (
            <section className="rise rise-4">
              <SectionHead
                title="Khám phá thêm từ nguồn"
                sub="Mở trang gốc để đọc đầy đủ và kiểm tra thời điểm cập nhật."
                icon={<FileText className="size-4 text-fog" />}
                tone="dim"
              />
              <div className="space-y-2.5">
                {web.slice(0, 6).map((w, i) => {
                  const Icon = SRC_ICON[w.sourceType] ?? FileText;
                  return (
                    <a
                      key={i}
                      href={w.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group block rounded-xl border border-line bg-ink-2/50 px-4 py-3 transition-colors hover:border-line-2 hover:bg-ink-2"
                    >
                      <div className="flex items-center gap-2 text-[11px] text-fog-2">
                        <Icon className="size-3" />
                        <span className="font-medium text-fog">{w.domain}</span>
                        <span>· {SRC_LABEL[w.sourceType] ?? w.sourceType}</span>
                        <span className="ml-auto flex items-center gap-1">
                          <Clock className="size-3" /> {w.freshness}
                        </span>
                      </div>
                      <div className="mt-1 text-[13.5px] font-semibold text-paper group-hover:text-gold">
                        {w.title}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-fog">{w.snippet}</p>
                    </a>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* ============ SIDEBAR ============ */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* sources */}
          {sources.length > 0 && (
            <div id="sources" className="rise rise-2 scroll-mt-28 rounded-2xl border border-line bg-ink-2/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[13px] font-medium text-paper">Nguồn tham khảo</h3>
                <span className="num-tabular text-[10.5px] text-fog-2">
                  {sources.length} nguồn
                </span>
              </div>
              <ol className="space-y-2">
                {sources.map((s) => {
                  const Icon = SRC_ICON[s.sourceType] ?? FileText;
                  return (
                    <li key={s.n} id={`src-${s.n}`} className="source-item scroll-mt-28">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-ink-3/80"
                      >
                        <span className="cite mt-0.5 shrink-0">{s.n}</span>
                        <span className="min-w-0">
                          <span className="line-clamp-2 text-[12px] font-medium leading-relaxed text-paper group-hover:text-gold">
                            {s.title}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fog-2">
                            <Icon className="size-2.5" />
                            {s.domain} · {s.freshness}
                          </span>
                          {data.citations[s.n - 1]?.passage && (
                            <span className="mt-1 line-clamp-2 block border-l-2 border-gold/40 pl-2 text-[10.5px] italic leading-snug text-fog-2">
                              “{data.citations[s.n - 1].passage!.text}”

                            </span>
                          )}
                        </span>
                        <ExternalLink className="ml-auto mt-1 size-3 shrink-0 text-fog-2 opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* trace */}
          <TracePanel data={data} />

          {/* quality */}
          <details className="rise rise-3 rounded-2xl border border-line bg-ink-2/60 p-4">
            <summary className="flex items-center justify-between text-[12px] text-fog">Thông tin đối chiếu<ChevronDown className="details-arrow size-3.5 text-fog-2" /></summary>
            <p className="mt-3 text-[10px] leading-relaxed text-fog-2">Các chỉ số kỹ thuật chỉ để tham khảo, không bảo đảm tính chính xác của nội dung.</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 text-[10px]">
              {[
                { k: "Điểm tham khảo", v: `${Math.round(quality.confidence * 100)}%`, good: quality.confidence >= 0.6 },
                { k: "Đã đối chiếu", v: `${Math.round(data.verification.verifiedRatio * 100)}%`, good: data.verification.verifiedRatio >= 0.8 },
                { k: "Đã xác minh", v: quality.exactCount, good: quality.exactCount > 0 },
                { k: "Chờ xác minh", v: quality.unverifiedCount, good: null },
                { k: "Gợi ý liên quan", v: quality.relatedCount, good: null },
                { k: "Miền nguồn", v: quality.sourceDiversity, good: quality.sourceDiversity >= 3 },
                { k: "Có dẫn nguồn", v: quality.citedClaims, good: quality.citedClaims > 0 },
                { k: "Cần kiểm chứng", v: quality.unsupportedClaims, good: quality.unsupportedClaims === 0 },
              ].map((x) => (
                <div key={x.k} className="flex items-center justify-between rounded-lg border border-line bg-ink px-2.5 py-1.5">
                  <dt className="text-fog-2">{x.k}</dt>
                  <dd
                    className={`num-tabular font-bold ${
                      x.good === null ? "text-paper" : x.good ? "text-jade" : "text-flame-2"
                    }`}
                  >
                    {x.v}
                  </dd>
                </div>
              ))}
            </dl>
            {coverage.gap && (
              <div className="mt-3 rounded-lg border border-flame/30 bg-flame/8 px-3 py-2 text-[11.5px] leading-relaxed text-flame-2/90">
                <b>Thông tin còn thiếu.</b> VietScope ghi nhận khoảng trống này để tiếp tục bổ sung dữ liệu.
              </div>
            )}
          </details>

          {/* related questions */}
          {data.answer.blocks.length > 0 && (
            <div className="rise rise-4 rounded-2xl border border-line bg-ink-2/60 p-4">
              <h3 className="mb-2.5 text-[13px] font-bold text-paper">Gợi ý tiếp theo</h3>
              <RelatedForm
                questions={suggestRelated(data)}
              />
            </div>
          )}

          <div className="rounded-xl border border-line/75 bg-ink-2/30 p-4 text-[10.5px] leading-[1.8] text-fog-2">
            <Info className="mb-2 size-3.5" />
            {data.backend === "embedded" ? "Bản trải nghiệm sử dụng dữ liệu minh họa, không phải thông tin web trực tiếp. " : "Thông tin và giờ mở cửa có thể thay đổi. "}
            Luôn kiểm tra nguồn trước khi đưa ra quyết định về pháp luật, tài chính hoặc địa điểm.
          </div>
        </aside>
      </div>
    </div>
  );
}

function suggestRelated(data: VietScopeResponse): string[] {
  const u = data.understanding;
  const loc = u.locations[0]?.name.replace(/^(Tỉnh|Huyện|Thị xã|Xã|Phường|Thành phố) /, "");
  const base: string[] = [];
  if (u.specialty && loc) {
    base.push(`${u.specialty} ngon nhất ${loc}`, `quán ăn đêm ở ${loc}`, `review ${u.specialty} ${loc}`);
  } else if (u.intent === "legal") {
    base.push("mức phạt không xuất hóa đơn điện tử", "hộ kinh doanh dưới 500 triệu có phải kê khai?", "hướng dẫn tra cứu hóa đơn trên cổng thuế");
  } else if (u.intent === "market_price") {
    base.push("giá vàng thế giới quy đổi hôm nay", "chênh lệch vàng trong nước thế giới", "giá xăng kỳ điều hành tới");
  } else if (u.intent === "compare") {
    base.push("giá lăn bánh VinFast VF 8 2025", "Santa Fe bản hybrid tiêu hao thực tế", "trạm sạc xe điện ở Bắc Ninh");
  } else {
    base.push("quán giò chả ngon ở Yên Dũng", "nghị định mới nhất về hóa đơn điện tử", "giá vàng hôm nay vì sao tăng");
  }
  if (u.transition) base.unshift(`${u.transition.from} nay là đơn vị nào`);
  return base.slice(0, 4);
}

function SectionHead({
  title,
  sub,
  icon,
  tone = "default",
}: {
  title: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: "default" | "amber" | "dim";
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      {icon}
      <div>
        <h2
          className={`text-[14.5px] font-bold ${
            tone === "amber" ? "text-gold" : tone === "dim" ? "text-fog" : "text-paper"
          }`}
        >
          {title}
        </h2>
        {sub && <p className="text-[11.5px] text-fog-2">{sub}</p>}
      </div>
    </div>
  );
}

function PlaceCard({ p, dim = false, compact = false }: { p: PublicPlace; dim?: boolean; compact?: boolean }) {
  const grad = CATEGORY_GRADIENT[p.categoryLabel === "Cà phê" ? "cafe" : ""] ?? null;
  const mapUrl =
    p.lat && p.lng ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}` : null;
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border transition-all ${
        dim ? "border-line/70 bg-ink-2/40" : "border-line bg-ink-2/70 hover:border-gold/35"
      }`}
    >
      <div className="flex gap-3.5 p-3.5">
        {/* thumb */}
        {!compact && (
          <div className="relative size-[76px] shrink-0 overflow-hidden rounded-xl border border-line sm:size-[84px]">
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.image.replace("w=1200", "w=480").replace("h=627", "h=300")}
                alt={p.name}
                loading="lazy"
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div
                className={`flex size-full items-center justify-center bg-gradient-to-br ${grad ?? CATEGORY_GRADIENT.default}`}
              >
                <MapPin className="size-5 text-paper/70" />
              </div>
            )}
            {p.verified && (
              <span className="absolute bottom-1 left-1 rounded-md bg-ink/85 p-0.5 backdrop-blur">
                <BadgeCheck className="size-3.5 text-jade" />
              </span>
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`font-semibold leading-snug ${dim ? "text-paper/85" : "text-paper"} ${compact ? "text-[13px]" : "text-[14px]"}`}>
              {p.name}
            </h3>
            {p.rating != null && (
              <span className="flex shrink-0 items-center gap-1 rounded-md bg-gold/12 px-1.5 py-0.5 text-[11.5px] font-bold text-gold num-tabular">
                <Star className="size-3 fill-gold" />
                {p.rating.toFixed(1).replace(".", ",")}
                <span className="font-normal text-fog-2">({p.reviewCount})</span>
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-fog-2">
            {p.categoryLabel}
          </div>
          <div className="mt-1 line-clamp-1 text-[12px] text-fog">
            <MapPin className="mr-1 inline size-3 -translate-y-px" />
            {p.address}
          </div>
          {!compact && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
              {p.openNow === true && (
                <span className="font-semibold text-jade">Đang mở · {p.hours}</span>
              )}
              {p.openNow === false && (
                <span className="font-semibold text-flame-2">Đóng cửa · {p.hours}</span>
              )}
              {p.distanceLabel && (
                <span className="text-fog num-tabular">cách ~{p.distanceLabel}</span>
              )}
              {p.priceLabel && <span className="text-fog">{p.priceLabel}</span>}
            </div>
          )}
          {!compact && (p.phone || mapUrl) && (
            <div className="mt-2 flex items-center gap-2">
              {p.phone && (
                <a
                  href={`tel:${p.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-ink px-2.5 py-1 text-[11.5px] font-medium text-paper transition-colors hover:border-jade/50 hover:text-jade"
                >
                  <Phone className="size-3" /> {p.phone}
                </a>
              )}
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-ink px-2.5 py-1 text-[11.5px] font-medium text-paper transition-colors hover:border-gold/50 hover:text-gold"
                >
                  <Navigation className="size-3" /> Bản đồ
                </a>
              )}
              <span className="ml-auto text-[10px] uppercase tracking-wider text-fog-2">
                nguồn {p.source}
              </span>
            </div>
          )}
        </div>
      </div>
      {p.note && !compact && (
        <div className="border-t border-line/60 px-3.5 py-2 text-[11.5px] leading-relaxed text-fog">
          {p.note}
        </div>
      )}
    </div>
  );
}

