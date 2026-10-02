"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { useReducedMotion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, BookOpenText,
  Check, CheckCheck, ChevronRight, Coffee, Database, FileCheck2, FileText,
  Globe2, Info, Languages, Layers3, MapPin, MessageCircle, Newspaper,
  Search, ShieldCheck, Sparkles, Sprout, Scale,
} from "lucide-react";
import { SearchBox, type SearchBoxHandle } from "./search-box";
import { ApiPreview } from "./api-preview";
import { PRODUCT, PROMPT_CHIPS, QUERY_EXAMPLES } from "@/lib/product-copy";

export interface HomeStats {
  available: boolean;
  backend: string;
  places: number;
  adminUnits: number;
  documents: number;
  provinces: number;
  metrics: Record<string, number> | null;
  evalName: string;
  evalCount: number;
}

const VERTICALS = [
  { icon: MapPin, title: "Địa điểm", detail: "Quán ăn, cafe, cửa hàng, doanh nghiệp. Tìm đúng nơi, đúng nhu cầu, gần khu vực bạn muốn.", tags: "Quán ăn · Cửa hàng · Doanh nghiệp", query: "quán giò chả ngon ở Yên Dũng", color: "text-gold", tint: "bg-gold/10" },
  { icon: Scale, title: "Pháp luật", detail: "Tra cứu văn bản, điều khoản và thay đổi chính sách. Đối chiếu thông tin với nguồn chính thức.", tags: "Văn bản · Điều khoản · Hiệu lực", query: "nghị định mới nhất về hóa đơn điện tử", color: "text-[#adbbd4]", tint: "bg-[#adbbd4]/10" },
  { icon: Newspaper, title: "Tin tức & thị trường", detail: "Theo dõi tin tức, giá cả và xu hướng. Tìm hiểu câu chuyện phía sau qua nhiều góc nhìn.", tags: "Tin tức · Giá cả · Xu hướng", query: "giá vàng hôm nay vì sao tăng", color: "text-flame-2", tint: "bg-flame-2/10" },
  { icon: Layers3, title: "Dữ liệu Việt Nam", detail: "Từ địa danh cũ–mới đến hành chính, doanh nghiệp và sản phẩm. Hiểu thông tin trong đúng ngữ cảnh.", tags: "Địa danh · Hành chính · Thực thể", query: "Yên Dũng cũ nay thuộc đơn vị nào", color: "text-jade", tint: "bg-jade/10" },
];

const FEATURES = [
  { icon: Languages, title: "Hiểu tiếng Việt tự nhiên", detail: "Không chỉ từ khóa — hiểu cách hỏi đời thường, tên gọi quen thuộc và địa danh cũ–mới." },
  { icon: Globe2, title: "Tìm từ nhiều nguồn", detail: "Kết nối web, pháp luật, địa điểm và nguồn chuyên ngành phù hợp với câu hỏi của bạn." },
  { icon: FileCheck2, title: "Trả lời có dẫn nguồn", detail: "Đọc câu trả lời, mở nguồn và tự kiểm chứng. Thông tin chưa đủ bằng chứng được nêu rõ." },
  { icon: Sprout, title: "Làm giàu dữ liệu Việt Nam", detail: "Ghi nhận nơi còn thiếu dữ liệu, bổ sung và xác minh để những lần tìm sau tốt hơn." },
];
const EXAMPLE_ICONS = [Coffee, Scale, Newspaper, MapPin, Search, Layers3];

