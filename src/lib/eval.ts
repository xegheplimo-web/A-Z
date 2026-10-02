// ---------------------------------------------------------------------------
// VietScope · Benchmark "vn-golden" — đo thật, không số liệu giả.
// Mỗi case khai báo kỳ vọng (intent, chuyên ngành, địa giới hiện hành, nguồn
// phải có, có/không có địa điểm exact, budget). Runner chạy qua cùng pipeline
// với production và ghi kết quả vào bảng eval_runs.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { evalRuns } from "@/db/schema";
import { desc } from "drizzle-orm";
import { analyze } from "./pipeline";
import { normalize } from "./vi";
import type { Budget, Intent } from "@/core/contract";

export interface EvalCase {
  id: string;
  query: string;
  tags: string[];
  intent: Intent;
  /** nhãn chuyên ngành mong đợi (undefined = không kiểm) */
  specialty?: string | null;
  /** id đơn vị hành chính HIỆN HÀNH phải nằm trong kết quả resolve */
  province?: string;
  /** verified = có ≥1 địa điểm đã xác minh; any = exact hoặc unverified; none = phải trả "chưa đủ bằng chứng" */
  places?: "verified" | "any" | "none";
  /** domain nguồn phải xuất hiện (any-of) */
  domains?: string[];
  budget?: Budget;
}

