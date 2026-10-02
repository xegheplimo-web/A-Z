import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { getBackend } from "../src/core/backend";

const queries = [
  { query: "quán giò chả Yên Dũng", category: "gio-cha", communes: ["x_yen_dung", "x_tan_an", "x_tien_phong", "x_canh_thuy"], min: 2 },
  { query: "quán cafe Yên Dũng Neo", category: "cafe", communes: ["x_yen_dung"], min: 1 },
  { query: "cửa hàng sắt Tân An", category: "vlxd", communes: ["x_tan_an"], min: 0 },
  { query: "cửa hàng bách hóa Yên Dũng", category: "tap-hoa", communes: ["x_yen_dung", "x_tan_an", "x_tien_phong", "x_canh_thuy"], min: 1 },
  { query: "nhà thuốc gần Neo", category: "nha-thuoc", communes: ["x_yen_dung"], min: 1 },
];

async function main() {
  const backend = await getBackend();
  const rows = [];
  for (const expected of queries) {
    const times: number[] = [];
    let result = await backend.retrieve({ query: expected.query, record: false, maxResults: 10 });
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      result = await backend.retrieve({ query: expected.query, record: false, maxResults: 10 });
      times.push(performance.now() - t);
    }
    const exact = result.places.exact;
    const scopeOk = result.scope.communes.length > 0 && result.scope.communes.every((c) => expected.communes.includes(c));
    const specialtyOk = result.understanding.categories.includes(expected.category);
    const exactIds = new Set(exact.map((p) => p.id));
    const partitionOk = result.places.related.every((p) => !exactIds.has(p.id)) && result.places.unverified.every((p) => !p.verified && !exactIds.has(p.id));
    const row = {
      query: expected.query, specialty: result.understanding.specialty, categories: result.understanding.categories,
      scope: result.scope, anchor: result.anchor,
      exact: exact.map((p) => ({ id: p.id, name: p.name, category: p.category, address: p.address, distance_km: p.distanceKm })),
      unverified: result.places.unverified.map((p) => p.name), related: result.places.related.map((p) => p.name),
      p95_ms: Math.round(times.sort((a,b)=>a-b)[times.length-1]),
      checks: { intent: result.understanding.intent === "local_search", specialty: specialtyOk, narrow_scope: scopeOk, partition: partitionOk, minimum_expected: exact.length >= expected.min, abstain_tan_an: expected.min !== 0 || exact.length === 0 },
    };
    rows.push(row);
    console.log(expected.query, JSON.stringify({ exact: row.exact.map(p=>p.name), specialty: row.specialty, checks: row.checks, p95: row.p95_ms }));
  }
  const report = { created_at: new Date().toISOString(), backend: backend.id, fixture_only: true, notes: "5 query do người dùng cung cấp; Tân An chưa có cơ sở sắt được xác minh trong fixture. Số liệu không đại diện dữ liệu/live latency toàn quốc.", queries: rows };
  const name = process.argv.includes("--before") ? "local1-before" : "local1-after";
  await mkdir("reports", { recursive: true });
  await writeFile(`reports/${name}.json`, JSON.stringify(report, null, 2));
  const fail = rows.flatMap(r=>Object.entries(r.checks).filter(([,v])=>!v).map(([k])=>`${r.query}: ${k}`));
  console.log(`Checks: ${rows.length * 6 - fail.length}/${rows.length * 6}; report: reports/${name}.json`);
  if (process.argv.includes("--gate") && fail.length) throw new Error(fail.join("\n"));
}
main().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1); });
