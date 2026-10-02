"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";
import { useReducedMotion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Check, Landmark,
  Languages, Layers3, MapPin, Newspaper, Scale,
  ShoppingBag, ShieldCheck,
} from "lucide-react";
import { SearchBox, type SearchBoxHandle } from "./search-box";
import { ApiPreview } from "./api-preview";
import { PRODUCT, PROMPT_CHIPS } from "@/lib/product-copy";

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

const CHIP_ICON: Record<string, typeof MapPin> = {
  places: MapPin,
  legal: Scale,
  market: Newspaper,
  product: ShoppingBag,
  admin: Landmark,
};

const VERTICALS = [
  { icon: MapPin, title: "Địa điểm", detail: "Quán ăn, cafe, cửa hàng, doanh nghiệp. Tìm đúng nơi, đúng nhu cầu, gần khu vực bạn muốn.", tags: "Quán ăn · Cửa hàng · Doanh nghiệp", query: "quán giò chả ngon ở Yên Dũng", color: "text-gold", tint: "bg-gold/10" },
  { icon: Scale, title: "Pháp luật", detail: "Tra cứu văn bản, điều khoản và thay đổi chính sách. Đối chiếu thông tin với nguồn chính thức.", tags: "Văn bản · Điều khoản · Hiệu lực", query: "nghị định mới nhất về hóa đơn điện tử", color: "text-[#adbbd4]", tint: "bg-[#adbbd4]/10" },
  { icon: Newspaper, title: "Tin tức & thị trường", detail: "Theo dõi tin tức, giá cả và xu hướng. Tìm hiểu câu chuyện phía sau qua nhiều góc nhìn.", tags: "Tin tức · Giá cả · Xu hướng", query: "giá vàng hôm nay vì sao tăng", color: "text-flame-2", tint: "bg-flame-2/10" },
  { icon: Layers3, title: "Dữ liệu Việt Nam", detail: "Từ địa danh cũ–mới đến hành chính, doanh nghiệp và sản phẩm. Hiểu thông tin trong đúng ngữ cảnh.", tags: "Địa danh · Hành chính · Thực thể", query: "Yên Dũng cũ nay thuộc đơn vị nào", color: "text-jade", tint: "bg-jade/10" },
];

