// ---------------------------------------------------------------------------
// VietScope · Budget policy (nội bộ — người dùng không phải chọn)
// FAST → STANDARD → RESEARCH, chọn deterministic theo intent + độ phức tạp.
// ---------------------------------------------------------------------------
import type { QueryUnderstanding } from "./understand";

import type { Budget, ModeInput } from "@/core/contract";
export type { Budget, ModeInput };

export interface BudgetPolicy {
  budget: Budget;
  maxSources: number;
  hubTimeoutMs: number;
  hubMode: "fast" | "balanced" | "deep";
  readEvidence: boolean;
  multiHop: boolean;
  targetMs: string;
  reason: string;
}

const POLICIES: Record<Budget, Omit<BudgetPolicy, "reason">> = {
  fast: { budget: "fast", maxSources: 3, hubTimeoutMs: 3500, hubMode: "fast", readEvidence: false, multiHop: false, targetMs: "1–4s" },
  standard: { budget: "standard", maxSources: 7, hubTimeoutMs: 9000, hubMode: "balanced", readEvidence: true, multiHop: false, targetMs: "4–10s" },
  research: { budget: "research", maxSources: 12, hubTimeoutMs: 45000, hubMode: "deep", readEvidence: true, multiHop: true, targetMs: "20–60s" },
};

const RESEARCH_RX = /(nghien cuu|xu huong|phan tich|bao cao|toan canh|tong quan|du bao|danh gia thi truong|thi truong .* nam 20\d\d|lo trinh|chien luoc)/;


export function chooseBudget(u: QueryUnderstanding, mode: ModeInput = "auto"): BudgetPolicy {
  const forced: Budget | null =
    mode === "fast" ? "fast" : mode === "standard" || mode === "balanced" ? "standard" : mode === "research" || mode === "deep" ? "research" : null;
  if (forced) return { ...POLICIES[forced], reason: `chế độ yêu cầu: ${mode}` };

  if (RESEARCH_RX.test(` ${u.normalized} `) || u.tokens.length >= 16) {
    return { ...POLICIES.research, reason: "câu hỏi nghiên cứu/phức tạp → multi-hop" };
  }
  switch (u.intent) {
    case "local_search":
    case "weather":
    case "market_price":
    case "admin_info":
      return { ...POLICIES.fast, reason: `intent ${u.intent} → dữ liệu canonical/current fact` };
    case "legal":
    case "compare":
    case "product":
    case "news":
      return { ...POLICIES.standard, reason: `intent ${u.intent} → cần đối chiếu nhiều nguồn` };
    default:
      return { ...POLICIES.standard, reason: "tìm kiếm tổng hợp" };
  }
}
