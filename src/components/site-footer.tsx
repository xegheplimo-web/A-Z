import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { PRODUCT } from "@/lib/product-copy";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.07] bg-ink">
      <div className="site-container py-11 sm:py-14">
        <div className="flex flex-col justify-between gap-9 sm:flex-row sm:gap-16">
          <div className="max-w-[330px]">
            <BrandLogo />
            <p className="mt-4 text-[13px] leading-[1.9] text-fog-2">{PRODUCT.northStar}</p>
          </div>
          <div className="flex gap-12 text-[12px] sm:gap-20">
            <nav aria-label="Sản phẩm" className="flex flex-col gap-3">
              <span className="mb-1 text-[10px] uppercase tracking-[0.13em] text-fog-2">Sản phẩm</span>
              <Link href="/#tim-kiem" className="w-fit rounded-sm text-fog hover:text-paper">Tìm kiếm</Link>
              <Link href="/#api" className="w-fit rounded-sm text-fog hover:text-paper">VietScope API</Link>
              <Link href="/docs" className="w-fit rounded-sm text-fog hover:text-paper">Tài liệu</Link>
            </nav>
            <nav aria-label="Về VietScope" className="flex flex-col gap-3">
              <span className="mb-1 text-[10px] uppercase tracking-[0.13em] text-fog-2">Về VietScope</span>
              <Link href="/#vi-sao-vietscope" className="w-fit rounded-sm text-fog hover:text-paper">Cách VietScope hoạt động</Link>
              <Link href="/docs#chat-luong" className="w-fit rounded-sm text-fog hover:text-paper">Đo lường chất lượng</Link>
              <a href={PRODUCT.github} target="_blank" rel="noopener noreferrer" className="flex w-fit items-center gap-1 rounded-sm text-fog hover:text-paper">GitHub<ArrowUpRight className="size-3" aria-hidden="true" /></a>
            </nav>
          </div>
        </div>
        <div className="mt-10 flex flex-col justify-between gap-3 border-t border-line/60 pt-5 text-[10.5px] text-fog-2 sm:flex-row sm:items-center">
          <span>© VietScope · Search &amp; Answer Engine</span>
          <span className="inline-flex items-center gap-2"><span className="vi-star size-2.5 bg-gold/80" aria-hidden="true" />Được xây dựng cho tiếng Việt.</span>
        </div>
      </div>
    </footer>
  );
}
