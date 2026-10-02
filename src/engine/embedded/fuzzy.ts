// ---------------------------------------------------------------------------
// VietScope · Fuzzy matching (deterministic, không LLM)
// Bắt lỗi gõ tiếng Việt: "yen dungg" → "Yên Dũng", "cafe yen dun" → Yên Dũng.
// Chỉ dùng làm NGÃ RẼ DỰ PHÒNG sau khi khớp chính xác thất bại, và luôn đánh
// dấu fuzzy=true để UI/ranking biết đây là "gần đúng" chứ không phải exact.
// ---------------------------------------------------------------------------

/** Khoảng cách Levenshtein (có chặn trên để khỏi tính thừa) */
export function editDistance(a: string, b: string, cap = 4): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

/** Ngưỡng sai khác chấp nhận được theo độ dài cụm */
export function fuzzyThreshold(len: number): number {
  if (len < 5) return 0; // cụm quá ngắn: không đoán mò
  if (len <= 8) return 1;
  if (len <= 14) return 2;
  return 3;
}

export interface FuzzyHit<T> {
  value: T;
  matched: string; // chuỗi trong query đã khớp
  target: string; // chuỗi chuẩn trong dữ liệu
  distance: number;
}

/**
 * Dò fuzzy: với mỗi n-gram của query (1..maxWords từ), so với danh sách chuỗi đích.
 * Trả về các hit tốt nhất, đã loại trùng theo đích.
 */
export function fuzzyFind<T>(
  grams: string[],
  targets: { value: T; terms: string[] }[],
  opts: { minLen?: number; maxHits?: number } = {}
): FuzzyHit<T>[] {
  const minLen = opts.minLen ?? 5;
  const out: FuzzyHit<T>[] = [];
  const usedTargets = new Set<T>();
  const usedGrams = new Set<string>();
  // gram dài trước → "huyen yen dung" thắng "yen dung"
  const sorted = [...grams].filter((g) => g.length >= minLen).sort((a, b) => b.length - a.length);
  for (const g of sorted) {
    if (usedGrams.has(g)) continue;
    let best: FuzzyHit<T> | null = null;
    for (const t of targets) {
      if (usedTargets.has(t.value)) continue;
      for (const term of t.terms) {
        if (!term || term.length < minLen) continue;
        const d = editDistance(g, term, fuzzyThreshold(Math.max(g.length, term.length)));
        const th = fuzzyThreshold(Math.max(g.length, term.length));
        if (d > 0 && d <= th && (!best || d < best.distance)) {
          best = { value: t.value, matched: g, target: term, distance: d };
        }
      }
    }
    if (best) {
      out.push(best);
      usedTargets.add(best.value);
      usedGrams.add(g);
      // gram con của hit này coi như đã dùng
      for (const g2 of sorted) if (g2 !== g && g.includes(g2) && best.matched.includes(g2)) usedGrams.add(g2);
      if (out.length >= (opts.maxHits ?? 3)) break;
    }
  }
  return out;
}

/** Sinh n-gram (1..max từ) từ chuỗi đã chuẩn hoá, giữ thứ tự */
export function gramsOf(normalized: string, maxWords = 3): string[] {
  const words = normalized.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let n = Math.min(maxWords, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}
