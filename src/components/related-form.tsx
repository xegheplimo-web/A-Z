"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function RelatedForm({ questions }: { questions: string[] }) {
  return (
    <ul className="space-y-1">
      {questions.map((q) => (
        <li key={q}>
          <Link
            href={`/search?q=${encodeURIComponent(q)}`}
            className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-fog transition-colors hover:bg-ink-3 hover:text-paper"
          >
            <span className="min-w-0 flex-1 truncate">{q}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-fog-2 transition-all group-hover:translate-x-0.5 group-hover:text-gold" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
