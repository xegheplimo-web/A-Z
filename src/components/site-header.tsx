"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Menu, X } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { PRODUCT } from "@/lib/product-copy";
export { LogoMark } from "./brand-logo";

const NAV = [
  { label: "Tìm kiếm", href: "/#tim-kiem" },
  { label: "API", href: "/#api" },
  { label: "Tài liệu", href: "/docs" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); menuRef.current?.focus(); }
    };
    const outside = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [open]);

  function select(href: string) {
    setOpen(false);
    if (href === "/#tim-kiem" && pathname === "/") {
      window.setTimeout(() => document.getElementById("vietscope-query")?.focus({ preventScroll: true }), 100);
    }
  }

  return (
    <header ref={headerRef} className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-ink/90 backdrop-blur-xl">
      <div className="site-container flex h-[72px] items-center justify-between gap-3 md:gap-5">
        <BrandLogo badge />
        <nav aria-label="Điều hướng chính" className="ml-auto hidden items-center gap-7 text-[12px] font-medium md:flex">
          {NAV.map((item) => (
            <Link key={item.label} href={item.href} onClick={() => select(item.href)} aria-current={pathname === "/docs" && item.href === "/docs" ? "page" : undefined} className="rounded-sm text-fog-2 transition-colors hover:text-paper aria-[current=page]:text-paper">
              {item.label}
            </Link>
          ))}
          <a href={PRODUCT.github} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-sm text-fog-2 transition-colors hover:text-paper">
            GitHub <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </nav>
        <Link href="/search" onClick={() => setOpen(false)} className="button-primary ml-auto !rounded-[10px] !px-4 !py-2.5 !text-[12px] md:ml-2">
          Dùng thử <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
        <button ref={menuRef} type="button" onClick={() => setOpen((v) => !v)} className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-fog hover:bg-ink-3 md:hidden" aria-label={open ? "Đóng menu" : "Mở menu"} aria-expanded={open} aria-controls="mobile-navigation">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <nav id="mobile-navigation" aria-label="Điều hướng trên điện thoại" className="site-container rise border-t border-line bg-ink pb-5 pt-3 md:hidden">
          {NAV.map((item) => <Link key={item.label} href={item.href} onClick={() => select(item.href)} className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[14px] text-fog hover:bg-ink-3 hover:text-paper">{item.label}<ArrowUpRight className="size-3.5 text-fog-2" /></Link>)}
          <a href={PRODUCT.github} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[14px] text-fog hover:bg-ink-3">GitHub<ArrowUpRight className="size-3.5 text-fog-2" /></a>
        </nav>
      )}
    </header>
  );
}
