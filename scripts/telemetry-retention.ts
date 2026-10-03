// ---------------------------------------------------------------------------
// Telemetry retention (P-LEARNING) — thực thi 3 tầng lưu trữ. Chạy định kỳ
// (khuyến nghị daily, vd cron 03:30 / Task Scheduler):
//   npm run telemetry:retention
//
//   Single-run: pg_try_advisory_lock (key LOCK_KEY) — instance thứ hai skip
//   sạch, exit 0. Hard timeout RETENTION_TIMEOUT_MS (mặc định 10m) → exit 2.
//   Scheduler nên alert khi exit != 0; stdout log rows-affected mỗi tầng.
//
//   HOT  0–14 ngày : full trace (query raw + trace JSONB) để debug regression
//   WARM 14–90     : query → query_safe, trace.query → query_safe; giữ cột
//                    structured (intent/counts/quality/latency/coverage)
//   LONG >90 ngày  : xóa trace JSONB; giữ aggregates cột + interactions/feedback
//                    (interactions purge >180 ngày — tín hiệu hành vi hết giá
//                    trị phân tích rank sau đó)
// ---------------------------------------------------------------------------
import "dotenv/config";
import { db, pool } from "../src/db";
import { sql } from "drizzle-orm";

const HOT_DAYS = Number(process.env.TRACE_HOT_DAYS ?? 14);
const WARM_DAYS = Number(process.env.TRACE_WARM_DAYS ?? 90);
const INTERACTION_DAYS = Number(process.env.INTERACTION_DAYS ?? 180);
const TIMEOUT_MS = Number(process.env.RETENTION_TIMEOUT_MS ?? 10 * 60_000);
// Advisory lock key — cố định, mọi instance/job dùng chung để single-run.
const LOCK_KEY = 73190426; // "vsret"

async function main() {
  // pg_advisory_lock là session-scoped → giữ MỘT connection riêng cho lock
  // trong suốt job (work chạy qua pool connections khác vẫn được bảo vệ).
  const lockClient = await pool.connect();
  const [lock] = (
    await lockClient.query("SELECT pg_try_advisory_lock($1) AS got", [LOCK_KEY])
  ).rows as { got: boolean }[];
  if (!lock?.got) {
    console.log("retention: another run holds the advisory lock — skip");
    lockClient.release();
    await pool.end();
    return;
  }
  const kill = setTimeout(() => {
    console.error(`retention: exceeded ${TIMEOUT_MS}ms — hard exit`);
    process.exit(2);
  }, TIMEOUT_MS);
  kill.unref();

  try {
  // WARM: raw query → query_safe ở cả cột query lẫn trace JSONB
  const q = await db.execute(sql`
    UPDATE search_traces
       SET query = query_safe
     WHERE created_at < now() - make_interval(days => ${HOT_DAYS})
       AND query_safe IS NOT NULL AND query IS DISTINCT FROM query_safe`);
  const t = await db.execute(sql`
    UPDATE search_traces
       SET trace = jsonb_set(trace, '{query}', to_jsonb(query_safe))
     WHERE created_at < now() - make_interval(days => ${HOT_DAYS})
       AND query_safe IS NOT NULL AND trace IS NOT NULL
       AND trace->>'query' IS DISTINCT FROM query_safe`);

  // `normalized` giữ PII nguyên trạng (fold giữ số/email) — cột này sống qua
  // tầng LONG nên phải redact ngay tại HOT→WARM. Không có query_safe tương
  // đương cho normalized: áp trực tiếp regex PII (Postgres — không lookbehind,
  // dùng \m/\M word boundary).
  // Lưu ý: drizzle sql`` cook escape sequences — \\m trong source = \m tới Postgres.
  const n = await db.execute(sql`
    UPDATE search_traces
       SET normalized = regexp_replace(regexp_replace(regexp_replace(normalized,
              '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '[email]', 'g'),
              '\\m(\\+84|0)[0-9]{8,10}\\M', '[sdt]', 'g'),
              '\\m[0-9]{6,}\\M', '[id]', 'g')
     WHERE created_at < now() - make_interval(days => ${HOT_DAYS})
       AND (normalized ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
         OR normalized ~ '\\m[0-9]{6,}\\M')`);
  const tn = await db.execute(sql`
    UPDATE search_traces
       SET trace = jsonb_set(trace, '{normalized}', to_jsonb(
              regexp_replace(regexp_replace(regexp_replace(trace->>'normalized',
              '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '[email]', 'g'),
              '\\m(\\+84|0)[0-9]{8,10}\\M', '[sdt]', 'g'),
              '\\m[0-9]{6,}\\M', '[id]', 'g')))
     WHERE created_at < now() - make_interval(days => ${HOT_DAYS})
       AND trace IS NOT NULL
       AND (trace->>'normalized' ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
         OR trace->>'normalized' ~ '\\m[0-9]{6,}\\M')`);

  // LONG: xóa payload trace JSONB — aggregates cột + interactions giữ lại
  const tr = await db.execute(sql`
    UPDATE search_traces
       SET trace = NULL
     WHERE created_at < now() - make_interval(days => ${WARM_DAYS})
       AND trace IS NOT NULL`);

  // Interactions cũ xóa hẳn
  const i = await db.execute(sql`
    DELETE FROM search_interactions
     WHERE created_at < now() - make_interval(days => ${INTERACTION_DAYS})`);

  console.log(
    `retention: query→safe ${q.rowCount ?? 0} · trace.query→safe ${t.rowCount ?? 0} · normalized→safe ${n.rowCount ?? 0} · trace.normalized→safe ${tn.rowCount ?? 0} · trace JSONB dropped ${tr.rowCount ?? 0} · interactions purged ${i.rowCount ?? 0}`,
  );
  } finally {
    clearTimeout(kill);
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
  await pool.end();
}

main().catch(async (e) => {
  console.error("retention failed", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
