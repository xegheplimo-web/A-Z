import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT } from "@/lib/product-copy";
import { getLatestEval } from "@/lib/eval";
import { RunEvalButton } from "@/components/run-eval-button";
import {
  ArrowUpRight,
  BookOpenText,
  Boxes,
  BrainCircuit,
  Gauge,
  Landmark,
  MapPin,
  MessageSquareText,
  Radar,
  Search,
  ShieldCheck,
  Cpu,
  Sprout,
  Plug2,
  ScrollText,
  Target,
  ThumbsUp,
  Zap,
} from "lucide-react";

export const metadata: Metadata = {
  title: "API & tài liệu",
  description: PRODUCT.developerDescription,
};

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  {
    method: "POST",
    path: "/v1/responses",
    icon: MessageSquareText,
    title: "OpenAI Responses API (vietscope-1)",
    desc: "client.responses.create(model=\"vietscope-1\", input=...). Trả output_text + annotations url_citation + trường mở rộng vietscope (places, citations có passage/offset, quality).",
    body: `{
  "model": "vietscope-1",
  "input": "Tìm quán cafe đẹp ở Yên Dũng",
  "location": { "lat": 21.215, "lng": 106.215 },
  "stream": false
}`,
  },
  {
    method: "POST",
    path: "/v1/chat/completions",
    icon: MessageSquareText,
    title: "OpenAI-compatible (vietscope-1)",
    desc: "Một model duy nhất cho mọi loại câu hỏi. stream: true để nhận SSE.",
    body: `{
  "model": "vietscope-1",
  "stream": false,
  "messages": [
    { "role": "user", "content": "quán giò chả ngon ở Yên Dũng" }
  ]
}`,
  },
  {
    method: "POST",
    path: "/v1/retrieve",
    icon: BrainCircuit,
    title: "Bộ não tìm kiếm cho AI agents (Hermes)",
    desc: "Một call duy nhất: understand → route → federated search → evidence → quality → coverage.",
    body: `{
  "query": "quán giò chả Yên Dũng",
  "location": null,
  "max_results": 10,
  "evidence": "auto",
  "mode": "auto"
}`,
  },
  {
    method: "POST",
    path: "/v1/search",
    icon: Search,
    title: "Core Search API",
    desc: "Kết quả có cấu trúc: title, url, snippet, source, authority, freshness, location, score. Không cần LLM.",
    body: `{ "query": "giá vàng hôm nay" }`,
  },
  {
    method: "GET",
    path: "/v1/places/search?q=giò chả Yên Dũng",
    icon: MapPin,
    title: "Vietnam Places API",
    desc: "Local search precision-first: exact (verified) tách khỏi web-unverified và related.",
    body: null,
  },
  {
    method: "POST",
    path: "/v1/answer",
    icon: Zap,
    title: "Answer Engine",
    desc: "Search → evidence → synthesis → verify → câu trả lời kèm citations [n].",
    body: `{ "query": "so sánh VinFast VF8 với Hyundai Santa Fe" }`,
  },
  {
    method: "GET",
    path: "/v1/admin/resolve?q=yên dũng",
    icon: Landmark,
    title: "Vietnam Admin Graph",
    desc: "Resolve địa danh hiện tại + lịch sử + sáp nhập + đổi tên → đơn vị hành chính hiện hành.",
    body: null,
  },
  {
    method: "POST",
    path: "/v1/evidence",
    icon: ShieldCheck,
    title: "Evidence API",
    desc: "Passage-level evidence: claim → source → passage → offset ký tự trong nội dung nguồn.",
    body: `{ "query": "hộ kinh doanh doanh thu 1 tỷ hóa đơn máy tính tiền", "max_passages": 6 }`,
  },
  {
    method: "GET",
    path: "/v1/providers",
    icon: Gauge,
    title: "Federation & health",
    desc: "Trạng thái từng lane (canonical places, corpus, admin graph, search-hub, inference engine), quy mô dữ liệu và flywheel.",
    body: null,
  },
  {
    method: "POST",
    path: "/mcp",
    icon: Plug2,
    title: "MCP adapter — MỘT tool cho agent",
    desc: "Hermes/agent không phải gọi search_places → search → read → search lại. Chỉ một tool vietscope_retrieve (JSON-RPC 2.0, streamable HTTP).",
    body: `{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"vietscope_retrieve",
   "arguments":{"query":"quán giò chả ngon ở Yên Dũng"}}}`,
  },
  {
    method: "GET",
    path: "/v1/coverage",
    icon: Sprout,
    title: "Coverage Engine (P5)",
    desc: "Những chỗ dữ liệu Việt Nam còn thiếu, xếp theo số lần người dùng vấp phải, kèm đề xuất lane cần crawl và ứng viên chờ verify.",
    body: null,
  },
  {
    method: "POST",
    path: "/v1/pilot",
    icon: Sprout,
    title: "Khép kín data flywheel",
    desc: "Đường tắt cũ đã đóng: verified:true không phải bằng chứng. Dùng /v1/pilot ingest → review với ≥2 nguồn độc lập và provenance từng trường.",
    body: `{ "action": "review", "outletKey": "<sha256>", "decision": "approve", "note": "Đã đối chiếu nguồn..." }`,
  },
  {
    method: "GET",
    path: "/v1/traces?full=1",
    icon: ScrollText,
    title: "Training traces (§11)",
    desc: "Vết đầy đủ: query → intent → retrieval plan → providers → candidates → reranking → evidence → answer → citations → verification. Dùng dựng VietScope Instruction/Retrieval/Citation Dataset.",
    body: null,
  },
  {
    method: "POST",
    path: "/v1/feedback",
    icon: ThumbsUp,
    title: "Feedback / preference",
    desc: "Nhãn good|bad|mixed trên từng trace — nguyên liệu cho preference/DPO khi fine-tune VietScope-LM.",
    body: `{ "trace_id": "<uuid>", "query": "...", "verdict": "good" }`,
  },
];

