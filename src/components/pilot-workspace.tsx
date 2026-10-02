"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowLeft, ArrowUpRight, Check, Database, FileCheck2, Layers3, Loader2, LockKeyhole, MapPin, RefreshCw, Upload } from "lucide-react";
import type { PilotCommand, PilotSnapshot } from "@/core/pilot";
import { PILOT_LABELS, type PilotCategory } from "@/core/pilot";

interface Report {
  created_at: string;
  fixture_only: boolean;
  queries: { query: string; specialty: string | null; exact: { name: string }[]; p95_ms: number; checks: Record<string, boolean> }[];
}

export function PilotWorkspace({ baseline, current }: { baseline: Report; current: Report }) {
  const [tab, setTab] = useState<"regressions" | "coverage" | "observations">("regressions");
  const [snapshot, setSnapshot] = useState<PilotSnapshot | null>(null);
  const [key, setKey] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [batch, setBatch] = useState("");
  const [note, setNote] = useState("");
  const [jobId, setJobId] = useState<string | undefined>();
  const [leaseToken, setLeaseToken] = useState<string | undefined>();
  const [backendNote, setBackendNote] = useState("");

  const load = useCallback(async (token = "") => {
    try {
      const response = await fetch("/v1/pilot", { cache: "no-store", headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Không đọc được dữ liệu pilot.");
      const data = await response.json();
      if (data.available === false) { setBackendNote(data.note); return; }
      setSnapshot(data); setAuthorized(!!data.capabilities?.write);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kết nối thất bại.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function unlock() {
    setBusy(true); setError("");
    try { await load(key); } catch(e) { setError(e instanceof Error ? e.message : "Kết nối thất bại."); }
    finally { setBusy(false); }
  }
  async function command(body: PilotCommand) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/v1/pilot", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Thao tác thất bại.");
      setNotice(body.action === "review" ? data.result.fixture ? "Đã ghi canonical fixture; không dùng làm địa điểm xác minh trong tìm kiếm." : "Đã lưu kết quả đối chiếu và nguồn gốc từng trường." : body.action === "claim" ? "Đã nhận job trong 10 phút. Import batch cùng địa bàn/category để hoàn tất." : body.action === "plan" ? `Đã xét ${data.result.planned} ô độ phủ có nhu cầu.` : `Đã lưu ${data.result.inserted} observations, bỏ qua ${data.result.duplicates} bản lặp.`);
      if (body.action === "claim") { setJobId(body.jobId); setLeaseToken(data.result.leaseToken); }
      if (body.action === "ingest") { setBatch(""); setJobId(undefined); setLeaseToken(undefined); }
      await load(key);
    } catch(e) { setError(e instanceof Error ? e.message : "Thao tác thất bại."); }
    finally { setBusy(false); }
  }
  function importBatch() {
    try {
      const observations = batch.trim().startsWith("[") ? JSON.parse(batch) : batch.trim().split(/\n+/).map(line=>JSON.parse(line));
      if (!Array.isArray(observations)) throw new Error("not array");
      void command({ action: "ingest", observations, jobId, leaseToken });
    } catch { setError("Cần JSON array hoặc JSONL hợp lệ. Batch chưa được gửi."); }
  }
  function example() {
    setBatch(JSON.stringify([{
      sourceType: "website", sourceId: "fixture-outlet-tan-an", sourceUrl: "https://merchant.example/outlet-tan-an", observedAt: new Date().toISOString(),
      name: "Cửa hàng sắt — MẪU KIỂM THỬ", address: "10 Đường mẫu, Tân An", communeId: "x_tan_an", provinceId: "t_bac_ninh", category: "vlxd", specialties: ["sắt thép"], fixture: true,
    }], null, 2));
  }
  const success = current.queries.reduce((n,q)=>n+Object.values(q.checks).filter(Boolean).length,0);
  const total = current.queries.reduce((n,q)=>n+Object.keys(q.checks).length,0);
  return (
    <main id="main-content" className="site-container min-h-dvh pb-20 pt-28">
      <Link href="/docs" className="mb-7 flex w-fit items-center gap-2 text-[12px] text-fog-2 hover:text-paper"><ArrowLeft className="size-3.5" />Tài liệu & vận hành</Link>
      <header className="flex flex-col justify-between gap-5 border-b border-line pb-8 sm:flex-row sm:items-end">
        <div><div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[.15em] text-jade"><MapPin className="size-3.5" />Yên Dũng · Data pilot</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Tìm đúng hơn. Dữ liệu rõ nguồn hơn.</h1><p className="mt-4 max-w-2xl text-sm leading-relaxed text-fog-2">LOCAL-1 → observations → đối chiếu → địa điểm canonical. Không thêm retrieval brain; workspace chỉ làm việc với backend đã chọn.</p></div>
        <span className="w-fit shrink-0 rounded-full border border-line px-3 py-1.5 font-mono text-[11px] text-fog">{snapshot?.backend ?? (backendNote ? "backend chưa hỗ trợ pilot" : "đang kết nối")}</span>
      </header>
      <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">{[
        { label: "Kiểm tra LOCAL-1", value: `${success}/${total}`, icon: Activity },
        { label: "Observations", value: snapshot?.summary.observations ?? "—", icon: Database },
        { label: "Pháp nhân / Outlet", value: snapshot ? `${snapshot.summary.legalEntities} / ${snapshot.summary.outlets}` : "—", icon: Layers3 },
        { label: "Coverage jobs", value: snapshot?.summary.jobs ?? "—", icon: FileCheck2 },
      ].map(s=><div key={s.label} className="surface-card rounded-2xl p-5"><s.icon className="mb-4 size-4 text-gold" /><div className="num-tabular text-2xl font-semibold">{s.value}</div><p className="mt-1 text-[11px] text-fog-2">{s.label}</p></div>)}</div>
      <div className="mt-7 flex flex-col justify-between gap-4 border-b border-line pb-4 md:flex-row md:items-center">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Dữ liệu pilot">{([{id:"regressions",name:"LOCAL-1 · Trước / sau"},{id:"coverage",name:"Coverage jobs"},{id:"observations",name:"Nguồn & xác minh"}] as const).map(t=><button key={t.id} type="button" role="tab" aria-selected={tab===t.id} onClick={()=>setTab(t.id)} className={`rounded-lg px-3 py-2.5 text-[12px] ${tab===t.id ? "bg-gold/10 text-gold":"text-fog-2 hover:text-paper"}`}>{t.name}</button>)}</div>
        <button type="button" disabled={busy} onClick={()=>{load(key).catch(e=>setError(e.message));}} className="flex w-fit items-center gap-2 text-[11px] text-fog-2 hover:text-paper"><RefreshCw className="size-3.5" />Làm mới</button>
      </div>
      {backendNote && <p className="mt-6 rounded-xl border border-gold/25 p-4 text-sm text-gold">{backendNote}</p>}
      <div className="mt-5" role="status" aria-live="polite">{error && <p className="rounded-xl border border-flame/30 bg-flame/5 p-4 text-[12px] text-flame-2">{error}</p>}{notice && <p className="rounded-xl border border-jade/25 bg-jade/5 p-4 text-[12px] text-jade">{notice}</p>}</div>
      {tab === "regressions" && <section className="mt-6 space-y-4">
        <p className="mb-5 max-w-3xl text-[12px] leading-relaxed text-fog-2">Đo cùng 5 câu hỏi do bạn cung cấp trên dữ liệu tham chiếu. Baseline là kết quả thật trước khi sửa, không phải kết quả dựng để so sánh. Chưa đại diện chất lượng/P95 của stack production.</p>
        {current.queries.map((q,i)=><article key={q.query} className="rounded-2xl border border-line bg-ink-2 p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-[15px] font-medium">{q.query}</h2><a className="flex items-center gap-1.5 text-[11px] text-gold" href={`/search?q=${encodeURIComponent(q.query)}`}>Thử tìm kiếm<ArrowUpRight className="size-3" /></a></div><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-line p-4"><span className="text-[10px] uppercase tracking-wider text-fog-2">Trước · {baseline.queries[i]?.exact.length} exact</span><p className="mt-2 text-[12px] leading-relaxed text-fog-2">{baseline.queries[i]?.exact.slice(0,5).map(p=>p.name).join(" · ") || "Không có exact"}{(baseline.queries[i]?.exact.length ?? 0)>5 && " …"}</p><span className="mt-3 block text-[10px] text-fog-2">P95 {baseline.queries[i]?.p95_ms} ms · fixture</span></div><div className="rounded-xl border border-jade/20 bg-jade/[0.025] p-4"><span className="text-[10px] uppercase tracking-wider text-jade">Sau · {q.exact.length} exact</span><p className="mt-2 text-[12px] leading-relaxed text-fog">{q.exact.map(p=>p.name).join(" · ") || "0 exact — chưa có địa điểm đủ bằng chứng trong địa bàn này."}</p><span className="mt-3 block text-[10px] text-fog-2">P95 {q.p95_ms} ms · {q.specialty}</span></div></div><div className="mt-4 flex flex-wrap gap-4 text-[10px] text-fog-2">{Object.entries(q.checks).map(([k,v])=><span key={k} className="flex items-center gap-1"><Check className={`size-3 ${v?"text-jade":"text-flame-2"}`} />{k}</span>)}</div></article>)}
      </section>}
      {tab !== "regressions" && <section className="mt-6">
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-line bg-ink-2 p-5 sm:flex-row sm:items-center"><LockKeyhole className="size-5 shrink-0 text-gold" /><div className="flex-1"><p className="text-[13px] font-medium">{authorized ? "Đã xác thực quyền quản trị" : "Chỉ quản trị viên được ghi và xem nguồn chi tiết"}</p><p className="mt-1 text-[11px] text-fog-2">Khóa chỉ giữ trong bộ nhớ của trang, không lưu vào trình duyệt. {authorized ? "" : "Đặt VIETSCOPE_ADMIN_KEY phía server trước khi sử dụng."}</p></div><div className="flex min-w-0 gap-2"><label className="sr-only" htmlFor="pilot-key">Khóa quản trị</label><input id="pilot-key" type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="Khóa quản trị" className="min-w-0 rounded-lg border border-line-2 bg-ink px-3 py-2 text-[12px]" /><button type="button" onClick={unlock} disabled={busy||!key} className="button-secondary !px-3 !py-2 !text-[11px]">{busy?<Loader2 className="size-3.5 animate-spin"/>:"Kết nối"}</button></div></div>
        {tab === "coverage" && <><div className="mb-5 flex flex-wrap items-center justify-between gap-4"><p className="max-w-xl text-[12px] leading-relaxed text-fog-2">Ưu tiên = nhu cầu × thiếu dữ liệu × độ cũ × giá trị lĩnh vực × thiếu độ tin cậy. Chưa xác định H3 thì giữ trống, không bịa cell. Job không tự crawl Internet.</p><button type="button" onClick={()=>command({action:"plan"})} disabled={!authorized||busy} className="button-primary disabled:opacity-40">Lập jobs từ nhu cầu</button></div><div className="overflow-x-auto rounded-2xl border border-line"><table className="w-full min-w-[680px] text-left text-[12px]"><thead className="bg-ink-3/50 text-[10px] uppercase tracking-wider text-fog-2"><tr>{["Địa bàn","Lĩnh vực","Nhu cầu","Canonical","Ưu tiên","Trạng thái",""].map((v,i)=><th key={i} className="p-4 font-medium">{v}</th>)}</tr></thead><tbody>{snapshot?.jobs.map(j=><tr key={j.id} className="border-t border-line"><td className="p-4 text-fog">{j.region}<span className="mt-1 block text-[9px] text-fog-2">H3: {j.h3Cell??"chưa xác định"}</span></td><td className="p-4">{PILOT_LABELS[j.category as PilotCategory]??j.category}</td><td className="p-4">{j.demand}</td><td className="p-4">{j.canonicalCount}</td><td className="p-4 text-gold">{j.priority.toFixed(1)}</td><td className="p-4 text-fog-2">{j.status}</td><td className="p-4"><button type="button" disabled={!authorized||busy||j.status!=="queued"} onClick={()=>command({action:"claim",jobId:j.id})} className="text-jade disabled:text-fog-2/40">Nhận job</button></td></tr>)}</tbody></table>{!snapshot?.jobs.length && <p className="p-8 text-center text-[12px] text-fog-2">Chưa có job. Các lượt tìm kiếm trong pilot tạo tín hiệu nhu cầu; quản trị viên lập jobs khi cần.</p>}</div></>}
        {tab === "observations" && <><div className="rounded-2xl border border-line bg-ink-2 p-5"><div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><Upload className="size-4 text-jade"/>Nhập observations · JSON / JSONL</h2><button type="button" onClick={example} className="text-[11px] text-gold">Dùng cấu trúc mẫu</button></div><textarea value={batch} onChange={e=>setBatch(e.target.value)} aria-label="Batch observations" spellCheck={false} rows={9} placeholder="Dán dữ liệu đã thu thập hợp lệ, kèm sourceUrl và observedAt…" className="w-full rounded-xl border border-line-2 bg-ink p-4 font-mono text-[11px] leading-relaxed text-fog outline-none focus:border-gold/50"/><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-fog-2">{jobId?`Đang gắn với job ${jobId.slice(0,8)}…` : "Mỗi batch tối đa 200 observations. Chưa xác minh thì không xuất hiện trong exact."}</p><button type="button" disabled={!authorized||busy||!batch.trim()} onClick={importBatch} className="button-primary disabled:opacity-40">Lưu vào staging</button></div></div><label className="mt-7 block text-[12px] text-fog">Ghi chú đối chiếu (bắt buộc khi duyệt/từ chối)<textarea rows={2} value={note} onChange={e=>setNote(e.target.value)} className="mt-2 w-full rounded-xl border border-line-2 bg-ink-2 px-4 py-3 text-[12px]" placeholder="Đã kiểm tra những nguồn nào, tại sao chấp nhận hoặc từ chối?" /></label><div className="mt-5 space-y-3">{snapshot?.candidates.map(c=><article key={c.key} className="rounded-2xl border border-line bg-ink-2 p-5"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-sm font-medium">{c.name}</h3><p className="mt-1 text-[11px] text-fog-2">{c.address} · {c.sources} nhóm nguồn · {c.status}</p></div>{c.fixture&&<span className="h-fit rounded border border-gold/25 px-2 py-1 text-[9px] uppercase tracking-wider text-gold">Fixture — không phải địa điểm thật</span>}</div><details className="mt-4 text-[11px] text-fog"><summary className="cursor-pointer text-jade">Xem nguồn & trường dữ liệu</summary>{c.observations.map(o=><div key={o.id} className="mt-3 min-w-0 rounded-lg border border-line p-3"><a href={o.url} target="_blank" rel="noreferrer" className="break-all text-gold">{o.url}</a><p className="mt-1 text-fog-2">{o.sourceType} · {new Date(o.observedAt).toLocaleDateString("vi-VN")}</p><pre className="mt-2 overflow-x-auto text-[10px]">{JSON.stringify(o.payload,null,2)}</pre></div>)}</details>{c.status==="pending"&&<div className="mt-4 flex gap-3"><button type="button" disabled={!authorized||busy||!note.trim()} onClick={()=>command({action:"review",outletKey:c.key,decision:"approve",note})} className="button-secondary !text-[11px] disabled:opacity-40">Đối chiếu & ghi canonical</button><button type="button" disabled={!authorized||busy||!note.trim()} onClick={()=>command({action:"review",outletKey:c.key,decision:"reject",note})} className="text-[11px] text-fog-2 disabled:opacity-40">Từ chối</button></div>}</article>)}</div>{!snapshot?.candidates.length&&<p className="mt-6 text-center text-[12px] text-fog-2">{authorized?"Chưa có nhóm nguồn. Import observations để bắt đầu.":"Chi tiết nguồn chỉ hiển thị sau khi xác thực quyền quản trị."}</p>}</>}
      </section>}
      <p className="mt-10 border-t border-line pt-5 text-[11px] leading-relaxed text-fog-2">Pilot không khẳng định đã nhập OSM toàn quốc hay xác minh doanh nghiệp thực tế. Dữ liệu mẫu được tách khỏi exact search. Pháp nhân và địa điểm là hai thực thể khác nhau, không gộp các chi nhánh chỉ vì trùng MST.</p>
    </main>
  );
}
