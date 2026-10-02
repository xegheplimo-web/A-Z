"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, MoreHorizontal, X } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { PRODUCT } from "@/lib/product-copy";
export { LogoMark } from "./brand-logo";

const NAV = [
  { label: "Tìm kiếm", href: "/#tim-kiem" },
  { label: "Khám phá", href: "/#kham-pha" },
  { label: "API", href: "/#api" },
];

const MORE = [
  { label: "Tài liệu", href: "/docs", external: false },
  { label: "GitHub", href: PRODUCT.github, external: true },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open && !more) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMore(false);
        menuRef.current?.focus();
      }
    };
    const outside = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) { setOpen(false); setMore(false); }
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [open, more]);

  function select(href: string) {
    setOpen(false);
    setMore(false);
    if (href === "/#tim-kiem" && pathname === "/") {
      window.setTimeout(() => document.getElementById("vietscope-query")?.focus({ preventScroll: true }), 100);
    }
  }

  return (
    <header ref={headerRef} className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-ink/90 backdrop-blur-xl">
      <div className="site-container flex h-[62px] items-center justify-between gap-3 md:gap-5">
        <BrandLogo badge />
        <nav aria-label="Điều hướng chính" className="ml-auto hidden items-center gap-7 text-[12.5px] font-medium md:flex">
          {NAV.map((item) => (
            <Link key={item.label} href={item.href} onClick={() => select(item.href)} className="rounded-sm text-fog-2 transition-colors hover:text-paper">
              {item.label}
            </Link>
          ))}
          <span className="relative">
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-label="Thêm liên kết"
              aria-expanded={more}
              aria-haspopup="menu"
              className="flex size-8 items-center justify-center rounded-lg text-fog-2 transition-colors hover:bg-ink-3 hover:text-paper"
            >
              <MoreHorizontal className="size-4.5" aria-hidden="true" />
            </button>
            {more && (
              <div role="menu" aria-label="Liên kết thêm" className="rise absolute right-0 top-full mt-2 w-44 overflow-hidden rounded-xl border border-line bg-ink-2 py-1.5 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.85)]">
                {MORE.map((item) =>
                  item.external ? (
                    <a key={item.label} role="menuitem" href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setMore(false)} className="flex items-center justify-between px-3.5 py-2.5 text-[12.5px] text-fog transition-colors hover:bg-ink-3 hover:text-paper">
                      {item.label}<ArrowUpRight className="size-3.5 text-fog-2" aria-hidden="true" />
                    </a>
                  ) : (
                    <Link key={item.label} role="menuitem" href={item.href} onClick={() => setMore(false)} aria-current={pathname === item.href ? "page" : undefined} className="flex items-center justify-between px-3.5 py-2.5 text-[12.5px] text-fog transition-colors hover:bg-ink-3 hover:text-paper aria-[current=page]:text-paper">
                      {item.label}
                    </Link>
                  )
                )}
              </div>
            )}
          </span>
        </nav>
        <button ref={menuRef} type="button" onClick={() => setOpen((v) => !v)} className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-fog hover:bg-ink-3 md:hidden" aria-label={open ? "Đóng menu" : "Mở menu"} aria-expanded={open} aria-controls="mobile-navigation">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <nav id="mobile-navigation" aria-label="Điều hướng trên điện thoại" className="site-container rise border-t border-line bg-ink pb-5 pt-3 md:hidden">
          {NAV.map((item) => <Link key={item.label} href={item.href} onClick={() => select(item.href)} className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[14px] text-fog hover:bg-ink-3 hover:text-paper">{item.label}<ArrowUpRight className="size-3.5 text-fog-2" /></Link>)}
          <Link href="/docs" onClick={() => setOpen(false)} className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[14px] text-fog hover:bg-ink-3 hover:text-paper">Tài liệu<ArrowUpRight className="size-3.5 text-fog-2" /></Link>
          <a href={PRODUCT.github} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[14px] text-fog hover:bg-ink-3">GitHub<ArrowUpRight className="size-3.5 text-fog-2" /></a>
        </nav>
      )}
    </header>
  );
}
