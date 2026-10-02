import { backendKind, getBackend } from "@/core/backend";
import { authEnabled } from "@/lib/auth";
import { inferenceConfig, inferenceHealth } from "@/lib/inference";
import { traceStats } from "@/lib/traces";
import { guard } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /v1/providers — retrieval backend đang dùng (MỘT), Inference Engine, auth, trace/flywheel. */
export const GET = guard(async () => {
  const backend = await getBackend();
  const [desc, llmHealth, traces, auth] = await Promise.all([backend.describe(), inferenceHealth(), traceStats(), authEnabled()]);
  const llm = inferenceConfig();
  return Response.json({
    model: "vietscope-1",
    retrieval_backend: {
      id: backend.id,
      selected_by: "RETRIEVAL_BACKEND",
      kind: backendKind(),
      capabilities: backend.capabilities,
      fallback: process.env.RETRIEVAL_FALLBACK?.trim() || null,
      note: desc.note ?? null,
      contract: "docs/retrieve.contract.md (v1)",
    },
    auth: { enabled: auth, store: "postgres (sha256)", rate_limit: "postgres fixed-window (dùng chung giữa instance)" },
    providers: desc.lanes,
    inference: {
      engine: llm ? `llm:${llm.models.synthesizer}` : "extractive",
      configured: !!llm,
      base_url: llm?.baseUrl ?? null,
      backend: llmHealth.backend,
      roles: llm?.models ?? null,
      timeout_ms: llm?.timeoutMs ?? null,
      max_retries: llm?.maxRetries ?? null,
      health: { ok: llmHealth.ok, ms: llmHealth.ms, served_models: llmHealth.served_models, detail: llmHealth.detail ?? null },
      breaker: llmHealth.breaker,
      profiles: {
        A: "API ngoài (vd Qwen3.8-Flash-Next qua endpoint OpenAI-compatible) — không chiếm GPU, đổi model bất kỳ lúc nào",
        B: "llama.cpp local: model 20–35B quant cho 24 GB VRAM — LLM_BASE_URL=http://127.0.0.1:8080/v1",
        C: "vLLM máy lớn: Flash-Next + MTP speculative decoding — LLM_BASE_URL=http://vllm:8000/v1",
      },
      note: "Inference Engine thay thế được. Chưa cấu hình → synthesizer extractive deterministic; retrieval/routing/ranking/verification không đổi. mtp-*.gguf chỉ là draft head tăng tốc, không phải model chính.",
    },
    flywheel: { ...(desc.flywheel ?? {}), traces },
    mcp: { endpoint: "/mcp", tools: ["vietscope_retrieve"], sessions: "stateless (HMAC)" },
  });
});
