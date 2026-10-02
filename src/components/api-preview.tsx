"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, Terminal } from "lucide-react";

const SAMPLES = {
  cURL: `curl "$VIETSCOPE_BASE_URL/v1/responses" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "vietscope-1",
    "input": "quán cafe đẹp ở Yên Dũng"
  }'`,
  Python: `import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ["VIETSCOPE_BASE_URL"] + "/v1",
    api_key=os.environ["VIETSCOPE_API_KEY"],
)
response = client.responses.create(
    model="vietscope-1",
    input="quán cafe đẹp ở Yên Dũng",
)
print(response.output_text)`,
};

type Language = keyof typeof SAMPLES;

export function ApiPreview() {
  const [language, setLanguage] = useState<Language>("cURL");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetRef.current) clearTimeout(resetRef.current); }, []);

  async function copy() {
    try {
      const code = SAMPLES[language].replaceAll("$VIETSCOPE_BASE_URL", window.location.origin);
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch { setCopyState("error"); }
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => setCopyState("idle"), 2600);
  }

  function tabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next: Language = e.key === "Home" ? "cURL" : e.key === "End" ? "Python" : language === "cURL" ? "Python" : "cURL";
    setLanguage(next);
    document.getElementById(`sample-tab-${next}`)?.focus();
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#0a0e14] shadow-[0_20px_50px_-30px_rgba(0,0,0,0.7)]">
      <div className="flex items-center justify-between border-b border-line/80 px-4 sm:px-5">
        <div role="tablist" aria-label="Ngôn ngữ ví dụ API" className="flex gap-5">
          {(Object.keys(SAMPLES) as Language[]).map((lang) => (
            <button type="button" id={`sample-tab-${lang}`} role="tab" aria-selected={language === lang} aria-controls="api-code-sample" tabIndex={language === lang ? 0 : -1} key={lang} onClick={() => { setLanguage(lang); setCopyState("idle"); }} onKeyDown={tabKey} className={`border-b py-3.5 font-mono text-[11px] transition-colors ${language === lang ? "border-jade text-paper" : "border-transparent text-fog-2 hover:text-fog"}`}>
              {lang}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Sao chép đoạn mã" onClick={copy} className="flex size-8 items-center justify-center rounded-lg text-fog-2 hover:bg-ink-3 hover:text-paper">
          {copyState === "copied" ? <Check className="size-3.5 text-jade" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <div role="tabpanel" id="api-code-sample" aria-labelledby={`sample-tab-${language}`} tabIndex={0} className="min-h-[245px] overflow-x-auto px-5 py-5 outline-offset-[-2px] sm:px-6">
        <div className="mb-5 flex items-center gap-2 font-mono text-[10px] text-fog-2"><span className="rounded bg-jade/10 px-1.5 py-0.5 font-medium text-jade">POST</span>/v1/responses</div>
        <pre className="w-max text-[11.5px] leading-[1.95] text-[#bdc6d4] sm:text-[12px]">
          <code>{SAMPLES[language].split(/("[^"\n]*"|\b(?:curl|from|import|print)\b)/g).map((part, i) => (
            <span key={i} className={part.includes("vietscope-1") ? "text-jade" : part.startsWith('"') ? "text-[#d1be91]" : /^(curl|from|import|print)$/.test(part) ? "text-paper" : undefined}>{part}</span>
          ))}</code>
        </pre>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line/60 px-5 py-3 text-[10px] text-fog-2">
        <span className="flex items-center gap-1.5"><Terminal className="size-3 text-jade/80" aria-hidden="true" />Tương thích OpenAI</span>
        <span role="status" aria-live="polite">{copyState === "copied" ? "Đã sao chép" : copyState === "error" ? "Không thể sao chép. Hãy chọn đoạn mã." : "Text · Nguồn · Địa điểm"}</span>
      </div>
    </div>
  );
}
