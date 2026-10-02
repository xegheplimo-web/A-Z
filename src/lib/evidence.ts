// ---------------------------------------------------------------------------
// VietScope · Evidence & Verification
// claim → source → passage → quote offsets (ký tự trong nội dung nguồn).
// Deterministic: token/number overlap, không dùng LLM.
// ---------------------------------------------------------------------------
import { normalize, tokenize } from "./vi";
import type { DocDTO } from "@/core/contract";
import type { AnswerBlock } from "./answer";

export interface PassageHit {
  text: string;
  start: number;
  end: number;
  score: number;
}

/** Tách nội dung thành câu kèm offset ký tự */
export function splitPassages(content: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const rx = /[\s\S]+?(?:[.!?](?=\s+[A-ZĐÀ-Ỹ“"(0-9])|$)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(content)) !== null) {
    if (m[0].length === 0) {
      rx.lastIndex++;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.length > 0) out.push({ text, start: m.index + lead, end: m.index + lead + text.length });
  }
  return out;
}

function claimTokens(text: string): { words: string[]; numbers: string[] } {
  const clean = text.replace(/\[\d+\]/g, " ");
  const numbers = [...new Set((normalize(clean).match(/\d+/g) ?? []).filter((n) => n.length >= 2))];
  const words = [...new Set(tokenize(clean).filter((t) => t.length > 2 && !/^\d+$/.test(t)))];
  return { words, numbers };
}

/** Passage khớp nhất với một claim */
export function bestPassage(claim: string, content: string): PassageHit | null {
  const { words, numbers } = claimTokens(claim);
  if (words.length + numbers.length === 0) return null;
  let best: PassageHit | null = null;
  for (const p of splitPassages(content)) {
    const hay = normalize(p.text);
    const hitW = words.filter((w) => hay.includes(w)).length;
    const hitN = numbers.filter((n) => hay.includes(n)).length;
    const denom = words.length + numbers.length * 2;
    const score = denom ? (hitW + hitN * 2) / denom : 0;
    if (!best || score > best.score) best = { ...p, score };
  }
  return best;
}

/** SUPPORTED: có passage đỡ · PARTIAL: có liên quan nhưng chưa đủ · UNSUPPORTED: không có bằng chứng · CONTRADICTED: cùng chủ đề nhưng số liệu khác nguồn */
export type ClaimStatus = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "CONTRADICTED";

export interface ClaimCheck {
  claimId: string;
  status: ClaimStatus;
  blockIndex: number;
  text: string;
  citations: number[];
  supported: boolean;
  /** cách xác minh: passage trong nguồn, dữ liệu canonical, hay không có bằng chứng */
  via: "passage" | "canonical" | "system" | "none";
  score: number;
  source: number | null;
  passage: { start: number; end: number; text: string } | null;
}

export interface Verification {
  claims: ClaimCheck[];
  verifiedRatio: number;
  citationPrecision: number;
  citationCoverage: number;
  unsupportedClaims: number;
}

const SUPPORT_THRESHOLD = 0.26;
const UNION_THRESHOLD = 0.62;

function unionCoverage(claim: string, docs: DocDTO[]): number {
  const { words, numbers } = claimTokens(claim);
  const denom = words.length + numbers.length * 2;
  if (!denom) return 0;
  const hay = normalize(docs.map((d) => `${d.title} ${d.snippet} ${d.content}`).join(" "));
  const hit = words.filter((w) => hay.includes(w)).length + numbers.filter((n) => hay.includes(n)).length * 2;
  return hit / denom;
}

function blockClaimText(b: AnswerBlock): string {
  if (b.kind === "table" && b.table) return b.table.rows.map((r) => r.join(" ")).join(". ");
  return b.text ?? "";
}

/** Gán nhãn trạng thái cho một claim. Claim đã `supported` luôn là SUPPORTED. */
function classify(c: Omit<ClaimCheck, "claimId" | "status">, docs: DocDTO[]): ClaimStatus {
  if (c.supported) return "SUPPORTED";
  if (c.via === "none" && c.citations.length === 0) return "UNSUPPORTED";
  const cited = c.citations.map((n) => docs[n - 1]).filter(Boolean);
  const { words, numbers } = claimTokens(c.text);
  const hay = normalize(cited.map((d) => `${d.title} ${d.snippet} ${d.content}`).join(" "));
  const wordCov = words.length ? words.filter((w) => hay.includes(w)).length / words.length : 0;
  const docNums = new Set((hay.match(/\d+/g) ?? []).filter((n) => n.length >= 2));
  // cùng chủ đề (≥50% từ khoá trùng) nhưng KHÔNG con số nào của claim xuất hiện trong nguồn trích dẫn
  if (numbers.length > 0 && docNums.size > 0 && !numbers.some((n) => docNums.has(n)) && wordCov >= 0.5) return "CONTRADICTED";
  return Math.max(c.score, wordCov * 0.5) >= 0.15 ? "PARTIAL" : "UNSUPPORTED";
}

/** Đối chiếu từng block của câu trả lời với nội dung nguồn được trích dẫn */
export function verifyAnswer(blocks: AnswerBlock[], docs: DocDTO[], intent: string): Verification {
  const raw: Omit<ClaimCheck, "claimId" | "status">[] = [];
  blocks.forEach((b, i) => {
    const text = blockClaimText(b);
    const cites = [...new Set(b.citations ?? [])].filter((n) => n >= 1 && n <= docs.length);
    const base = { blockIndex: i, text, citations: cites, source: null, passage: null, score: 0 };

    if (b.supported === false) {
      raw.push({ ...base, supported: false, via: "none" });
      return;
    }
    // địa điểm/địa giới: bằng chứng là dữ liệu canonical (Places / Admin Graph), không phải đoạn văn
    if (intent === "local_search" && b.kind === "paragraph") {
      raw.push({ ...base, supported: true, via: "canonical", score: 1 });
      return;
    }
    if (b.kind === "callout" && cites.length === 0) {
      raw.push({ ...base, supported: true, via: "system", score: 1 });
      return;
    }
    if (cites.length === 0) {
      raw.push({ ...base, supported: false, via: "none" });
      return;
    }
    let top: { n: number; hit: PassageHit } | null = null;
    for (const n of cites) {
      const d = docs[n - 1];
      const hit = bestPassage(text, `${d.title}. ${d.snippet} ${d.content}`);
      if (hit && (!top || hit.score > top.hit.score)) top = { n, hit };
    }
    // claim tổng hợp từ nhiều câu/nguồn: chấp nhận nếu phần lớn từ khoá/số liệu xuất hiện trong tập nguồn trích dẫn
    const union = unionCoverage(text, cites.map((n) => docs[n - 1]));
    if (top && top.hit.score < SUPPORT_THRESHOLD && union >= UNION_THRESHOLD) {
      raw.push({ ...base, supported: true, via: "passage", score: Math.round(union * 100) / 100, source: top.n, passage: { start: top.hit.start, end: top.hit.end, text: top.hit.text } });
      return;
    }
    if (top && top.hit.score >= SUPPORT_THRESHOLD) {
      raw.push({
        ...base,
        supported: true,
        via: "passage",
        score: Math.round(top.hit.score * 100) / 100,
        source: top.n,
        passage: { start: top.hit.start, end: top.hit.end, text: top.hit.text },
      });
    } else if (b.kind === "callout") {
      raw.push({ ...base, supported: true, via: "system", score: top?.hit.score ?? 0 });
    } else {
      raw.push({ ...base, supported: false, via: "none", score: top?.hit.score ?? 0, source: top?.n ?? null });
    }
  });

  const claims: ClaimCheck[] = raw.map((c, i) => ({ ...c, claimId: `c${i + 1}`, status: classify(c, docs) }));
  const total = claims.length || 1;
  const cited = claims.filter((c) => c.citations.length > 0);
  const citedOk = cited.filter((c) => c.supported).length;
  return {
    claims,
    verifiedRatio: claims.filter((c) => c.supported).length / total,
    citationPrecision: cited.length ? citedOk / cited.length : 1,
    citationCoverage: cited.length / total,
    unsupportedClaims: claims.filter((c) => !c.supported).length,
  };
}

/** Dạng wire (snake_case) của claim: claim_id · status · source · passage(start,end) — ổn định cho API/dataset */
export function claimsToWire(claims: ClaimCheck[]) {
  return claims.map((c) => ({
    claim_id: c.claimId,
    status: c.status,
    block: c.blockIndex,
    text: c.text,
    supported: c.supported,
    via: c.via,
    score: c.score,
    citations: c.citations,
    source: c.source,
    passage: c.passage ? { start_offset: c.passage.start, end_offset: c.passage.end, text: c.passage.text } : null,
  }));
}

/** Điều/Khoản xuất hiện trong passage (cho legal citations) */
export function extractArticle(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(Điều\s+\d+[a-z]?(?:\s*,?\s*Khoản\s+\d+)?)/i);
  return m ? m[1] : null;
}

/** Passages theo nguồn cho /v1/evidence */
export function passagesFor(query: string, docs: DocDTO[], maxPerSource = 2, maxTotal = 8) {
  const { words, numbers } = claimTokens(query);
  const out: {
    source: number;
    title: string;
    url: string;
    domain: string;
    start: number;
    end: number;
    text: string;
    score: number;
  }[] = [];
  docs.forEach((d, idx) => {
    const full = d.content || d.snippet;
    const scored = splitPassages(full)
      .map((p) => {
        const hay = normalize(p.text);
        const hit = words.filter((w) => hay.includes(w)).length + numbers.filter((n) => hay.includes(n)).length * 2;
        return { ...p, score: hit / Math.max(1, words.length + numbers.length * 2) };
      })
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerSource);
    for (const p of scored) {
      out.push({
        source: idx + 1,
        title: d.title,
        url: d.url,
        domain: d.domain,
        start: p.start,
        end: p.end,
        text: p.text,
        score: Math.round(p.score * 100) / 100,
      });
    }
  });
  return out.sort((a, b) => b.score - a.score).slice(0, maxTotal);
}
