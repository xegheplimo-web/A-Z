// ---------------------------------------------------------------------------
// Kiểm tra ranh giới kiến trúc: CHỈ MỘT retrieval brain tại runtime.
//   node scripts/check-boundaries.mjs
// Quy tắc:
//   R1  facade (src/app, src/lib, src/components, src/core) không import engine embedded
//       — ngoại lệ DUY NHẤT: src/core/backend.ts (dynamic import có chủ đích)
//   R2  facade không đọc bảng của brain (admin_units, places, place_candidates, documents, coverage_gaps)
//   R3  engine search-router không import engine embedded (và ngược lại)
//   R4  engine không import UI (src/app, src/components)
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src", import.meta.url));
const BRAIN_TABLES = ["adminUnits", "places", "placeCandidates", "documents", "coverageGaps", "legalEntities", "placeObservations", "fieldProvenance", "coverageCells", "coverageJobs"];
const FACADE_DIRS = ["app", "lib", "components", "core"];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

const importRx = /(?:import|export)\s+(?:type\s+)?(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const violations = [];

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  const top = rel.split("/")[0];
  const isFacade = FACADE_DIRS.includes(top);
  const isEmbedded = rel.startsWith("engine/embedded/");
  const isRouterAdapter = rel.startsWith("engine/search-router/");
  const src = readFileSync(file, "utf8");
  let m;
  importRx.lastIndex = 0;
  while ((m = importRx.exec(src)) !== null) {
    const spec = m[2] ?? m[3];
    const names = m[1] ?? "";
    if (!spec) continue;
    const resolved = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? relative(ROOT, join(file, "..", spec)) : spec;
    const toEmbedded = resolved.startsWith("engine/embedded");

    if (isFacade && toEmbedded && rel !== "core/backend.ts") violations.push(`R1  ${rel}: facade import engine embedded (“${spec}”)`);
    if (isFacade && resolved === "db/schema") {
      const used = BRAIN_TABLES.filter((t) => new RegExp(`\\b${t}\\b`).test(names));
      if (used.length) violations.push(`R2  ${rel}: facade đọc bảng của brain: ${used.join(", ")}`);
    }
    if (isRouterAdapter && toEmbedded) violations.push(`R3  ${rel}: search-router adapter import engine embedded`);
    if (isEmbedded && resolved.startsWith("engine/search-router")) violations.push(`R3  ${rel}: embedded import search-router adapter`);
    if ((isEmbedded || isRouterAdapter) && (resolved.startsWith("app/") || resolved.startsWith("components/"))) violations.push(`R4  ${rel}: engine import UI (“${spec}”)`);
  }
}

if (violations.length) {
  console.error(`✗ ${violations.length} vi phạm ranh giới:\n` + violations.map((v) => "  " + v).join("\n"));
  process.exit(1);
}
console.log("✓ ranh giới sạch: facade ↔ brain chỉ giao tiếp qua src/core (contract + backend)");
