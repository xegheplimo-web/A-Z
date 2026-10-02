"use client";

import { useRouter } from "next/navigation";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useTransition, type FormEvent } from "react";
import { ArrowUp, Loader2, Search, X } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import clsx from "clsx";
import { SEARCH_PLACEHOLDERS } from "@/lib/product-copy";

export interface SearchBoxHandle {
  fill: (query: string) => void;
  focus: () => void;
}

interface SearchBoxProps {
  big?: boolean;
  autoFocus?: boolean;
  defaultValue?: string;
  id?: string;
  inputId?: string;
}

export const SearchBox = forwardRef<SearchBoxHandle, SearchBoxProps>(function SearchBox(
  { big = false, autoFocus = false, defaultValue = "", id, inputId = "vietscope-query" }, ref
) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [phIdx, setPhIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  useImperativeHandle(ref, () => ({
    fill(query) {
      setValue(query);
      setAnnouncement(`Đã điền câu hỏi: ${query}. Nhấn Enter để tìm kiếm.`);
      inputRef.current?.focus({ preventScroll: true });
    },
    focus() { inputRef.current?.focus({ preventScroll: true }); },
  }), []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    if (reduceMotion || focused || value) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setPhIdx((i) => (i + 1) % SEARCH_PLACEHOLDERS.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [focused, value, reduceMotion]);

  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      inputRef.current?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      inputRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [reduceMotion]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = value.trim();
    if (!q || pending) return;
    setAnnouncement("VietScope đang tìm kiếm và đối chiếu nguồn.");
    startTransition(() => router.push(`/search?q=${encodeURIComponent(q)}`));
  }

  return (
    <form id={id} role="search" aria-label="Tìm kiếm VietScope" action="/search" method="GET" onSubmit={submit} className="w-full scroll-mt-32">
      <div className={clsx(
        "relative flex w-full items-center gap-3 border bg-[#11151e] transition-[border-color,box-shadow] duration-200",
        focused ? "border-gold/55 shadow-[0_0_0_4px_rgba(245,185,66,0.055)]" : "border-[#353c47] shadow-[0_12px_48px_-22px_rgba(0,0,0,0.9)] hover:border-[#535c6c]",
        big ? "h-[72px] rounded-[22px] pl-5 pr-3 sm:pl-6" : "h-[60px] rounded-[18px] pl-4 pr-2.5"
      )}>
        <Search className={clsx("shrink-0 text-fog-2", big ? "size-5" : "size-[18px]")} strokeWidth={1.65} aria-hidden="true" />
        <label htmlFor={inputId} className="sr-only">Hỏi VietScope</label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          name="q"
          value={value}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={SEARCH_PLACEHOLDERS[phIdx]}
          className={clsx("min-w-0 flex-1 bg-transparent py-4 text-[16px] text-paper outline-none placeholder:text-fog-2/85", big && "sm:text-[17px]")}
        />
        {value && <button type="button" aria-label="Xóa câu hỏi" onClick={() => { setValue(""); inputRef.current?.focus(); }} className="flex size-8 shrink-0 items-center justify-center rounded-full text-fog-2 hover:bg-ink-3 hover:text-paper"><X className="size-3.5" /></button>}

        <button type="submit" aria-label="Tìm kiếm" disabled={pending || !value.trim()} aria-busy={pending} className={clsx(
          "flex shrink-0 items-center justify-center rounded-[14px] bg-gold text-[#241c0c] transition-colors hover:bg-[#ffd078] disabled:cursor-default disabled:bg-gold/70 disabled:text-[#241c0c]/80",
          big ? "size-[46px]" : "size-[42px]"
        )}>
          {pending ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" strokeWidth={2} />}
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    </form>
  );
});