export function HomeClient({ stats }: { stats: HomeStats }) {
  const searchRef = useRef<SearchBoxHandle>(null);
  const reduceMotion = useReducedMotion();

  function goSearch(query?: string) {
    if (query) searchRef.current?.fill(query);
    else searchRef.current?.focus();
    document.getElementById("tim-kiem")?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }

  function chipKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const chips = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-prompt-chip]"));
      const i = chips.indexOf(e.currentTarget);
      const next = chips[(i + (e.key === "ArrowRight" ? 1 : chips.length - 1)) % chips.length];
      next?.focus();
      e.preventDefault();
    }
  }

  return (
    <main id="main-content" className="overflow-x-clip">
      {/* 01 — Search-first hero: một câu hỏi tự nhiên, không landing dài. */}
      <section aria-labelledby="hero-title" className="relative pb-16 pt-[128px] sm:pb-[84px] sm:pt-[156px]">
        <div aria-hidden="true" className="hero-wash pointer-events-none absolute inset-0" />
        <div className="site-container relative text-center">
          <h1 id="hero-title" className="hero-heading rise rise-1 mx-auto max-w-[900px]">
            Tìm kiếm Việt Nam,<br className="hidden sm:block" />{" "}
            <span className="text-gradient-gold">theo cách tự nhiên.</span>
          </h1>
          <p className="rise rise-2 mx-auto mt-5 max-w-[560px] text-pretty text-[15px] font-light leading-[1.85] text-fog sm:text-[16px]">
            Tìm địa điểm, doanh nghiệp, pháp luật và tin tức Việt Nam — có đối chiếu nguồn và dẫn chứng rõ ràng.
          </p>
          <div className="rise rise-3 mx-auto mt-9 max-w-[790px] text-left sm:mt-10">
            <SearchBox ref={searchRef} big id="tim-kiem" />
          </div>
          <div className="rise rise-4 mx-auto mt-6 flex max-w-[820px] flex-wrap items-center justify-center gap-2">
            {PROMPT_CHIPS.map((item) => {
              const Icon = CHIP_ICON[item.id] ?? MapPin;
              return (
                <button
                  type="button"
                  key={item.id}
                  data-prompt-chip
                  onClick={() => goSearch(item.query)}
                  onKeyDown={chipKey}
                  title={`Điền câu hỏi: ${item.query}`}
                  className="group flex items-center gap-2 rounded-full border border-white/[0.075] bg-white/[0.015] px-4 py-2.5 text-[12.5px] font-medium text-fog transition-colors hover:border-gold/30 hover:bg-gold/[0.05] hover:text-paper"
                >
                  <Icon className="size-3.5 text-fog-2 transition-colors group-hover:text-gold" strokeWidth={1.7} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="mx-auto mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11.5px] text-fog-2">
            <span className="flex items-center gap-1.5"><Languages className="size-3.5" strokeWidth={1.6} aria-hidden="true" />Hiểu tiếng Việt</span>
            <span className="flex items-center gap-1.5"><Layers3 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />Đa nguồn</span>
            <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" strokeWidth={1.6} aria-hidden="true" />Có dẫn nguồn</span>
          </p>
          {stats.backend === "embedded" && <p className="mt-6 text-[11px] leading-relaxed text-fog-2/80">Bản trải nghiệm · Dữ liệu minh họa, chưa phải tìm kiếm web trực tiếp. <Link href="/docs#chat-luong" className="underline decoration-line-2 underline-offset-4 hover:text-fog">Tìm hiểu thêm</Link></p>}
        </div>
      </section>

      {/* 02 — Bốn lớp thông tin chính */}
      <section id="kham-pha" aria-labelledby="verticals-title" className="border-t border-white/[0.06] py-[68px] sm:py-20">
        <div className="site-container">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="section-kicker">Khám phá</p>
              <h2 id="verticals-title" className="section-heading mt-4">VietScope tìm được gì?</h2>
            </div>
            <p className="max-w-[325px] text-[13px] leading-[1.9] text-fog-2">Từ câu hỏi trong cuộc sống đến thông tin chuyên sâu. Bắt đầu bằng điều bạn muốn biết.</p>
          </div>
          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {VERTICALS.map((v) => (
              <button type="button" key={v.title} onClick={() => goSearch(v.query)} className="surface-card group flex flex-col rounded-[18px] p-[22px] text-left sm:min-h-[248px]">
                <span className={`flex size-10 items-center justify-center rounded-[11px] ${v.tint} ${v.color}`}><v.icon className="size-[19px]" strokeWidth={1.5} aria-hidden="true" /></span>
                <h3 className="mt-5 text-[16px] font-semibold tracking-[-0.025em]">{v.title}</h3>
                <p className="mt-2 text-[12.5px] leading-[1.9] text-fog-2">{v.detail}</p>
                <span className="mt-auto flex w-full items-center justify-between gap-1 pt-6 text-[10.5px] text-fog-2/90">
                  <span>{v.tags}</span><ArrowUpRight className={`size-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${v.color}`} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 03 — API cho nhà phát triển, gọn một khối */}
      <section id="api" aria-labelledby="api-title" className="pb-[72px] pt-2 sm:pb-20">
        <div className="site-container">
          <div className="relative overflow-hidden rounded-[24px] border border-white/[0.09] bg-[#0f151a] p-6 sm:p-10 lg:p-12">
            <div aria-hidden="true" className="pointer-events-none absolute -right-48 -top-56 size-[600px] rounded-full bg-[radial-gradient(circle,rgba(36,200,165,0.045),transparent_70%)]" />
            <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
              <div>
                <span className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-fog-2"><span className="size-1.5 rounded-full bg-jade" aria-hidden="true" />Cho nhà phát triển</span>
                <h2 id="api-title" className="mt-5 text-[27px] font-semibold leading-[1.35] tracking-[-0.04em] sm:text-[33px]">Một công cụ cho bạn.<br /><span className="text-fog-2">Một API cho ứng dụng.</span></h2>
                <p className="mt-4 max-w-[365px] text-[13.5px] leading-[1.9] text-fog">{PRODUCT.developerDescription} Tích hợp câu trả lời, nguồn tham khảo và dữ liệu có cấu trúc vào sản phẩm của bạn.</p>
                <div className="mt-7 flex flex-wrap gap-3"><Link href="/docs" className="button-primary !border-jade !bg-jade !text-[#07241d] hover:!bg-[#53d9ba]">Xem API<ArrowUpRight className="size-3.5" /></Link><button type="button" onClick={() => goSearch()} className="button-secondary">Dùng thử tìm kiếm<ArrowRight className="size-3.5" /></button></div>
                <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-fog-2"><span className="flex items-center gap-1.5"><Check className="size-3 text-jade" />OpenAI-compatible</span><span className="flex items-center gap-1.5"><Check className="size-3 text-jade" />API &amp; MCP</span><span className="flex items-center gap-1.5"><Check className="size-3 text-jade" />Một model duy nhất</span></div>
              </div>
              <ApiPreview />
            </div>
          </div>
          {stats.available && stats.backend === "embedded" && <p className="mx-auto mt-5 flex max-w-[720px] items-start justify-center gap-1.5 text-center text-[11px] leading-[1.8] text-fog-2"><span>Bản trải nghiệm dùng {stats.places} địa điểm và {stats.documents} tài liệu mẫu để minh họa. Thông tin giá cả, pháp luật và địa điểm cần được kiểm tra tại nguồn trước khi sử dụng.</span></p>}
        </div>
      </section>
    </main>
  );
}
