import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleAlert, Loader2 } from "lucide-react";
import { runPipeline } from "@/lib/pipeline";
import { BackendUnavailableError } from "@/core/backend";
import { SearchResults } from "@/components/search-results";
import { SearchBox } from "@/components/search-box";
import { SearchStart } from "@/components/search-start";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `${q} — Tìm kiếm` : "Tìm kiếm thông tin về Việt Nam",
    description: "Hỏi VietScope bằng tiếng Việt. Tìm địa điểm, tra cứu pháp luật và đối chiếu thông tin với nguồn tham khảo rõ ràng.",
  };
}

async function ResultsBody({ q }: { q: string }) {
  let data;
  try {
    data = await runPipeline(q);
  } catch (error) {
    const backendDown = error instanceof BackendUnavailableError;
    return (
      <section role="alert" className="mx-auto max-w-2xl rounded-2xl border border-line bg-ink-2 p-7 sm:p-9">
        <CircleAlert className="size-6 text-gold" strokeWidth={1.5} />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">VietScope chưa thể tìm kiếm lúc này.</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-fog">{backendDown ? "Kết nối đến nguồn tìm kiếm đang gián đoạn." : "Chúng tôi chưa kết nối được với dữ liệu tìm kiếm."} Câu hỏi của bạn vẫn ở trên. Hãy thử lại sau ít phút.</p>
        <Link href={`/search?q=${encodeURIComponent(q)}`} className="button-secondary mt-6">Thử lại<ArrowRight className="size-3.5" /></Link>
        <Link href="/" className="ml-5 text-[12px] text-fog-2 hover:text-paper">Về trang chủ</Link>
      </section>
    );
  }
  return <SearchResults data={data} />;
}

function SearchSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <div className="flex items-center gap-2.5 text-[13px] text-fog"><Loader2 className="size-4 animate-spin text-gold" />Đang tìm thông tin và đối chiếu nguồn…</div>
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4 rounded-2xl border border-line bg-ink-2 p-6"><div className="h-5 w-2/3 animate-pulse rounded-md bg-ink-3" />{[100, 100, 85, 70].map((width, i) => <div key={i} className="h-3.5 animate-pulse rounded-md bg-ink-3" style={{ width: `${width}%` }} />)}<div className="!mt-9 h-32 animate-pulse rounded-xl bg-ink-3/60" /></div>
        <div className="hidden h-64 animate-pulse rounded-2xl border border-line bg-ink-2 lg:block" />
      </div>
    </div>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 500);
  return (
    <main id="main-content" className="site-container min-h-[calc(100dvh-150px)] pb-20 pt-[102px] sm:pt-[112px]">
      {query ? (
        <>
          <div className="mb-5 flex items-center gap-3 text-[11px] text-fog-2"><Link href="/" className="flex items-center gap-1.5 rounded-sm hover:text-paper"><ArrowLeft className="size-3" />Trang chủ</Link><span className="text-line-2">/</span><span>Tìm kiếm</span></div>
          <div className="mb-7 max-w-[850px]"><SearchBox key={query} defaultValue={query} /></div>
          <Suspense key={query} fallback={<SearchSkeleton />}><ResultsBody q={query} /></Suspense>
        </>
      ) : <SearchStart />}
    </main>
  );
}