const LATENCY_TARGETS = [
  { k: "Cache hit", v: "< 100ms" },
  { k: "Canonical Places", v: "300–500ms" },
  { k: "Raw fast search", v: "1.5–3s" },
  { k: "Local widened", v: "2–4s" },
  { k: "Search + evidence", v: "3–8s" },
  { k: "Normal answer", v: "4–8s" },
  { k: "Deep research", v: "20–60s" },
];

export default async function DocsPage() {
  const latest = await getLatestEval();
  const m = latest.metrics as unknown as Record<string, number>;
  const failures = latest.metrics.failures ?? [];

  return (
    <main id="main-content" className="site-container pb-20 pt-[112px]">
      <header className="relative overflow-hidden rounded-[24px] border border-line bg-ink-2 px-6 py-9 sm:p-11">
        <span className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.15em] text-jade"><span className="size-1.5 rounded-full bg-jade" />VietScope API · Cho nhà phát triển</span>
        <h1 className="mt-5 max-w-[750px] text-balance text-[30px] font-semibold leading-[1.25] tracking-[-0.04em] sm:text-[42px]">Hiểu Việt Nam.<br /><span className="text-fog-2">Tích hợp vào sản phẩm của bạn.</span></h1>
        <p className="mt-5 max-w-[665px] text-[14px] leading-[1.9] text-fog">{PRODUCT.developerDescription} Gọi <code className="rounded-md bg-jade/10 px-1.5 py-0.5 text-[12px] text-jade">vietscope-1</code> để nhận câu trả lời, nguồn tham khảo và dữ liệu có cấu trúc — mà không cần tự chọn công cụ tìm kiếm bên dưới.</p>
        <div className="mt-7 flex flex-wrap gap-3"><a href="#bat-dau" className="button-primary">Bắt đầu tích hợp<ArrowUpRight className="size-3.5" /></a><Link href="/search" className="button-secondary">Dùng thử tìm kiếm<Search className="size-3.5" /></Link></div>
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-5 text-[10px] text-fog-2"><span>OpenAI-compatible</span><span>API &amp; MCP</span><span>Câu trả lời có dẫn nguồn</span><span className="font-mono text-jade/80">model = vietscope-1</span></div>
      </header>
      <nav aria-label="Mục lục tài liệu" className="mt-7 flex flex-wrap gap-2 text-[11px] text-fog">
        {[{ label: "Bắt đầu nhanh", href: "#bat-dau" }, { label: "API reference", href: "#endpoints" }, { label: "Kiến trúc", href: "#kien-truc" }, { label: "Chất lượng & giới hạn", href: "#chat-luong" }].map((item) => <a key={item.href} href={item.href} className="rounded-full border border-line px-3.5 py-2 transition-colors hover:border-gold/40 hover:text-paper">{item.label}</a>)}
      </nav>

      <section className="mt-7 flex flex-col justify-between gap-4 rounded-2xl border border-jade/25 bg-jade/[0.035] p-6 sm:flex-row sm:items-center">
        <div><span className="text-[10px] uppercase tracking-wider text-jade">Execution · Yên Dũng pilot</span><h2 className="mt-2 text-[16px] font-medium">LOCAL-1, nguồn dữ liệu và coverage jobs</h2><p className="mt-2 text-[12px] leading-relaxed text-fog-2">Báo cáo 5 query trước/sau, observations có provenance và luồng kiểm chứng tách biệt với tìm kiếm.</p></div>
        <Link href="/data/pilot" className="button-secondary shrink-0">Mở pilot<ArrowUpRight className="size-3.5" /></Link>
      </section>

      {/* quick start */}
      <section id="bat-dau" className="mt-12 scroll-mt-28">
        <SectionTitle icon={<Zap className="size-4" />} title="Bắt đầu với một câu hỏi" sub="Dùng Responses API hoặc Chat Completions với model vietscope-1. Thiết lập URL dịch vụ và khóa API của môi trường bạn sử dụng." />
        <CodeBlock lang="bash">{`curl -X POST $BASE/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer vs_key_..." \\
  -d '{
    "model": "vietscope-1",
    "messages": [{ "role": "user", "content": "cửa hàng gần đây bán máy khoan" }]
  }'`}</CodeBlock>
        <div className="mt-4" />
        <CodeBlock lang="python · openai SDK">{`from openai import OpenAI

client = OpenAI(base_url="$BASE/v1", api_key="vs_key_...")

resp = client.responses.create(
    model="vietscope-1",
    input="Tìm quán cafe đẹp ở Yên Dũng",
)
print(resp.output_text)          # câu trả lời có [n]
print(resp.model_extra["vietscope"]["places"]["exact"])   # places có cấu trúc`}</CodeBlock>
      </section>

      {/* endpoints */}
      <section id="endpoints" className="mt-14 scroll-mt-28">
        <SectionTitle icon={<Boxes className="size-4" />} title="API reference" sub="Từ tìm kiếm có cấu trúc đến câu trả lời kèm dẫn nguồn. Chọn endpoint phù hợp với ứng dụng của bạn." />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ENDPOINTS.map((e) => (
            <div key={e.path} className="glass flex min-w-0 flex-col rounded-2xl p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line-2 bg-ink text-gold">
                  <e.icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${e.method === "GET" ? "bg-jade/15 text-jade" : "bg-flame/15 text-flame-2"}`}>
                      {e.method}
                    </span>
                    <code className="truncate font-mono text-[12.5px] text-paper">{e.path}</code>
                  </div>
                  <div className="mt-0.5 text-[13px] font-semibold">{e.title}</div>
                </div>
              </div>
              <p className="mt-2.5 break-words text-[12.5px] leading-relaxed text-fog">{e.desc}</p>
              {e.body && (
                <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-ink p-3 font-mono text-[11px] leading-relaxed text-fog">
                  {e.body}
                </pre>
              )}
              {!e.body && (
                <a
                  href={e.path.split("?")[0] + "?" + encodeURI(e.path.split("?")[1] ?? "")}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-gold hover:underline"
                >
                  Thử ngay <ArrowUpRight className="size-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* một retrieval brain */}
      <section id="kien-truc" className="mt-16 scroll-mt-28">
        <SectionTitle
          icon={<Boxes className="size-4" />}
          title="Một retrieval brain — facade mỏng ở trên"
          sub="Không để Next.js và search-router thành hai search engine song song. Facade chỉ gọi MỘT contract; engine được chọn bằng RETRIEVAL_BACKEND và chỉ engine đó được nạp."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="glass min-w-0 rounded-2xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">Facade — repo này</div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-fog">
              <code>vietscope-1</code> · OpenAI API (<code>/v1/responses</code>, <code>/v1/chat/completions</code>) · MCP một tool · UI · API key (SHA-256 trong Postgres) ·
              rate limit/quota/usage dùng chung giữa instance · synthesis (InferenceGateway) · verification (claim → passage → offset). <b className="text-paper">Không chứa logic retrieval.</b>
            </p>
          </div>
          <div className="glass min-w-0 rounded-2xl p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-jade">Retrieval brain — một và chỉ một</div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-fog">
              <code>RETRIEVAL_BACKEND=search-router</code>: production (SearXNG, OpenSearch, Qdrant, PostGIS) qua <code>POST /v1/retrieve</code>.{" "}
              <code>embedded</code>: engine tham chiếu cho dev/offline và fixture benchmark. Contract v1: <code>docs/retrieve.contract.md</code>.
            </p>
          </div>
        </div>
        <CodeBlock lang="bash · kiểm tra kiến trúc">{`node scripts/check-boundaries.mjs      # facade không import engine, không đọc bảng của brain
npx tsx scripts/conformance.ts          # contract · một-brain · parity VN_GOLDEN giữa hai backend
npx tsx scripts/test-auth.ts            # key hash · rate limit/quota/usage · MCP stateless
npx tsx scripts/bench-scale.ts          # 150k places + 60k docs: latency, index, chất lượng dưới nhiễu`}</CodeBlock>
        <p className="mt-3 text-[11.5px] leading-relaxed text-fog-2">
          Hiện search-router chưa có <code>/v1/retrieve</code> — adapter trả 503 rõ ràng cho đến khi port xong (<code>docs/PORTING-TO-SEARCH-ROUTER.md</code>).
          Admin tạo key: <code>POST /v1/admin/keys</code> với <code>VIETSCOPE_ADMIN_KEY</code>.
        </p>
      </section>

      {/* inference engine */}
      <section className="mt-16">
        <SectionTitle
          icon={<Cpu className="size-4" />}
          title="Inference Engine — LLM là bộ phận thay thế được"
          sub="vietscope-1 = Retrieval Engine (dữ liệu VietScope, deterministic) + Inference Engine (LLM). Đổi Qwen → GLM → model khác chỉ bằng biến môi trường; API, routing, ranking, verification không đổi."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[
            {
              k: "A",
              t: "API ngoài — khuyến nghị hiện tại",
              d: "Qwen3.8-Flash-Next (hoặc model lớn khác) qua endpoint OpenAI-compatible. Không chiếm GPU nhà, không nạp model 60–300 GB, concurrency tốt, đổi model bất kỳ lúc nào.",
              env: `LLM_BASE_URL=https://<provider>/v1
LLM_API_KEY=sk-...
LLM_MODEL=qwen3.8-flash-next
LLM_SYNTH_MODEL=        # trống = dùng LLM_MODEL
LLM_PLANNER_MODEL=      # có thể dùng model rẻ hơn`,
              tone: "jade",
            },
            {
              k: "B",
              t: "Local trên RTX 3090 (24 GB)",
              d: "Không dùng Flash-Next full-size. Chọn model 20–35B quant Q4/Q5 qua llama-server; chừa VRAM cho embedding, reranker, Docker.",
              env: `# llama-server --model <20-35B>.gguf --port 8080 -ngl 99
LLM_BASE_URL=http://127.0.0.1:8080/v1
LLM_MODEL=local
LLM_TIMEOUT_MS=30000`,
              tone: "gold",
            },
            {
              k: "C",
              t: "Máy lớn: Flash-Next + MTP",
              d: "Khi có RTX PRO 6000 96 GB / multi-H200: chạy model chính + MTP draft head để speculative decoding. mtp-*.gguf CHỈ là bộ tăng tốc, KHÔNG phải model chính.",
              env: `# llama.cpp (tham khảo model card; kiểm tra với bản llama.cpp của bạn)
llama-server \\
  --model Qwen3.8-Flash-Next-<quant>.gguf \\
  --model-draft mtp-Qwen3.8-Flash-Next-BF16.gguf \\
  --spec-type draft-mtp --spec-draft-n-max 2
# hoặc vLLM recipe chính thức (MTP + prefix caching + tool calling)
LLM_BASE_URL=http://vllm:8000/v1`,
              tone: "flame",
            },
          ].map((p) => (
            <div key={p.k} className="glass flex min-w-0 flex-col rounded-2xl p-5">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex size-8 items-center justify-center rounded-lg border text-[13px] font-extrabold ${
                    p.tone === "jade" ? "border-jade/40 bg-jade/12 text-jade" : p.tone === "gold" ? "border-gold/40 bg-gold/12 text-gold" : "border-flame/40 bg-flame/12 text-flame-2"
                  }`}
                >
                  {p.k}
                </span>
                <div className="text-[14px] font-bold">{p.t}</div>
              </div>
              <p className="mt-2.5 break-words text-[12.5px] leading-relaxed text-fog">{p.d}</p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-ink p-3 font-mono text-[10.5px] leading-relaxed text-fog">{p.env}</pre>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { t: "Gateway duy nhất", d: "Timeout & retry theo budget (FAST: không retry, ≤4s), circuit breaker (mở 60s sau 3 lỗi), health probe GET /models, streaming SSE." },
            { t: "Vai trò → model", d: "LLM_MODEL mặc định; override LLM_PLANNER_MODEL · LLM_SYNTH_MODEL · LLM_VERIFY_MODEL · LLM_EXTRACT_MODEL — cùng tên biến với search-router." },
            { t: "Không mất chức năng khi LLM chết", d: "Lỗi/timeout/breaker → synthesizer extractive deterministic; verifier vẫn chạy; claim LLM bịa bị gắn cờ (đã kiểm thử bằng mock)." },
          ].map((x) => (
            <div key={x.t} className="rounded-xl border border-line bg-ink-2/60 px-4 py-3">
              <div className="text-[12.5px] font-bold text-paper">{x.t}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-fog">{x.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-fog-2">
          Kiểm thử tích hợp không cần GPU/API key: <code>npx tsx scripts/smoke-upstreams.ts</code> (mock LLM + Search Hub: citation parse, verifier, retry/timeout/breaker, widening, RRF, flywheel, streaming).
        </p>
      </section>

      {/* benchmark */}
      <section id="chat-luong" className="mt-16 scroll-mt-28">
        <SectionTitle
          icon={<Target className="size-4" />}
          title="Chất lượng được đo, không chỉ hứa hẹn"
          sub={`${latest.name} · ${latest.queryCount} câu hỏi · đo thật qua cùng pipeline với production — chất lượng không đo bằng cảm giác`}
        />
        <div className="mb-4">
          <RunEvalButton />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricGroup
            title="Understanding"
            items={[
              { k: "intent accuracy", v: m.intent_accuracy, pct: true },
              { k: "specialty accuracy", v: m.specialty_accuracy, pct: true },
              { k: "geo resolution (địa danh cũ→mới)", v: m.geo_resolution_accuracy, pct: true },
              { k: "budget routing", v: m.budget_accuracy, pct: true },
            ]}
          />
          <MetricGroup
            title="Retrieval"
            items={[
              { k: "Recall@8", v: m["recall@8"], pct: true },
              { k: "nDCG@10", v: m["ndcg@10"], pct: true },
              { k: "MRR", v: m.mrr, pct: true },
              { k: "Precision@10", v: m["precision@10"], pct: true },
            ]}
          />
          <MetricGroup
            title="Local Search"
            items={[
              { k: "exact-place precision", v: m.exact_place_precision, pct: true },
              { k: "specialty precision", v: m.specialty_precision, pct: true },
              { k: "outside-area rate", v: m.outside_area_rate, pct: true, invert: true },
              { k: "honest “chưa đủ bằng chứng”", v: m.honest_no_exact_rate, pct: true },
              { k: "zero-result rate", v: m.zero_result_rate, pct: true, invert: true },
            ]}
          />
          <MetricGroup
            title="Answer & Citations"
            items={[
              { k: "citation precision", v: m.citation_precision, pct: true },
              { k: "citation coverage", v: m.citation_coverage, pct: true },
              { k: "unsupported claim", v: m.unsupported_claim_rate, pct: true, invert: true },
              { k: "P50 / P95", v: m.p50_ms ? `${m.p50_ms} / ${m.p95_ms}ms` : "–" },
            ]}
          />
        </div>
        {failures.length > 0 && (
          <details className="mt-4 rounded-2xl border border-flame/25 bg-flame/6 p-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-flame-2">
              {failures.length} kiểm tra chưa đạt — minh bạch, không giấu lỗi
            </summary>
            <ul className="mt-3 space-y-1.5 text-[12px] text-fog">
              {failures.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-flame-2">{f.id}</span>
                  <span>
                    <span className="text-paper">“{f.query}”</span> — {f.reason}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-4 text-[12px] leading-relaxed text-fog-2">
          Bộ golden sẽ mở rộng 50 → 300 → 1.000+ câu: có dấu, không dấu, typo, slang, địa danh cũ/mới,
          pháp luật, tin nóng, local obscure, ambiguous, SEO spam. Đây là “bài thi” của VietScope.
        </p>
      </section>

      {/* latency */}
      <section className="mt-16">
        <SectionTitle icon={<Gauge className="size-4" />} title="Mục tiêu hiệu năng" sub="Target — không phải SLA hiện tại; query đơn giản không được mất 40–50 giây" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {LATENCY_TARGETS.map((x) => (
            <div key={x.k} className="rounded-xl border border-line bg-ink-2 px-3 py-3 text-center">
              <div className="num-tabular text-[15px] font-bold text-paper">{x.v}</div>
              <div className="mt-1 text-[10.5px] text-fog-2">{x.k}</div>
            </div>
          ))}
        </div>
      </section>

      {/* principles */}
      <section className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { icon: ShieldCheck, t: "LLM không phải Search Engine", d: "Routing, expansion, dedup, geocoding, ranking: deterministic. LLM chỉ làm synthesis & conflict reasoning." },
          { icon: ShieldCheck, t: "Precision trước lấp đầy", d: "«Chưa tìm thấy địa điểm đủ bằng chứng» tốt hơn là đổ 20 kết quả generic giả làm exact match." },
          { icon: ShieldCheck, t: "Dữ liệu VN là hào phòng thủ", d: "Admin Graph · Places Graph · Business Graph · Legal Corpus · Search Benchmark — khó sao chép nhất." },
        ].map((x) => (
          <div key={x.t} className="glass min-w-0 rounded-2xl p-5">
            <x.icon className="size-5 text-jade" />
            <div className="mt-3 text-[14.5px] font-bold">{x.t}</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-fog">{x.d}</p>
          </div>
        ))}
      </section>

      <div className="mt-14 rounded-2xl border border-gold/25 bg-gold/6 p-6 text-center">
        <p className="text-[14px] leading-relaxed text-fog">
          <span className="font-semibold text-paper">Roadmap:</span> LOCAL-1 (hiện tại) → /v1/retrieve →
          MCP adapter → PlaceCandidate → Coverage Engine → federation → Evidence → VN corpus →
          Answer Engine → OpenAI-compatible → <span className="text-gold">Billing/API keys → Production scale.</span>
        </p>
        <Link
          href="/"
          className="button-primary mt-5"
        >
          Thử tìm kiếm ngay <ArrowUpRight className="size-4" />
        </Link>
      </div>
    </main>
  );
}

function SectionTitle({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
        <span className="flex size-8 items-center justify-center rounded-lg border border-line-2 bg-ink-2 text-gold">{icon}</span>
        {title}
      </h2>
      {sub && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-fog">{sub}</p>}
    </div>
  );
}

function CodeBlock({ children, lang }: { children: string; lang: string }) {
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-[11px] text-fog-2">
        <span className="size-2.5 rounded-full bg-flame/70" />
        <span className="size-2.5 rounded-full bg-gold/70" />
        <span className="size-2.5 rounded-full bg-jade/70" />
        <span className="ml-2">{lang}</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed text-fog">{children}</pre>
    </div>
  );
}

function MetricGroup({
  title,
  items,
}: {
  title: string;
  items: { k: string; v: number | string | undefined; pct?: boolean; invert?: boolean }[];
}) {
  return (
    <div className="rounded-2xl border border-line bg-ink-2/60 p-4">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-gold">{title}</div>
      <div className="space-y-2.5">
        {items.map((it) => {
          const num = typeof it.v === "number" ? it.v : null;
          const pctVal = num != null && it.pct ? Math.round(num * 100) : null;
          const label = num != null ? (it.pct ? `${pctVal}%` : it.v) : (it.v ?? "–");
          const good = it.invert ? pctVal != null && pctVal <= 10 : pctVal != null && pctVal >= 80;
          return (
            <div key={it.k} className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-fog">{it.k}</span>
              <div className="flex items-center gap-2">
                {pctVal != null && (
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink">
                    <div
                      className={`h-full rounded-full ${good ? "bg-jade" : it.invert ? "bg-flame" : "bg-gold"}`}
                      style={{ width: `${Math.min(100, pctVal)}%` }}
                    />
                  </div>
                )}
                <span className={`num-tabular w-16 text-right text-[12.5px] font-bold ${good ? "text-jade" : "text-paper"}`}>
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
