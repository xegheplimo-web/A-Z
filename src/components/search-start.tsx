"use client";

import { useRef } from "react";
import { ArrowUpRight, Search, ShieldCheck } from "lucide-react";
import { SearchBox, type SearchBoxHandle } from "./search-box";
import { PRODUCT, QUERY_EXAMPLES } from "@/lib/product-copy";

export function SearchStart() {
  const search = useRef<SearchBoxHandle>(null);
  return (
    <section className="mx-auto max-w-[790px] pb-14 pt-8 sm:pt-16" aria-labelledby="search-start-title">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-6 flex size-12 items-center justify-center rounded-2xl border border-gold/15 bg-gold/[0.04] text-gold"><Search className="size-5" strokeWidth={1.5} /></div>
        <p className="section-kicker">VietScope · Search &amp; Answer Engine</p>
        <h1 id="search-start-title" className="mt-4 text-[30px] font-semibold leading-[1.3] tracking-[-0.045em] sm:text-[38px]">Bạn muốn biết gì về Việt Nam?</h1>
        <p className="mx-auto mt-4 max-w-[540px] text-[14px] leading-[1.9] text-fog-2">Một câu hỏi tự nhiên. Nhiều nguồn để đối chiếu.<br className="hidden sm:block" /> Bắt đầu bằng điều bạn đang quan tâm.</p>
      </div>
      <SearchBox big ref={search} autoFocus />
      <p className="mt-4 flex items-center justify-center gap-2 text-[11px] text-fog-2"><ShieldCheck className="size-3.5" />Kiểm tra nguồn tham khảo trước khi sử dụng thông tin quan trọng.</p>
      <div className="mt-10">
        <p className="mb-4 text-[10px] uppercase tracking-[0.13em] text-fog-2">Hoặc bắt đầu với một câu hỏi mẫu</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {QUERY_EXAMPLES.map((q) => <button key={q.id} type="button" onClick={() => search.current?.fill(q.query)} className="surface-card group rounded-xl p-4 text-left"><span className="flex items-center justify-between text-[9px] uppercase tracking-wider text-fog-2">{q.label}<ArrowUpRight className="size-3.5 text-fog-2 group-hover:text-gold" /></span><span className="mt-2.5 block text-[12px] leading-[1.85] text-fog group-hover:text-paper">{q.query}</span></button>)}
        </div>
      </div>
      <p className="mt-8 text-center text-[10px] text-fog-2/80">{PRODUCT.northStar}</p>
    </section>
  );
}