export const VN_GOLDEN: EvalCase[] = [
  // ── Local · có dấu / không dấu / slang ─────────────────────────────────
  { id: "L01", query: "quán giò chả ngon ở Yên Dũng", tags: ["local", "diacritics"], intent: "local_search", specialty: "giò chả", province: "t_bac_ninh", places: "verified", budget: "fast" },
  { id: "L02", query: "gio cha yen dung", tags: ["local", "no-diacritics"], intent: "local_search", specialty: "giò chả", province: "t_bac_ninh", places: "verified" },
  { id: "L03", query: "giò chả Nội Hoàng Bắc Giang", tags: ["local", "historical-name"], intent: "local_search", specialty: "giò chả", province: "t_bac_ninh", places: "verified" },
  { id: "L04", query: "cafe đẹp ở Yên Dũng", tags: ["local", "synonym"], intent: "local_search", specialty: "cà phê", province: "t_bac_ninh", places: "verified" },
  { id: "L05", query: "ca phe yen dung", tags: ["local", "no-diacritics"], intent: "local_search", specialty: "cà phê", province: "t_bac_ninh", places: "verified" },
  { id: "L06", query: "quán ăn đêm ở Yên Dũng", tags: ["local", "slang"], intent: "local_search", specialty: "ăn đêm", province: "t_bac_ninh", places: "verified" },
  { id: "L07", query: "quán nhậu Yên Dũng", tags: ["local", "slang"], intent: "local_search", specialty: "quán nhậu", province: "t_bac_ninh", places: "verified" },
  { id: "L08", query: "quán nét ở Yên Dũng", tags: ["local", "slang"], intent: "local_search", specialty: "quán nét", province: "t_bac_ninh", places: "verified" },
  { id: "L09", query: "tạp hóa Nội Hoàng", tags: ["local", "slang"], intent: "local_search", specialty: "tạp hóa", province: "t_bac_ninh", places: "verified" },
  { id: "L10", query: "cây xăng Yên Dũng", tags: ["local", "slang"], intent: "local_search", specialty: "cây xăng", province: "t_bac_ninh", places: "verified" },
  { id: "L11", query: "nhà nghỉ ở Yên Dũng", tags: ["local"], intent: "local_search", specialty: "nhà nghỉ", province: "t_bac_ninh", places: "verified" },
  { id: "L12", query: "nhà thuốc ở Yên Dũng", tags: ["local"], intent: "local_search", specialty: "nhà thuốc", province: "t_bac_ninh", places: "verified" },
  { id: "L13", query: "vật liệu xây dựng Yên Dũng", tags: ["local", "product"], intent: "local_search", specialty: "vật liệu xây dựng", province: "t_bac_ninh", places: "verified" },
  { id: "L14", query: "sửa xe máy Yên Dũng", tags: ["local"], intent: "local_search", specialty: "sửa xe", province: "t_bac_ninh", places: "verified" },
  { id: "L15", query: "máy khoan Yên Dũng", tags: ["local", "product"], intent: "local_search", specialty: "máy khoan", province: "t_bac_ninh", places: "verified" },
  { id: "L16", query: "bún chả ở Hà Nội", tags: ["local"], intent: "local_search", specialty: "bún chả", province: "t_ha_noi", places: "verified" },
  { id: "L17", query: "phở ở Hà Nội", tags: ["local"], intent: "local_search", specialty: "phở", province: "t_ha_noi", places: "verified" },
  { id: "L18", query: "bánh mì Sài Gòn", tags: ["local", "alias"], intent: "local_search", specialty: "bánh mì", province: "t_hcm", places: "verified" },
  { id: "L19", query: "cơm tấm ở TP.HCM", tags: ["local", "alias"], intent: "local_search", specialty: "cơm tấm", province: "t_hcm", places: "verified" },
  { id: "L20", query: "bún bò Huế ở Huế", tags: ["local"], intent: "local_search", specialty: "bún bò", province: "t_hue", places: "verified" },
  { id: "L21", query: "mì Quảng Đà Nẵng", tags: ["local"], intent: "local_search", specialty: "mì Quảng", province: "t_da_nang", places: "verified" },
  { id: "L22", query: "bánh đa cua Hải Phòng", tags: ["local"], intent: "local_search", specialty: "bánh đa cua", province: "t_hai_phong", places: "verified" },
  { id: "L23", query: "cơm cháy Ninh Bình", tags: ["local", "unverified"], intent: "local_search", specialty: "cơm cháy", province: "t_ninh_binh", places: "any" },
  { id: "L24", query: "cửa hàng bán máy khoan gần đây", tags: ["local", "no-location", "needs-location"], intent: "local_search", specialty: "máy khoan", places: "none" },
  // User-specified pilot regressions. Unresolved location or missing stock must abstain.
  { id: "YD01", query: "quán giò chả Yên Dũng", tags: ["local", "pilot"], intent: "local_search", specialty: "giò chả", province: "t_bac_ninh", places: "verified" },
  { id: "YD02", query: "quán cafe Yên Dũng Neo", tags: ["local", "pilot", "narrow-scope"], intent: "local_search", specialty: "cà phê", province: "t_bac_ninh", places: "verified" },
  { id: "YD03", query: "cửa hàng sắt Tân An", tags: ["local", "pilot", "abstain"], intent: "local_search", specialty: "sắt thép", province: "t_bac_ninh", places: "none" },
  { id: "YD04", query: "cửa hàng bách hóa Yên Dũng", tags: ["local", "pilot", "synonym"], intent: "local_search", specialty: "tạp hóa", province: "t_bac_ninh", places: "verified" },
  { id: "YD05", query: "nhà thuốc gần Neo", tags: ["local", "pilot", "nearby"], intent: "local_search", specialty: "nhà thuốc", province: "t_bac_ninh", places: "verified" },
  // ── Typo — fuzzy matching (đã vá; giữ làm regression) ──
  { id: "T01", query: "gio cha yen dungg", tags: ["local", "typo", "fuzzy"], intent: "local_search", specialty: "giò chả", province: "t_bac_ninh", places: "verified" },
  { id: "T02", query: "cafe yen dun", tags: ["local", "typo", "fuzzy"], intent: "local_search", specialty: "cà phê", province: "t_bac_ninh", places: "verified" },
  { id: "T03", query: "quan gio cha yen dzung", tags: ["local", "typo", "fuzzy"], intent: "local_search", specialty: "giò chả", province: "t_bac_ninh", places: "verified" },
  { id: "T04", query: "banh da cua hai phongg", tags: ["local", "typo", "fuzzy"], intent: "local_search", specialty: "bánh đa cua", province: "t_hai_phong", places: "verified" },
  // ── Local · mở rộng vùng/món ──
  { id: "L25", query: "bánh phu thê Đình Bảng", tags: ["local", "đặc-sản"], intent: "local_search", specialty: "bánh phu thê", province: "t_bac_ninh", places: "verified" },
  { id: "L26", query: "chả cá Lã Vọng Hà Nội", tags: ["local"], intent: "local_search", specialty: "chả cá", province: "t_ha_noi", places: "verified" },
  { id: "L27", query: "cơm tấm Sài Gòn", tags: ["local", "alias"], intent: "local_search", specialty: "cơm tấm", province: "t_hcm", places: "verified" },
  { id: "L28", query: "bánh cuốn ở Hà Nội", tags: ["local"], intent: "local_search", specialty: "bánh cuốn", province: "t_ha_noi", places: "verified" },
  { id: "L29", query: "quán net ở Yên Dũng", tags: ["local", "slang"], intent: "local_search", specialty: "quán nét", province: "t_bac_ninh", places: "verified" },
  { id: "L30", query: "cửa hàng điện nước Yên Dũng", tags: ["local"], intent: "local_search", specialty: "điện nước", province: "t_bac_ninh", places: "verified" },
  { id: "L31", query: "giò chả ngon ở Bắc Giang", tags: ["local", "historical-name"], intent: "local_search", specialty: "giò chả", province: "t_bac_ninh", places: "any" },
  { id: "L32", query: "banh mi o sai gon", tags: ["local", "no-diacritics"], intent: "local_search", specialty: "bánh mì", province: "t_hcm", places: "verified" },
  { id: "L33", query: "nhà nghỉ gần Yên Dũng", tags: ["local"], intent: "local_search", specialty: "nhà nghỉ", province: "t_bac_ninh", places: "verified" },
  // ── Legal / hành chính bổ sung ──
  { id: "G04", query: "nghị quyết 202/2025 về sắp xếp đơn vị hành chính cấp tỉnh", tags: ["legal"], intent: "legal", domains: ["quochoi.vn"], budget: "standard" },
  { id: "G05", query: "hộ kinh doanh dưới 500 triệu có phải nộp thuế không", tags: ["legal"], intent: "legal", domains: ["baochinhphu.vn"] },
  { id: "G06", query: "tra cứu hóa đơn điện tử hợp lệ ở đâu", tags: ["legal", "government"], intent: "legal", domains: ["gdt.gov.vn"] },
  { id: "A03", query: "Bắc Giang sáp nhập vào tỉnh nào", tags: ["admin", "historical-name"], intent: "admin_info", province: "t_bac_ninh", domains: ["quochoi.vn"] },
  // ── Honest "không biết" — không được giả vờ có kết quả ─────────────────
  { id: "N01", query: "quán chả cá ngon ở Yên Dũng", tags: ["negative", "honesty"], intent: "local_search", specialty: "chả cá", province: "t_bac_ninh", places: "none" },
  { id: "N02", query: "bún bò Huế ở Yên Dũng", tags: ["negative", "honesty"], intent: "local_search", specialty: "bún bò", province: "t_bac_ninh", places: "none" },
  { id: "N03", query: "phở ở Cà Mau", tags: ["negative", "honesty"], intent: "local_search", specialty: "phở", province: "t_ca_mau", places: "none" },
  { id: "N04", query: "bánh mì ở Yên Dũng", tags: ["negative", "honesty"], intent: "local_search", specialty: "bánh mì", province: "t_bac_ninh", places: "none" },
  { id: "N05", query: "quán nét ở Cà Mau", tags: ["negative", "honesty"], intent: "local_search", specialty: "quán nét", province: "t_ca_mau", places: "none" },
  // ── Pháp luật / chính phủ ───────────────────────────────────────────────
  { id: "G01", query: "nghị định mới nhất về hóa đơn điện tử", tags: ["legal", "diacritics"], intent: "legal", domains: ["vanban.chinhphu.vn"], budget: "standard" },
  { id: "G02", query: "nghi dinh hoa don dien tu", tags: ["legal", "no-diacritics"], intent: "legal", domains: ["vanban.chinhphu.vn"] },
  { id: "G03", query: "thuế khoán hộ kinh doanh 2026", tags: ["legal"], intent: "legal", domains: ["baochinhphu.vn", "vanban.chinhphu.vn"] },
  // ── Thị trường / thời tiết ──────────────────────────────────────────────
  { id: "M01", query: "giá vàng hôm nay vì sao tăng", tags: ["market", "fresh"], intent: "market_price", domains: ["vneconomy.vn", "cafef.vn"], budget: "fast" },
  { id: "M02", query: "gia xang hom nay", tags: ["market", "no-diacritics"], intent: "market_price", domains: ["thanhnien.vn"] },
  { id: "M03", query: "tỷ giá usd hôm nay", tags: ["market", "fresh"], intent: "market_price", domains: ["vnbusiness.vn"] },
  { id: "W01", query: "thời tiết Bắc Ninh", tags: ["weather"], intent: "weather", province: "t_bac_ninh", domains: ["nchmf.gov.vn"], budget: "fast" },
  { id: "W02", query: "thoi tiet bac ninh hom nay", tags: ["weather", "no-diacritics"], intent: "weather", province: "t_bac_ninh", domains: ["nchmf.gov.vn"] },
  // ── So sánh sản phẩm ────────────────────────────────────────────────────
  { id: "C01", query: "so sánh VinFast VF8 với Hyundai Santa Fe", tags: ["compare"], intent: "compare", domains: ["autodaily.vn", "vinfastauto.com", "hyundai.com"], budget: "standard" },
  { id: "C02", query: "vf8 vs santa fe", tags: ["compare", "slang"], intent: "compare", domains: ["autodaily.vn", "vinfastauto.com", "hyundai.com"] },
  // ── Hành chính · sáp nhập ───────────────────────────────────────────────
  { id: "A01", query: "yên dũng bây giờ thuộc tỉnh nào", tags: ["admin", "historical-name"], intent: "admin_info", province: "t_bac_ninh", domains: ["bacninh.gov.vn", "quochoi.vn"] },
  { id: "A02", query: "sáp nhập Bắc Giang vào Bắc Ninh", tags: ["admin", "historical-name"], intent: "admin_info", province: "t_bac_ninh", domains: ["quochoi.vn"] },
  // ── Research ────────────────────────────────────────────────────────────
  { id: "R01", query: "nghiên cứu xu hướng xe điện tại Việt Nam năm 2026", tags: ["research"], intent: "general", budget: "research" },
];

