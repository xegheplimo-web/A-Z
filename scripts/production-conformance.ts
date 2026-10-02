import assert from "node:assert/strict";
import { fromWire } from "../src/core/wire";

const coreUrl = (process.env.SEARCH_ROUTER_URL ?? "http://127.0.0.1:8888").replace(/\/+$/, "");
const coreKey = process.env.SEARCH_ROUTER_API_KEY?.trim();
const coreHeaders: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
if (coreKey) coreHeaders.authorization = `Bearer ${coreKey}`;

const cases = [
  ["quán giò chả Yên Dũng", "giò chả"],
  ["quán cafe Yên Dũng Neo", "cà phê"],
  ["cửa hàng sắt Tân An", "sắt thép"],
  ["cửa hàng bách hóa Yên Dũng", "tạp hóa"],
  ["nhà thuốc gần Neo", "nhà thuốc"],
] as const;

async function post(body: Record<string, unknown>) {
  return fetch(`${coreUrl}/v1/retrieve`, {
    method: "POST",
    headers: coreHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
}

async function main() {
  process.env.RETRIEVAL_BACKEND = "search-router";
  process.env.SEARCH_ROUTER_URL = coreUrl;
  delete process.env.RETRIEVAL_FALLBACK;

  const healthResponse = await fetch(`${coreUrl}/v1/health`, { headers: coreHeaders, signal: AbortSignal.timeout(10_000) });
  assert.equal(healthResponse.status, 200, "search-router /v1/health must be reachable");
  const health = (await healthResponse.json()) as { status?: string; services?: Record<string, string> };
  assert.ok(health.status === "ok" || health.status === "degraded");
  if (process.env.PRODUCTION_REQUIRE_INFRA !== "false") {
    for (const dependency of ["searxng", "opensearch", "qdrant"]) {
      assert.equal(health.services?.[dependency], "ok", `${dependency} must be healthy in the production profile`);
    }
  }

  for (const [query, specialty] of cases) {
    const response = await post({ contract_version: "1", query, mode: "fast", max_results: 10, evidence: "off", record: false });
    assert.equal(response.status, 200, `${query}: production core returned ${response.status}`);
    const wire = await response.json();
    const result = fromWire(wire, "search-router");
    assert.equal(result.backend, "search-router");
    assert.equal(result.understanding.intent, "local_search", `${query}: intent mismatch`);
    assert.equal(result.understanding.specialty, specialty, `${query}: specialty mismatch`);
    assert.ok(result.timings.total_ms >= 0, `${query}: timings missing`);
    console.log(`✓ contract ${query} → ${result.understanding.intent}/${result.understanding.specialty}`);
  }

  // Schema and error semantics are part of the cross-language contract.
  assert.equal((await post({ contract_version: "2", query: "x" })).status, 422, "unknown contract version must be 422");
  assert.equal((await post({ contract_version: "1", query: " " })).status, 422, "blank query must be 422");
  assert.equal((await post({ contract_version: "1", query: "x", max_results: 31 })).status, 422, "max_results overflow must be 422");

  // Exercise the actual TypeScript adapter over HTTP, not a reference server.
  const { getBackend } = await import("../src/core/backend");
  const backend = await getBackend();
  assert.equal(backend.id, "search-router");
  const viaAdapter = await backend.retrieve({ query: cases[0][0], mode: "fast", maxResults: 3, record: false });
  assert.equal(viaAdapter.backend, "search-router");
  assert.equal(viaAdapter.understanding.specialty, cases[0][1]);
  assert.equal(typeof viaAdapter.timings.network_ms, "number");
  assert.notEqual((globalThis as Record<string, unknown>).__vietscope_embedded_loaded, true, "production mode loaded embedded brain");

  console.log("\nPASS production conformance: live Python core → Contract v1 → TypeScript adapter; embedded was not loaded.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