export function HomeClient({ stats }: { stats: HomeStats }) {
  const searchRef = useRef<SearchBoxHandle>(null);
  const reduceMotion = useReducedMotion();
  const [feature, setFeature] = useState(0);

  function goSearch(query?: string) {
    if (query) searchRef.current?.fill(query);
    else searchRef.current?.focus();
    document.getElementById("tim-kiem")?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }

  function featureKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowDown: (index + 1) % 4, ArrowRight: (index + 1) % 4, ArrowUp: (index + 3) % 4, ArrowLeft: (index + 3) % 4, Home: 0, End: 3 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = moves[e.key];
    setFeature(next);
    document.getElementById(`feature-tab-${next}`)?.focus();
  }

  return (
    <main id="main-content" className="overflow-x-clip">
      {/* 01 — A question-first hero. No moving radar, no numerical marketing claims. */}
      <section aria-labelledby="hero-title" className="relative pb-16 pt-[132px] sm:pb-[76px] sm:pt-[154px]">
        <div aria-hidden="true" className="hero-wash pointer-events-none absolute inset-0" />
        <div className="site-container relative text-center">
          <div className="rise flex items-center justify-center gap-3 text-[9px] font-medium tracking-[0.17em] text-[#cbb58b] sm:text-[10px]">
            <span className="h-px w-5 bg-gold/50" aria-hidden="true" />{PRODUCT.eyebrow}<span className="h-px w-5 bg-gold/50" aria-hidden="true" />
          </div>
          <h1 id="hero-title" className="hero-heading rise rise-1 mx-auto mt-7 max-w-[1060px]">
            Tìm kiếm &amp; trả lời AI,<br className="hidden sm:block" />{" "}
            <span className="text-paper">hiểu Việt Nam </span><span className="text-gradient-gold">như người Việt</span>
          </h1>
          <p className="rise rise-2 mx-auto mt-6 max-w-[810px] text-pretty text-[15px] font-light leading-[1.8] text-fog sm:text-[19px] sm:leading-[1.7]">
            {PRODUCT.subheadline}
          </p>
          <div className="rise rise-3 mx-auto mt-9 max-w-[790px] text-left sm:mt-10">
            <SearchBox ref={searchRef} big id="tim-kiem" />
            <div className="mt-3 flex items-center justify-between gap-3 px-2 text-[10px] text-fog-2 sm:text-[11px]">
              <span className="flex items-center gap-1.5"><Languages className="size-3.5" strokeWidth={1.6} aria-hidden="true" />Gõ theo cách bạn quen, có dấu hoặc không dấu.</span>
              <span className="hidden shrink-0 items-center gap-1.5 sm:flex"><kbd className="rounded border border-line-2 px-1.5 py-0.5 font-sans text-[9px]">Enter ↵</kbd>để tìm kiếm</span>
            </div>
          </div>
          <div className="rise rise-4 mx-auto mt-7 max-w-[1080px]">
            <span className="mb-3 block text-[10px] text-fog-2">Bạn có thể bắt đầu với</span>
            <div className="flex flex-wrap justify-center gap-2">
              {PROMPT_CHIPS.map((item) => (
                <button type="button" key={item.id} onClick={() => goSearch(item.query)} title={`Điền câu hỏi: ${item.query}`} className="group flex max-w-full items-center gap-2 rounded-[10px] border border-white/[0.075] bg-white/[0.015] px-3 py-2.5 text-left transition-colors hover:border-gold/30 hover:bg-gold/[0.04]">
                  <span className="shrink-0 text-[8px] font-semibold uppercase tracking-[0.06em] text-gold/80 sm:text-[9px]">{item.label}</span>
                  <span className="text-[11px] leading-relaxed text-fog transition-colors group-hover:text-paper sm:text-[12px]">{item.query}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mx-auto mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[10px] text-fog-2 sm:gap-x-9 sm:text-[11px]">
            {[
              { icon: Languages, text: "Hiểu ngữ cảnh Việt" },
              { icon: Layers3, text: "Tìm kiếm đa nguồn" },
              { icon: ShieldCheck, text: "Dẫn nguồn để kiểm chứng" },
            ].map((s) => <span key={s.text} className="flex items-center gap-2"><s.icon className="size-3.5 text-fog-2/80" strokeWidth={1.5} aria-hidden="true" />{s.text}</span>)}
          </div>
          {stats.backend === "embedded" && <p className="mt-5 text-[10px] leading-relaxed text-fog-2/80">Bản trải nghiệm · Dữ liệu minh họa, chưa phải tìm kiếm web trực tiếp. <Link href="/docs#chat-luong" className="underline decoration-line-2 underline-offset-4 hover:text-fog">Tìm hiểu thêm</Link></p>}
        </div>
      </section>

      {/* 02 — Four focused verticals */}
      <section id="kham-pha" aria-labelledby="verticals-title" className="border-t border-white/[0.06] py-[68px] sm:py-20">
        <div className="site-container">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="section-kicker"><span className="mr-3 text-gold/70">01</span>Một nơi, nhiều lớp thông tin</p>
              <h2 id="verticals-title" className="section-heading mt-4">VietScope tìm được gì?</h2>
            </div>
            <p className="max-w-[325px] text-[13px] leading-[1.9] text-fog-2">Từ câu hỏi trong cuộc sống đến thông tin chuyên sâu. Bắt đầu bằng điều bạn muốn biết.</p>
          </div>
          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {VERTICALS.map((v, i) => (
              <button type="button" key={v.title} onClick={() => goSearch(v.query)} className="surface-card group flex flex-col rounded-[18px] p-[22px] text-left sm:min-h-[268px]">
                <div className="flex w-full items-center justify-between">
                  <span className={`flex size-10 items-center justify-center rounded-[11px] ${v.tint} ${v.color}`}><v.icon className="size-[19px]" strokeWidth={1.5} aria-hidden="true" /></span>
                  <span className="font-mono text-[10px] text-fog-2/45">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-[16px] font-semibold tracking-[-0.025em]">{v.title}</h3>
                <p className="mt-2 text-[12px] leading-[1.9] text-fog-2">{v.detail}</p>
                <span className="mt-auto flex w-full items-center justify-between gap-1 pt-6 text-[9px] text-fog-2/90">
                  <span>{v.tags}</span><ArrowUpRight className={`size-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${v.color}`} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 03 — A compact, interactive explanation, not a wall of architecture. */}
      <section id="vi-sao-vietscope" aria-labelledby="difference-title" className="border-y border-white/[0.06] bg-ink-2/35 py-[68px] sm:py-20">
        <div className="site-container">
          <p className="section-kicker"><span className="mr-3 text-gold/70">02</span>Vì sao VietScope khác biệt?</p>
          <div className="mt-4 grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-20">
            <div>
              <h2 id="difference-title" className="section-heading">Không chỉ tìm thông tin.<br /><span className="text-fog-2">Hiểu điều bạn đang hỏi.</span></h2>
              <div role="tablist" aria-label="Điểm khác biệt của VietScope" aria-orientation="vertical" className="mt-8 space-y-1.5">
                {FEATURES.map((f, i) => (
                  <button id={`feature-tab-${i}`} type="button" key={f.title} role="tab" aria-selected={feature === i} aria-controls="feature-panel" tabIndex={feature === i ? 0 : -1} onClick={() => setFeature(i)} onKeyDown={(e) => featureKey(e, i)} className={`group flex w-full items-start gap-3.5 rounded-xl border p-4 text-left transition-colors ${feature === i ? "border-gold/20 bg-gold/[0.035]" : "border-transparent hover:bg-white/[0.025]"}`}>
                    <f.icon className={`mt-0.5 size-[18px] shrink-0 ${feature === i ? "text-gold" : "text-fog-2"}`} strokeWidth={1.6} aria-hidden="true" />
                    <span className="flex-1"><span className={`block text-[13px] font-medium ${feature === i ? "text-paper" : "text-fog"}`}>{f.title}</span><span className="mt-1.5 block text-[12px] leading-[1.8] text-fog-2">{f.detail}</span></span>
                    <ChevronRight className={`mt-1 size-3.5 shrink-0 transition-opacity ${feature === i ? "text-gold opacity-100" : "opacity-0"}`} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
            <div className="self-center">
              <FeaturePreview index={feature} />
              <p className="mt-4 text-center text-[10px] text-fog-2">Minh họa cách hoạt động · Không phải kết quả tìm kiếm trực tiếp.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 04 — Real Vietnamese questions, fill the search field without submitting. */}
      <section id="cau-hoi-mau" aria-labelledby="examples-title" className="py-[68px] sm:py-20">
        <div className="site-container">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div><p className="section-kicker"><span className="mr-3 text-gold/70">03</span>Thử một câu hỏi thật Việt</p><h2 id="examples-title" className="section-heading mt-4">Hôm nay, bạn muốn biết gì?</h2></div>
            <p className="max-w-[275px] text-[12px] leading-[1.9] text-fog-2">Chọn một câu hỏi để điền vào ô tìm kiếm.<br />Bạn có thể sửa lại trước khi gửi.</p>
          </div>
          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUERY_EXAMPLES.map((q, i) => {
              const Icon = EXAMPLE_ICONS[i];
              return <button type="button" key={q.id} onClick={() => goSearch(q.query)} className="surface-card group flex min-h-[152px] flex-col rounded-[16px] px-5 py-5 text-left">
                <span className="flex w-full items-center justify-between"><span className="flex items-center gap-2 text-[9px] uppercase tracking-[0.1em] text-fog-2"><Icon className="size-3.5" strokeWidth={1.5} aria-hidden="true" />{q.label}</span><ArrowUpRight className="size-3.5 text-fog-2/65 transition-colors group-hover:text-gold" aria-hidden="true" /></span>
                <span className="mt-5 max-w-[265px] text-[14px] font-medium leading-[1.75] tracking-[-0.01em] text-fog transition-colors group-hover:text-paper">{q.query}<span className="ml-1 text-gold/70">?</span></span>
              </button>;
            })}
          </div>
        </div>
      </section>

      {/* 05 — The developer offering is visible without taking over the product. */}
      <section id="api" aria-labelledby="api-title" className="pb-[72px] pt-4 sm:pb-20">
        <div className="site-container">
          <div className="relative overflow-hidden rounded-[24px] border border-white/[0.09] bg-[#0f151a] p-6 sm:p-10 lg:p-12">
            <div aria-hidden="true" className="pointer-events-none absolute -right-48 -top-56 size-[600px] rounded-full bg-[radial-gradient(circle,rgba(36,200,165,0.045),transparent_70%)]" />
            <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
              <div>
                <span className="flex items-center gap-2 font-mono text-[10px] text-jade"><span className="size-1.5 rounded-full bg-jade" aria-hidden="true" />vietscope-1<span className="ml-1 text-fog-2/50">/</span><span className="font-sans text-[9px] uppercase tracking-[0.12em] text-fog-2">Cho nhà phát triển</span></span>
                <h2 id="api-title" className="mt-5 text-[27px] font-semibold leading-[1.35] tracking-[-0.04em] sm:text-[33px]">Một công cụ cho bạn.<br /><span className="text-fog-2">Một API cho ứng dụng.</span></h2>
                <p className="mt-4 max-w-[365px] text-[13px] leading-[1.9] text-fog">{PRODUCT.developerDescription} Tích hợp câu trả lời, nguồn tham khảo và dữ liệu có cấu trúc vào sản phẩm của bạn.</p>
                <div className="mt-7 flex flex-wrap gap-3"><Link href="/docs" className="button-primary !border-jade !bg-jade !text-[#07241d] hover:!bg-[#53d9ba]">Xem API<ArrowUpRight className="size-3.5" /></Link><button type="button" onClick={() => goSearch()} className="button-secondary">Dùng thử tìm kiếm<ArrowRight className="size-3.5" /></button></div>
                <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-fog-2"><span className="flex items-center gap-1.5"><Check className="size-3 text-jade" />OpenAI-compatible</span><span className="flex items-center gap-1.5"><Check className="size-3 text-jade" />API &amp; MCP</span><span className="flex items-center gap-1.5"><Check className="size-3 text-jade" />Một model duy nhất</span></div>
              </div>
              <ApiPreview />
            </div>
          </div>
          {stats.available && stats.backend === "embedded" && <p className="mx-auto mt-5 flex max-w-[720px] items-start justify-center gap-1.5 text-center text-[10px] leading-[1.8] text-fog-2"><Info className="mt-[3px] size-3 shrink-0" aria-hidden="true" /><span>Bản trải nghiệm dùng {stats.places} địa điểm và {stats.documents} tài liệu mẫu để minh họa. Thông tin giá cả, pháp luật và địa điểm cần được kiểm tra tại nguồn trước khi sử dụng.</span></p>}
        </div>
      </section>
    </main>
  );
}

function FeaturePreview({ index }: { index: number }) {
  const titles = ["Hiểu câu hỏi của bạn", "Chọn nguồn phù hợp", "Đọc và kiểm chứng", "Dữ liệu tốt hơn mỗi ngày"];
  return (
    <div id="feature-panel" role="tabpanel" aria-labelledby={`feature-tab-${index}`} tabIndex={0} className="overflow-hidden rounded-[20px] border border-white/10 bg-[#10151d] shadow-[0_20px_80px_-50px_rgba(0,0,0,0.8)]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4 text-[10px] text-fog-2"><span className="flex items-center gap-2"><Sparkles className="size-3.5 text-gold" strokeWidth={1.5} />{titles[index]}</span><span className="rounded-md border border-line px-1.5 py-0.5 text-[8px] uppercase tracking-wider">Minh họa</span></div>
      <div className="min-h-[345px] px-6 py-7 sm:px-8" key={index}>
        {index === 0 && <div className="rise">
          <p className="mb-3 text-[9px] uppercase tracking-[0.14em] text-fog-2">Bạn hỏi theo cách quen thuộc</p>
          <div className="flex items-center gap-2.5 rounded-xl border border-line-2 bg-ink/65 px-4 py-3.5 text-[14px] text-paper"><Search className="size-4 shrink-0 text-gold" strokeWidth={1.5} /><span>cafe yên tĩnh ở Sài Gòn</span></div>
          <div className="ml-6 my-4 flex items-center gap-3"><span className="h-5 w-px bg-line-2" /><span className="text-[9px] text-fog-2">VietScope nhận diện ngữ cảnh</span></div>
          <div className="space-y-2">
            {[
              { from: "cafe", to: "Cà phê", label: "Nhu cầu", icon: Coffee },
              { from: "Sài Gòn", to: "TP. Hồ Chí Minh", label: "Địa danh", icon: MapPin },
            ].map((r) => <div key={r.from} className="grid grid-cols-[1fr_20px_1.4fr] items-center gap-2 rounded-[10px] border border-line/80 bg-ink-2/60 px-3.5 py-3"><span className="text-[12px] text-fog-2">{r.from}</span><ArrowRight className="size-3 text-fog-2/50" /><span className="flex items-center gap-2 text-[11px] text-paper"><r.icon className="size-3 text-gold/80" />{r.to}</span></div>)}
          </div>
          <div className="mt-5 flex items-center gap-2 text-[11px] text-jade/90"><CheckCheck className="size-3.5 shrink-0" />Một cách gọi khác. Vẫn đúng điều bạn muốn tìm.</div>
        </div>}
        {index === 1 && <div className="rise">
          <p className="text-[15px] font-medium leading-relaxed">Tra cứu một quy định mới?</p><p className="mt-2 text-[12px] leading-[1.8] text-fog-2">Nguồn phù hợp quan trọng hơn một danh sách thật dài.</p>
          <div className="mt-6 space-y-2.5">{[
            { icon: Scale, title: "Văn bản chính thức", label: "Ưu tiên", color: "text-jade" },
            { icon: FileText, title: "Bài phân tích chuyên ngành", label: "Đối chiếu", color: "text-gold" },
            { icon: Newspaper, title: "Tin tức liên quan", label: "Bối cảnh", color: "text-fog-2" },
          ].map((s) => <div key={s.title} className="flex items-center gap-3 rounded-xl border border-line bg-ink-2/80 px-3.5 py-4"><s.icon className="size-4 shrink-0 text-fog-2" /><span className="flex-1 text-[11px] text-paper">{s.title}</span><span className={`text-[9px] ${s.color}`}>{s.label}</span></div>)}</div>
        </div>}
        {index === 2 && <div className="rise">
          <div className="mb-5 flex items-center gap-2 text-[10px] text-jade"><ShieldCheck className="size-3.5" />Bạn có thể kiểm tra lại nguồn</div>
          <p className="text-[15px] leading-[1.95] text-paper">Khi tra cứu quy định pháp luật, bạn có thể đối chiếu văn bản gốc tại Cổng thông tin văn bản Chính phủ.<a href="https://vanban.chinhphu.vn/" target="_blank" rel="noopener noreferrer" className="cite" aria-label="Mở Cổng thông tin văn bản Chính phủ">1</a></p>
          <div className="my-6 h-px bg-line" /><div className="mb-3 text-[9px] uppercase tracking-widest text-fog-2">Nguồn tham khảo</div>
          <a href="https://vanban.chinhphu.vn/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-line bg-ink/50 p-4 transition-colors hover:border-gold/30"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold"><BookOpenText className="size-4" /></span><span className="flex-1"><span className="block text-[12px] text-paper">Cổng văn bản Chính phủ</span><span className="mt-1 block text-[10px] text-fog-2">vanban.chinhphu.vn</span></span><ArrowUpRight className="size-3.5 text-fog-2" /></a>
        </div>}
        {index === 3 && <div className="rise">
          <p className="text-[15px] font-medium leading-[1.7]">Mỗi câu hỏi giúp nhận ra<br />một khoảng trống dữ liệu.</p>
          <div className="mt-5">{[
            { icon: MessageCircle, title: "Ghi nhận điều bạn tìm", text: "Nhu cầu thực tế từ câu hỏi" },
            { icon: Globe2, title: "Tìm nguồn bổ sung", text: "Phát hiện thông tin liên quan" },
            { icon: ShieldCheck, title: "Xác minh trước khi sử dụng", text: "Không đánh đồng gợi ý với dữ liệu đã kiểm chứng" },
            { icon: Database, title: "Làm giàu dữ liệu Việt Nam", text: "Để lần tìm tiếp theo tốt hơn" },
          ].map((s, i) => <div key={s.title} className="relative flex gap-3.5 pb-4 last:pb-0">{i < 3 && <span className="absolute left-3.5 top-7 h-[calc(100%-25px)] w-px bg-line-2" />}<span className={`z-[1] flex size-7 shrink-0 items-center justify-center rounded-lg border border-line bg-[#10151d] ${i === 2 ? "text-jade" : "text-gold/70"}`}><s.icon className="size-3.5" /></span><span><span className="block text-[11px] font-medium text-paper">{s.title}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-fog-2">{s.text}</span></span></div>)}</div>
        </div>}
      </div>
      <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-3 text-[9px] text-fog-2"><span>Hiểu đúng ngữ cảnh Việt Nam</span><span className="font-mono text-jade/80">vietscope-1</span></div>
    </div>
  );
}
