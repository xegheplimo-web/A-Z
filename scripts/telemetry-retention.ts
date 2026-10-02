// ---------------------------------------------------------------------------
// Telemetry retention (P-LEARNING) — thực thi 3 tầng lưu trữ. Chạy định kỳ:
//   npx tsx scripts/telemetry-retention.ts
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

async function main() {
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
    `retention: query→safe ${q.rowCount ?? 0} · trace.query→safe ${t.rowCount ?? 0} · trace JSONB dropped ${tr.rowCount ?? 0} · interactions purged ${i.rowCount ?? 0}`,
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error("retention failed", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
