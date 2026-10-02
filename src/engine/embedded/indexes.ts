// ---------------------------------------------------------------------------
// Index cho engine tham chiếu — idempotent, chạy 1 lần/process.
// Vì sao có file này: candidate generation đã nằm ở SQL, cần index để không seq-scan.
// (Production dùng PostGIS GiST + OpenSearch; đây chỉ là bản tương đương cho Postgres thuần.)
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { sql } from "drizzle-orm";

let ready: Promise<void> | null = null;

export function ensureIndexes(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const ddl = [
        sql`create index if not exists places_province_idx on places (province_id)`,
        sql`create index if not exists places_category_idx on places (category)`,
        sql`create index if not exists places_commune_idx on places (commune_id)`,
        sql`create index if not exists places_latlng_idx on places (lat, lng)`,
        sql`create index if not exists documents_source_type_idx on documents (source_type)`,
        // index FTS nay khai báo trong schema (cột fts sinh sẵn + documents_fts_gin_idx); bỏ index biểu thức cũ nếu còn
        sql`drop index if exists documents_fts_idx`,
        sql`create index if not exists place_candidates_status_idx on place_candidates (status, province_id)`,
      ];
      for (const q of ddl) await db.execute(q);
    })().catch((e) => {
      ready = null; // thử lại lần sau, không chặn truy vấn
      console.error("ensureIndexes failed", e);
    });
  }
  return ready;
}
