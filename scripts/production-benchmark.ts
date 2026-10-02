import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const baseUrl = (process.env.VIETSCOPE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const apiKey = process.env.VIETSCOPE_API_KEY ?? process.env.VIETSCOPE_API_KEYS?.split(",")[0]?.trim() ?? "";
const runs = Math.max(1, Number(process.env.BENCH_RUNS ?? 3));
const smoke = process.argv.includes("--smoke");
const gate = smoke || process.argv.includes("--gate");
const outputArg = process.argv.findIndex((arg) => arg === "--output");
const output = outputArg >= 0 ? process.argv[outputArg + 1] : "reports/production-local1.json";

const cases = [
  { query: "quán giò chả Yên Dũng", specialty: "giò chả", aliases: ["giò chả", "gio cha"], categories: ["gio-cha"], areas: ["yên dũng", "yen dung", "neo"] },
  { query: "quán cafe Yên Dũng Neo", specialty: "cà phê", aliases: ["cafe", "cà phê", "coffee"], categories: ["cafe", "coffee_shop"], areas: ["yên dũng", "yen dung", "neo"] },
  { query: "cửa hàng sắt Tân An", specialty: "sắt thép", aliases: ["sắt", "thép", "sat", "thep"], categories: ["vlxd", "hardware", "steel"], areas: ["tân an", "tan an"] },
  { query: "cửa hàng bách hóa Yên Dũng", specialty: "tạp hóa", aliases: ["bách hóa", "tạp hóa", "bach hoa", "tap hoa", "grocery"], categories: ["tap-hoa", "grocery", "convenience", "supermarket"], areas: ["yên dũng", "yen dung", "neo"] },
  { query: "nhà thuốc gần Neo", specialty: "nhà thuốc", aliases: ["nhà thuốc", "hiệu thuốc", "nha thuoc", "pharmacy"], categories: ["nha-thuoc", "pharmacy"], areas: ["neo", "yên dũng", "yen dung"] },
];

const fold = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const percentile = (values: number[], p: number) => values.length ? values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : 0;

async function retrieve(query: string) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/v1/retrieve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ query, mode: "fast", evidence: "off", max_results: 10 }),
    signal: AbortSignal.timeout(40_000),
  });
  const wallMs = Math.round(performance.now() - started);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return { body: JSON.parse(text), wallMs };
}

async function main() {
  const rows = [];
  let contractErrors = 0;
  let relevant = 0;
  let returned = 0;
  let outside = 0;
  const allCoreTimes: number[] = [];
  const allWallTimes: number[] = [];

  for (const item of cases) {
    const times: number[] = [];
    const walls: number[] = [];
    let body: any = null;
    let error: string | null = null;
    for (let i = 0; i < runs; i += 1) {
      try {
        const result = await retrieve(item.query);
        body = result.body;
        walls.push(result.wallMs);
        const coreMs = Number(body.timings?.total_ms);
        times.push(Number.isFinite(coreMs) ? coreMs : result.wallMs);
        if (body.backend !== "search-router" || body.model !== "vietscope-1" || !Array.isArray(body.results)) {
          throw new Error("response is not the production VietScope contract");
        }
      } catch (cause) {
        contractErrors += 1;
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }

    const localResults = (body?.results ?? []).filter((result: any) => result.type === "place").slice(0, 10);
    let caseRelevant = 0;
    let caseOutside = 0;
    for (const result of localResults) {
      const haystack = fold([result.title, result.snippet, result.entity, result.location?.address].join(" "));
      const isRelevant = item.aliases.some((alias) => haystack.includes(fold(alias))) || item.categories.some((category) => fold(result.entity) === fold(category));
      const inArea = item.areas.some((area) => haystack.includes(fold(area)));
      caseRelevant += Number(isRelevant);
      caseOutside += Number(!inArea);
    }
    relevant += caseRelevant;
    returned += localResults.length;
    outside += caseOutside;
    allCoreTimes.push(...times);
    allWallTimes.push(...walls);

    rows.push({
      query: item.query,
      expected_specialty: item.specialty,
      actual_specialty: body?.intent?.specialty ?? null,
      results: localResults.map((result: any) => ({ title: result.title, entity: result.entity, address: result.location?.address ?? null })),
      relevant: caseRelevant,
      outside_area: caseOutside,
      core_p95_ms: percentile(times, 0.95),
      wall_p95_ms: percentile(walls, 0.95),
      error,
    });
  }

  const precision = returned ? relevant / returned : 0;
  const genericNoise = returned ? (returned - relevant) / returned : 1;
  const outsideRate = returned ? outside / returned : 1;
  const metrics = {
    backend: "search-router",
    runs_per_query: runs,
    queries: cases.length,
    returned_places: returned,
    specialty_precision_at_10: Number(precision.toFixed(4)),
    generic_noise_rate: Number(genericNoise.toFixed(4)),
    outside_area_rate: Number(outsideRate.toFixed(4)),
    local_widened_core_p95_ms: percentile(allCoreTimes, 0.95),
    wall_p95_ms: percentile(allWallTimes, 0.95),
    contract_errors: contractErrors,
  };
  const checks = {
    contract_errors_zero: contractErrors === 0,
    production_backend: rows.every((row) => !row.error),
    local_widened_p95_lte_5s: metrics.local_widened_core_p95_ms <= 5_000,
    live_results_present: returned > 0,
    specialty_precision_at_10_gte_080: precision >= 0.8,
    generic_noise_lt_010: genericNoise < 0.1,
    outside_area_lt_005: outsideRate < 0.05,
  };
  const report = {
    created_at: new Date().toISOString(),
    live: true,
    fixture_only: false,
    target: baseUrl,
    mode: smoke ? "production-smoke" : "live-quality",
    metrics,
    checks,
    queries: rows,
    note: "Heuristic labels are a P-NEXT gate; replace/extend with independently reviewed VN100 labels before quality claims.",
  };

  await mkdir(output.slice(0, Math.max(0, output.lastIndexOf("/"))) || ".", { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
  console.log(`report: ${output}`);

  const selectedChecks = smoke
    ? ["contract_errors_zero", "production_backend", "local_widened_p95_lte_5s"]
    : Object.keys(checks);
  const failures = selectedChecks.filter((name) => !checks[name as keyof typeof checks]);
  if (gate && failures.length) throw new Error(`production benchmark gate failed: ${failures.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