export interface EvalMetrics {
  [k: string]: number | string | unknown;
  intent_accuracy: number;
  specialty_accuracy: number;
  geo_resolution_accuracy: number;
  budget_accuracy: number;
  exact_place_precision: number;
  specialty_precision: number;
  outside_area_rate: number;
  honest_no_exact_rate: number;
  zero_result_rate: number;
  "recall@8": number;
  "ndcg@10": number;
  mrr: number;
  citation_precision: number;
  citation_coverage: number;
  unsupported_claim_rate: number;
  avg_confidence: number;
  p50_ms: number;
  p95_ms: number;
  failures: { id: string; query: string; reason: string }[];
}

const r2 = (n: number) => Math.round(n * 1000) / 1000;
const ratio = (a: number, b: number, empty = 1) => (b === 0 ? empty : a / b);
const pct = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export async function runEval(opts: { persist?: boolean; name?: string } = {}): Promise<{ metrics: EvalMetrics; queryCount: number; name: string }> {
  const failures: EvalMetrics["failures"] = [];
  const fail = (c: EvalCase, reason: string) => failures.push({ id: c.id, query: c.query, reason });

  let intentOk = 0;
  let specTotal = 0, specOk = 0;
  let geoTotal = 0, geoOk = 0;
  let budgetTotal = 0, budgetOk = 0;
  let placesReturned = 0, placesCorrect = 0, placesSpecOk = 0, placesOutside = 0, placesScoped = 0;
  let noneTotal = 0, noneOk = 0;
  let expectTotal = 0, zeroResult = 0;
  let recallSum = 0, mrrSum = 0, ndcgSum = 0, domainCases = 0;
  let claimsTotal = 0, claimsUnsupported = 0, citedClaims = 0, citedOk = 0;
  let covSum = 0;
  let confSum = 0;
  const latencies: number[] = [];
  let backendId = "?";

  for (const c of VN_GOLDEN) {
    const t0 = performance.now();
    const x = await analyze(c.query, { log: false });
    latencies.push(performance.now() - t0);
    const r = x.retrieval;
    const u = r.understanding;
    const { verification, quality } = x;
    backendId = r.backend;
    confSum += quality.confidence;

    if (u.intent === c.intent) intentOk++;
    else fail(c, `intent = ${u.intent}, mong đợi ${c.intent}`);

    if (c.specialty !== undefined) {
      specTotal++;
      if (u.specialty === c.specialty) specOk++;
      else fail(c, `specialty = ${u.specialty ?? "null"}, mong đợi ${c.specialty}`);
    }
    if (c.province) {
      geoTotal++;
      if (u.resolvedCurrentIds.includes(c.province)) geoOk++;
      else fail(c, `không resolve về ${c.province} (được: ${u.resolvedCurrentIds.join(",") || "∅"})`);
    }
    if (c.budget) {
      budgetTotal++;
      if (r.budget.name === c.budget) budgetOk++;
      else fail(c, `budget = ${r.budget.name}, mong đợi ${c.budget}`);
    }

    // ── places ──
    const shown = [...r.places.exact, ...r.places.unverified];
    if (c.places) {
      if (c.places === "none") {
        noneTotal++;
        if (shown.length === 0) noneOk++;
        else fail(c, `đáng lẽ phải trả “chưa đủ bằng chứng” nhưng có ${shown.length} địa điểm exact/unverified`);
      } else {
        expectTotal++;
        const need = c.places === "verified" ? r.places.exact.length : shown.length;
        if (need === 0) {
          zeroResult++;
          fail(c, `không có địa điểm ${c.places}`);
        }
      }
    }
    const spN = u.specialty ? normalize(u.specialty) : null;
    for (const p of shown) {
      placesReturned++;
      const inScope = r.scope.provinces.length ? r.scope.provinces.includes(p.provinceId) : true;
      const specOkHere = spN ? p.specialties.some((s) => normalize(s).includes(spN)) || u.categories.includes(p.category) : true;
      if (specOkHere) placesSpecOk++;
      if (inScope && specOkHere) placesCorrect++;
    }
    if (r.scope.provinces.length) {
      for (const p of [...shown, ...r.places.related]) {
        placesScoped++;
        if (!r.scope.provinces.includes(p.provinceId)) placesOutside++;
      }
    }

    // ── documents ──
    if (c.domains) {
      domainCases++;
      const top = r.docs.slice(0, 8);
      const hits = new Set<string>();
      let firstRank = 0;
      let dcg = 0;
      top.forEach((d, i) => {
        if (c.domains!.includes(d.domain)) {
          hits.add(d.domain);
          if (!firstRank) firstRank = i + 1;
          dcg += 1 / Math.log2(i + 2);
        }
      });
      const idealN = Math.min(c.domains.length, 10);
      let idcg = 0;
      for (let i = 0; i < idealN; i++) idcg += 1 / Math.log2(i + 2);
      recallSum += hits.size / c.domains.length;
      mrrSum += firstRank ? 1 / firstRank : 0;
      ndcgSum += idcg ? dcg / idcg : 0;
      if (!hits.size) fail(c, `không có nguồn mong đợi (${c.domains.join(" | ")}) trong top-8`);
    }

    // ── answer / citation ──
    claimsTotal += verification.claims.length;
    claimsUnsupported += verification.unsupportedClaims;
    const cited = verification.claims.filter((k) => k.citations.length > 0);
    citedClaims += cited.length;
    citedOk += cited.filter((k) => k.supported).length;
    covSum += verification.citationCoverage;
  }

  const n = VN_GOLDEN.length;
  const metrics: EvalMetrics = {
    intent_accuracy: r2(intentOk / n),
    specialty_accuracy: r2(ratio(specOk, specTotal)),
    geo_resolution_accuracy: r2(ratio(geoOk, geoTotal)),
    budget_accuracy: r2(ratio(budgetOk, budgetTotal)),
    exact_place_precision: r2(ratio(placesCorrect, placesReturned)),
    specialty_precision: r2(ratio(placesSpecOk, placesReturned)),
    outside_area_rate: r2(ratio(placesOutside, placesScoped, 0)),
    honest_no_exact_rate: r2(ratio(noneOk, noneTotal)),
    zero_result_rate: r2(ratio(zeroResult, expectTotal, 0)),
    "recall@8": r2(ratio(recallSum, domainCases)),
    "ndcg@10": r2(ratio(ndcgSum, domainCases)),
    mrr: r2(ratio(mrrSum, domainCases)),
    citation_precision: r2(ratio(citedOk, citedClaims)),
    citation_coverage: r2(covSum / n),
    unsupported_claim_rate: r2(ratio(claimsUnsupported, claimsTotal, 0)),
    avg_confidence: r2(confSum / n),
    p50_ms: Math.round(pct(latencies, 50)),
    p95_ms: Math.round(pct(latencies, 95)),
    backend: backendId,
    failures,
  };
  const name = opts.name ?? `vn-golden-${n} · vietscope-1 · ${backendId}`;
  if (opts.persist !== false) {
    await db.insert(evalRuns).values({ name, suite: "vn-golden", queryCount: n, metrics });
  }
  return { metrics, queryCount: n, name };
}

/** Lấy lần chạy gần nhất; nếu chưa có thì chạy ngay (không số liệu giả). */
export async function getLatestEval() {
  const [row] = await db.select().from(evalRuns).orderBy(desc(evalRuns.createdAt)).limit(1);
  if (row) return { name: row.name, queryCount: row.queryCount ?? 0, metrics: row.metrics as EvalMetrics, createdAt: row.createdAt };
  const res = await runEval();
  return { name: res.name, queryCount: res.queryCount, metrics: res.metrics, createdAt: new Date() };
}
