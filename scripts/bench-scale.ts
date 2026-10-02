// ---------------------------------------------------------------------------
// Bench quy mô: engine tham chiếu có còn "quét cả bảng" không?
//   npx tsx scripts/bench-scale.ts [places=150000] [docs=60000]
//
// 1) Chèn dữ liệu tổng hợp (source='synthetic' / domain='synthetic.test') — LUÔN xoá sau khi chạy
// 2) Đo chi phí của cách cũ (select * from places/documents) làm mốc
// 3) Đo latency retrieve với candidate generation ở SQL (p50/p95)
// 4) Kiểm tra index được dùng (EXPLAIN)
// 5) Chạy lại VN_GOLDEN VỚI nhiễu: chất lượng có giữ không? (kể cả nhiễu "SEO spam" trùng từ khoá)
// ---------------------------------------------------------------------------
import "dotenv/config";
import { sql } from "drizzle-orm";

const N_PLACES = Number(process.argv[2] ?? 150000);
const N_DOCS = Number(process.argv[3] ?? 60000);
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
const ms = (n: number) => `${n.toFixed(1)}ms`;

async function main() {
  const { db } = await import("../src/db");
  const { ensureIndexes } = await import("../src/engine/embedded/indexes");
  const { embeddedBackend } = await import("../src/engine/embedded");
  const { runEval } = await import("../src/lib/eval");
  const { places, documents } = await import("../src/db/schema");
  process.env.RETRIEVAL_BACKEND = "embedded";
  await ensureIndexes();

  const cleanup = async () => {
    await db.execute(sql`delete from places where source = 'synthetic'`);
    await db.execute(sql`delete from documents where domain = 'synthetic.test'`);
    await db.execute(sql`analyze places`);
    await db.execute(sql`analyze documents`);
  };
  await cleanup();

  const baseline = await runEval({ persist: false });
  const [p0] = await db.select({ c: sql<number>`count(*)` }).from(places);
  const [d0] = await db.select({ c: sql<number>`count(*)` }).from(documents);
  console.log(`dữ liệu thật: ${p0.c} places · ${d0.c} documents`);

  try {
    let t = performance.now();
    await db.execute(sql`
      insert into places (name, name_search, category, category_label, specialties, specialties_search, address, address_search, province_id, rating, review_count, source, verified, lat, lng)
      select 'Quán Synthetic ' || g, 'quan synthetic ' || g,
             (array['cafe','pho','gio-cha','com','an-dem','tap-hoa','nha-thuoc','xang-dau'])[1 + (g % 8)], 'Synthetic', array['synthetic'], 'synthetic',
             'địa chỉ ' || g, 'dia chi ' || g,
             (select id from admin_units where type = 'province' and status = 'current' order by id limit 1 offset (g % 34)),
             1 + random() * 3, (random() * 500)::int, 'synthetic', false, 8 + random() * 14, 102 + random() * 7
      from generate_series(1, ${N_PLACES}) g`);
    console.log(`chèn ${N_PLACES} places: ${((performance.now() - t) / 1000).toFixed(1)}s`);

    t = performance.now();
    // nhiễu trùng từ khoá với query thật (giá, vàng, thuế, hoá đơn, xe điện…) → kiểm tra recall dưới SEO-spam
    await db.execute(sql`
      insert into documents (title, title_search, url, domain, source_type, snippet, content, content_search, authority, published_at, entities)
      select 'Synthetic ' || g, 'synthetic ' || g, 'https://synthetic.test/' || g, 'synthetic.test', 'web', 'snippet', c, c, 0.3, now() - (g || ' minutes')::interval, '{}'
      from (
        select g, (select string_agg((array['gia','vang','tang','thue','hoa','don','xe','dien','thi','truong','tin','tuc','moi','nhat','quan','an','ngon','cafe','dep','ha','noi','sai','gon','luat','nghi','dinh'])[1 + ((g * 7 + w * 13) % 26)], ' ') from generate_series(1, 120) w) as c
        from generate_series(1, ${N_DOCS}) g
      ) t`);
    console.log(`chèn ${N_DOCS} documents: ${((performance.now() - t) / 1000).toFixed(1)}s`);
    await db.execute(sql`analyze places`);
    await db.execute(sql`analyze documents`);

    // --- mốc: cách cũ phải kéo cả bảng về process cho MỖI truy vấn ---
    t = performance.now();
    const allP = await db.select().from(places);
    const tPlaces = performance.now() - t;
    t = performance.now();
    const allD = await db.select().from(documents);
    const tDocs = performance.now() - t;
    console.log(`\nMỐC (cách cũ, chỉ riêng việc load): places ${allP.length} dòng = ${ms(tPlaces)} · documents ${allD.length} dòng = ${ms(tDocs)}  → ≈ ${ms(tPlaces + tDocs)} / truy vấn TRƯỚC khi chấm điểm`);

    // --- cách mới ---
    const queries = ["quán giò chả ngon ở Yên Dũng", "cafe đẹp ở Hà Nội", "nghị định mới nhất về hóa đơn điện tử", "giá vàng hôm nay vì sao tăng", "so sánh VinFast VF8 với Hyundai Santa Fe", "bánh mì Sài Gòn"];
    const lat: number[] = [];
    for (const q of queries) {
      const ls: number[] = [];
      for (let i = 0; i < 12; i++) {
        const s = performance.now();
        await embeddedBackend.retrieve({ query: q, record: false });
        ls.push(performance.now() - s);
      }
      lat.push(...ls);
      console.log(`  ${q.padEnd(44)} p50 ${ms(pct(ls, 50)).padStart(8)}  p95 ${ms(pct(ls, 95)).padStart(8)}`);
    }
    console.log(`TỔNG (SQL candidate generation): p50 ${ms(pct(lat, 50))} · p95 ${ms(pct(lat, 95))}  trên ${N_PLACES} places + ${N_DOCS} docs`);

    // --- index có được dùng? ---
    const plan = async (q: ReturnType<typeof sql>) => ((await db.execute(sql`explain ${q}`)) as unknown as { rows: Record<string, string>[] }).rows.map((r) => r["QUERY PLAN"]).join(" | ");
    const p1 = await plan(sql`select * from places where province_id = 't_bac_ninh' and category = 'cafe' order by verified desc, rating desc nulls last limit 400`);
    const p2 = await plan(sql`select id from documents where fts @@ to_tsquery('simple', 'yen | dung') limit 120`);
    const p3 = await plan(sql`select id from documents where fts @@ to_tsquery('simple', 'gia | vang') limit 120`);
    console.log(`\nEXPLAIN places           : ${/Index|Bitmap/.test(p1) ? "dùng index ✓" : "SEQ SCAN ✗"}`);
    console.log(`EXPLAIN docs (từ chọn lọc): ${/documents_fts_gin_idx/.test(p2) ? "dùng GIN ✓" : "không dùng GIN ✗"}`);
    console.log(`EXPLAIN docs (từ phổ biến 'gia|vang' khớp ~nhiều dòng): ${/documents_fts_gin_idx/.test(p3) ? "dùng GIN" : "Seq Scan — planner chọn đúng vì từ quá phổ biến (chỉ số chọn lọc thấp)"}`);

    // --- chất lượng khi có nhiễu ---
    const noisy = await runEval({ persist: false });
    const keys = ["intent_accuracy", "specialty_accuracy", "geo_resolution_accuracy", "exact_place_precision", "outside_area_rate", "honest_no_exact_rate", "zero_result_rate", "recall@8", "ndcg@10", "mrr", "citation_precision", "unsupported_claim_rate"];
    console.log("\nCHẤT LƯỢNG (VN_GOLDEN) — sạch → có nhiễu:");
    let regress = 0;
    for (const k of keys) {
      const a = baseline.metrics[k] as number;
      const b = noisy.metrics[k] as number;
      const worse = ["outside_area_rate", "zero_result_rate", "unsupported_claim_rate"].includes(k) ? b > a + 1e-9 : b < a - 1e-9;
      if (worse) regress++;
      console.log(`  ${k.padEnd(26)} ${String(a).padStart(6)} → ${String(b).padStart(6)} ${worse ? "  ⚠ TỆ ĐI" : ""}`);
    }
    const nf = noisy.metrics.failures as { id: string; reason: string }[];
    nf.forEach((f) => console.log(`  ✗ ${f.id}: ${f.reason}`));
    console.log(`  p95 end-to-end (analyze): ${noisy.metrics.p95_ms}ms  (sạch: ${baseline.metrics.p95_ms}ms)`);
    console.log(regress === 0 && nf.length === 0 ? "\n✓ chất lượng giữ nguyên dưới nhiễu quy mô lớn" : `\n⚠ ${regress} metric xấu đi / ${nf.length} case lỗi dưới nhiễu — xem ở trên`);
  } finally {
    await cleanup();
    const [p1] = await db.select({ c: sql<number>`count(*)` }).from(places);
    const [d1] = await db.select({ c: sql<number>`count(*)` }).from(documents);
    console.log(`đã dọn dữ liệu tổng hợp: ${p1.c} places · ${d1.c} documents (thật: ${p0.c} · ${d0.c})`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
