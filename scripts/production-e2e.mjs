import assert from "node:assert/strict";

const appUrl = (process.env.VIETSCOPE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const coreUrl = (process.env.SEARCH_ROUTER_URL ?? "http://127.0.0.1:8888").replace(/\/+$/, "");
const apiKey = process.env.VIETSCOPE_API_KEY ?? process.env.VIETSCOPE_API_KEYS?.split(",")[0]?.trim() ?? "";
const degradedOnly = process.argv.includes("--degraded-only");

const jsonHeaders = (auth = true) => ({
  "content-type": "application/json",
  accept: "application/json",
  ...(auth && apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
});

async function json(response, label, status = 200) {
  const text = await response.text();
  assert.equal(response.status, status, `${label}: HTTP ${response.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    assert.fail(`${label}: response is not JSON: ${text.slice(0, 400)}`);
  }
}

async function post(base, path, body, auth = true) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: jsonHeaders(auth),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40_000),
  });
}

async function providerDegradation() {
  const response = await post(coreUrl, "/v1/retrieve", {
    contract_version: "1",
    query: "quán giò chả Yên Dũng",
    mode: "fast",
    max_results: 5,
    evidence: "off",
    record: false,
  }, false);
  const body = await json(response, "degraded provider retrieve");
  assert.equal(body.backend, "search-router");
  assert.ok(body.coverage && typeof body.coverage.gap === "boolean");
  assert.ok(
    body.federation.some((item) => ["error", "timeout", "circuit_open"].includes(item.status)),
    `provider outage was not represented as a bounded degradation: ${JSON.stringify(body.federation)}`,
  );
  console.log("✓ provider outage degrades inside search-router without replacing the brain or returning 5xx");
}

async function main() {
  if (degradedOnly) return providerDegradation();

  const direct = await json(await post(coreUrl, "/v1/retrieve", {
    contract_version: "1",
    query: "quán giò chả Yên Dũng",
    mode: "fast",
    evidence: "off",
    record: false,
  }, false), "direct /v1/retrieve");
  assert.equal(direct.backend, "search-router");
  assert.equal(direct.contract_version, "1");
  console.log("✓ direct production retrieval brain");

  if (apiKey) {
    await json(await post(appUrl, "/v1/search", { query: "test auth" }, false), "facade auth", 401);
    console.log("✓ facade auth rejects missing Bearer key");
  }

  const retrieve = await json(await post(appUrl, "/v1/retrieve", {
    query: "quán giò chả Yên Dũng",
    mode: "fast",
    evidence: "off",
  }), "facade /v1/retrieve");
  assert.equal(retrieve.model, "vietscope-1");
  assert.equal(retrieve.backend, "search-router");
  assert.ok(Array.isArray(retrieve.results));
  console.log("✓ facade /v1/retrieve → search-router");

  const search = await json(await post(appUrl, "/v1/search", {
    query: "cửa hàng sắt Tân An",
    mode: "fast",
  }), "facade /v1/search");
  assert.equal(search.backend, "search-router");
  assert.ok(Array.isArray(search.results));
  console.log("✓ facade /v1/search");

  const placesResponse = await fetch(`${appUrl}/v1/places/search?q=${encodeURIComponent("nhà thuốc gần Neo")}`, {
    headers: jsonHeaders(),
    signal: AbortSignal.timeout(40_000),
  });
  const places = await json(placesResponse, "facade /v1/places/search");
  assert.equal(places.backend, "search-router");
  assert.ok(places.places && Array.isArray(places.places.exact));
  console.log("✓ facade /v1/places/search");

  const responses = await json(await post(appUrl, "/v1/responses", {
    model: "vietscope-1",
    input: "cửa hàng bách hóa Yên Dũng",
    stream: false,
  }), "facade /v1/responses");
  assert.equal(responses.model, "vietscope-1");
  assert.equal(responses.vietscope?.backend, "search-router");
  console.log("✓ facade /v1/responses");

  const streamResponse = await post(appUrl, "/v1/responses", {
    model: "vietscope-1",
    input: "nhà thuốc gần Neo",
    stream: true,
  });
  assert.equal(streamResponse.status, 200, `stream HTTP ${streamResponse.status}`);
  assert.match(streamResponse.headers.get("content-type") ?? "", /^text\/event-stream/);
  const streamText = await streamResponse.text();
  assert.match(streamText, /data:/);
  assert.match(streamText, /response\.(completed|output_text\.delta)/);
  console.log("✓ Responses API streaming over production brain");

  console.log("\nPASS production E2E: auth + facade APIs + streaming all use search-router.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
