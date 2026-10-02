import Link from "next/link";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/[0.04]"
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-[5px] rounded-full border border-gold/15" />
      <span className="vi-star size-[45%] bg-gold" />
      <span className="absolute -right-[2px] -top-[1px] size-[7px] rounded-full border-2 border-ink bg-gold" />
    </span>
  );
}

export function BrandLogo({ badge = false }: { badge?: boolean }) {
  return (
    <Link href="/" aria-label="VietScope — Trang chủ" className="inline-flex shrink-0 items-center gap-2.5 rounded-lg">
      <LogoMark />
      <span className="text-[19px] font-semibold tracking-[-0.045em] text-paper">VietScope<span className="text-gold">.</span></span>
      {badge && (
        <span className="ml-2 hidden border-l border-line-2 pl-4 text-[9px] font-medium uppercase tracking-[0.16em] text-fog-2 sm:block">
          Vietnam-first
        </span>
      )}
    </Link>
  );
}
