import "dotenv/config";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db";
import { getBackend } from "../src/core/backend";
import type { ObservationInput } from "../src/core/pilot";

/** Bounded worker for supplied, legally collected exports. Does not scrape or fabricate observations. */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npx tsx scripts/pilot-import.ts observations.jsonl [job-id]");
  const raw = await readFile(file, "utf8");
  if (raw.length > 1_000_000) throw new Error("Maximum batch size: 1 MB / 200 observations.");
  const rows = (raw.trim().startsWith("[") ? JSON.parse(raw) : raw.trim().split(/\n+/).map(line=>JSON.parse(line))) as ObservationInput[];
  const backend = await getBackend();
  if (!backend.capabilities.pilot || !backend.pilotCommand) throw new Error(`Selected backend ${backend.id} does not implement pilot writes; refusing embedded fallback.`);
  const actor = process.env.PILOT_WORKER_ID ?? "pilot-cli";
  const jobId = process.argv[3];
  const lease = jobId ? await backend.pilotCommand({action:"claim",jobId},actor) as {leaseToken:string} : null;
  const result = await backend.pilotCommand({action:"ingest",observations:rows,jobId,leaseToken:lease?.leaseToken},actor);
  console.log(JSON.stringify(result,null,2));
}
main().then(()=>pool.end()).catch(async e=>{console.error(e.message);await pool.end();process.exit(1);});
