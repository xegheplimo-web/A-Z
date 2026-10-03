// ---------------------------------------------------------------------------
// Retention regression test (P-LEARNING-2.1e) — black-box:
//   chèn trace giả backdate 20 ngày chứa PII → chạy telemetry-retention.ts
//   thật → assert query/normalized/trace đã redact → xóa row test.
//
//   npx tsx scripts/test-telemetry-retention.ts   (cần DATABASE_URL)
// ---------------------------------------------------------------------------
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { db, pool } from "../src/db";
import { sql } from "drizzle-orm";

let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failed++;
};

const MARKER = "retention-test-marker-zz9";

async function main() {
  const inserted = await db.execute(sql`
    INSERT INTO search_traces (query, query_safe, normalized, intent, results_total, trace, created_at)
    VALUES (
      ${'tim so 0987654321 cua anh ' + MARKER},
      ${'tim so [sdt] cua anh ' + MARKER},
      ${'tim so 0987654321 cua anh ' + MARKER},
      'general', 0,
      ${JSON.stringify({ query: 'tim so 0987654321 cua anh ' + MARKER, normalized: 'tim so 0987654321 cua anh ' + MARKER })}::jsonb,
      now() - interval '20 days'
    ) RETURNING id`);
  const id = (inserted.rows?.[0] as { id?: string } | undefined)?.id;
  if (!id) {
    console.error("insert failed");
    process.exit(1);
  }

  const run = spawnSync("npx", ["tsx", "scripts/telemetry-retention.ts"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf-8",
    shell: true,
  });
  ok("retention script exits 0", run.status === 0, (run.stderr || run.stdout || "").trim().slice(-200));

  const rows = await db.execute(sql`
    SELECT query, normalized, trace->>'query' AS tq, trace->>'normalized' AS tn
      FROM search_traces WHERE id = ${id}`);
  const r = rows.rows?.[0] as Record<string, string> | undefined;
  ok("query → query_safe", r?.query?.includes("[sdt]") === true, String(r?.query));
  ok("normalized redacted", r?.normalized?.includes("[sdt]") === true && !r?.normalized?.includes("0987654321"), String(r?.normalized));
  ok("trace.query → safe", r?.tq?.includes("[sdt]") === true, String(r?.tq));
  ok("trace.normalized → safe", r?.tn?.includes("[sdt]") === true && !r?.tn?.includes("0987654321"), String(r?.tn));

  await db.execute(sql`DELETE FROM search_traces WHERE id = ${id}`);
  await pool.end();
  if (failed) process.exit(1);
  console.log("all retention assertions passed");
}

main().catch(async (e) => {
  console.error(e);
  await db.execute(sql`DELETE FROM search_traces WHERE query LIKE ${"%" + MARKER + "%"}`).catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
