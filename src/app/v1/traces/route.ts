import { db } from "@/db";
import { searchTraces, feedback } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { gate } from "@/lib/auth";
import { exportTraces, traceStats } from "@/lib/traces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /v1/traces — training traces (§11) + thống kê.
 *   ?stats=1        chỉ trả thống kê
 *   ?id=<uuid>      trả toàn bộ vết của một trace (plan, providers, evidence, citations…)
 *   ?limit=50&full=1  xuất vết đầy đủ để dựng dataset VietScope-LM
 */
export async function GET(req: Request) {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const stats = await traceStats();
  if (url.searchParams.get("stats") === "1") return Response.json({ stats });

  const id = url.searchParams.get("id");
  if (id) {
    const [row] = await db.select().from(searchTraces).where(eq(searchTraces.id, id)).limit(1);
    if (!row) return Response.json({ error: { message: "trace not found", type: "not_found" } }, { status: 404 });
    const fb = await db.select().from(feedback).where(eq(feedback.traceId, id));
    return Response.json({ trace: row, feedback: fb });
  }

  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const full = url.searchParams.get("full") === "1";
  const rows = await exportTraces(limit);
  return Response.json({
    stats,
    count: rows.length,
    traces: rows.map((r) =>
      full
        ? r
        : {
            id: r.id,
            query: r.query,
            intent: r.intent,
            specialty: r.specialty,
            budget: r.budget,
            synthesizer: r.synthesizer,
            confidence: r.confidence,
            verified_ratio: r.verifiedRatio,
            latency_ms: r.latencyMs,
            coverage_gap: r.coverageGap,
            exact: r.exactCount,
            created_at: r.createdAt,
          }
    ),
  });
}
