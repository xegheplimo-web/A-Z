// ---------------------------------------------------------------------------
// VietScope · Vietnamese language core
// Deterministic, không dùng LLM: unaccent, normalize, tokenize, synonym,
// geo-distance, giờ mở cửa theo Asia/Ho_Chi_Minh.
// ---------------------------------------------------------------------------

const VI_DIACRITICS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const bases: Record<string, string> = {
    a: "áàảãạăắằẳẵặâấầẩẫậ",
    e: "éèẻẽẹêếềểễệ",
    i: "íìỉĩị",
    o: "óòỏõọôốồổỗộơớờởỡợ",
    u: "úùủũụưứừửữự",
    y: "ýỳỷỹỵ",
    d: "đ",
  };
  for (const [base, chars] of Object.entries(bases)) {
    map[base] = base;
    for (const c of chars) map[c] = base;
    map[base.toUpperCase()] = base;
    for (const c of chars) map[c.toUpperCase()] = base;
  }
  return map;
})();

/** Bỏ dấu tiếng Việt: "Yên Dũng" -> "yen dung" */
export function unaccent(input: string): string {
  let out = "";
  for (const ch of input) out += VI_DIACRITICS[ch] ?? ch;
  // chuẩn hoá thêm các biến thể có dấu tổ hợp phổ biến
  return out.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

/** Chuẩn hoá để so khớp: lowercase, bỏ dấu, gom khoảng trắng, bỏ ký tự lạ */
export function normalize(input: string): string {
  return unaccent(input)
    .toLowerCase()
    .replace(/[.,;:!?'"“”‘’()\[\]{}|/\\_@#$%^&*+=<>~`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tách token, bỏ stopword tiếng Việt */
/**
 * Stopword TỐI GIẢN — chỉ gồm hư từ thuần ngữ pháp.
 * Cố ý KHÔNG bỏ những chữ dễ trùng với tên riêng/món hàng khi mất dấu:
 *   "thế"→thê (bánh phu thê), "là"→Lã, "mình"→Minh, "đâu"→dầu, "của"→cua,
 *   "cho"→chợ, "cần"→Cần Thơ, "ngon/rẻ/đẹp" (tín hiệu ý định).
 */
const STOPWORDS = new Set(
  [
    "ở", "tại", "của", "và", "với", "hoặc", "thì", "mà", "là", "có", "còn", "để",
    "những", "các", "một", "vài", "không", "được", "muốn", "cần", "tìm", "kiếm",
    "xem", "hỏi", "bao", "nhiêu", "thông", "tin", "về", "này", "kia", "đó",
    "gần", "đây", "khu", "vực", "vùng", "miền", "xin", "hãy", "nhé", "nhỉ", "ơi", "ạ",
  ].map((w) => normalize(w))
);

export function tokenize(input: string): string[] {
  return normalize(input)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Tạo bigram từ danh sách token để bắt cụm như "gio cha", "may khoan" */
export function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

/** n-gram (1..max từ) — bắt cụm chuyên ngành dài như "vat lieu xay dung", "banh da cua" */
export function ngrams(tokens: string[], max = 4): string[] {
  const out: string[] = [];
  for (let n = 1; n <= max; n++) {
    for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

/** Slug tiếng Việt không dấu: "Yên Dũng" -> "yen-dung" */
export function slugify(input: string): string {
  return normalize(input).replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Từ đồng nghĩa / biến thể viết tắt — "cà phê = ca phe = cafe = coffee"
// ---------------------------------------------------------------------------
export const SYNONYMS: Record<string, string[]> = {
  "ca phe": ["cafe", "coffee", "cf", "ca phe"],
  "pho": ["phở", "pho"],
  "bun cha": ["bun cha"],
  "gio cha": ["cha lua", "gio lua", "gio cha"],
  "banh mi": ["banh my", "banh mi"],
  "banh cuon": ["banh cuon"],
  "com": ["com bui", "com binh dan"],
  "quan nhau": ["nhau", "quan nhau", "bia hoi", "bia tuoi"],
  "tap hoa": ["tap hoa", "cua hang tap hoa"],
  "cay xang": ["tram xang", "cay xang", "xang dau"],
  "quan net": ["cyber", "quan net", "phong net", "internet"],
  "nha nghi": ["nha nghi", "khach san", "motel", "homestay"],
  "sua xe": ["sua xe", "sua chua xe", "va xe"],
  "cat toc": ["cat toc", "toc", "barber", "salon"],
  "vat lieu xay dung": ["vlxd", "vat lieu xay dung", "sat thep"],
  "dien nuoc": ["dien nuoc", "dien lanh", "sua dien"],
  "may khoan": ["may khoan", "khoan", "dung cu dien", "dung cu cam tay"],
  "nha thuoc": ["nha thuoc", "pharmacy"],
  "tiem vang": ["tiem vang", "vang bac"],
  "cho": ["cho", "dau moi"],
  "an dem": ["an dem", "an khuya", "qua dem"],
  "sai gon": ["sai gon", "tp hcm", "tphcm", "ho chi minh", "ho chi minh city", "tp ho chi minh"],
};

/**
 * Mở rộng cụm từ theo từ đồng nghĩa (matching không dấu).
 * matchExact: chỉ khớp nguyên cụm (dùng cho specialty detection);
 * mặc định chấp nhận substring nhưng yêu cầu mặt ngắn ≥ 4 ký tự
 * (tránh "gio" → "gio cha", "fe" → "cafe", "dien" → "dien nuoc").
 */
export function expandSynonyms(terms: string[], matchExact = false): string[] {
  const out = new Set(terms);
  for (const term of terms) {
    if (term.length < 2) continue;
    for (const [canon, variants] of Object.entries(SYNONYMS)) {
      const all = [canon, ...variants.map(normalize)];
      const hit = all.some((v) => {
        if (!v) return false;
        if (term === v) return true;
        if (matchExact) return false;
        const short = Math.min(term.length, v.length);
        if (short < 4) return false;
        return term.includes(v) || v.includes(term);
      });
      if (hit) {
        out.add(canon);
        variants.forEach((v) => out.add(normalize(v)));
      }
    }
  }
  return [...out].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Địa lý: haversine km
// ---------------------------------------------------------------------------
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number | null | undefined): string | null {
  if (km == null || Number.isNaN(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km)} km`;
}

// ---------------------------------------------------------------------------
// Giờ mở cửa theo Asia/Ho_Chi_Minh — "hours": "05:30–19:00" | "24/7"
// ---------------------------------------------------------------------------
export function vnNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}

export function isOpenNow(hours: string | null | undefined, open24?: boolean | null): boolean | null {
  if (open24) return true;
  if (!hours) return null;
  const m = hours.match(/(\d{1,2})[:h](\d{2})\s*[–\-—]\s*(\d{1,2})[:h](\d{2})/);
  if (!m) return null;
  const now = vnNow();
  const cur = now.getHours() * 60 + now.getMinutes();
  const open = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const close = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  if (close <= open) return cur >= open || cur < close; // qua đêm
  return cur >= open && cur < close;
}

// ---------------------------------------------------------------------------
// Độ tươi (freshness) của tài liệu
// ---------------------------------------------------------------------------
export function freshnessLabel(d: Date | string | null | undefined): string {
  if (!d) return "Không rõ thời gian";
  const t = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - t.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Vừa xong";
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} ngày trước`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} tháng trước`;
  return `${Math.floor(mo / 12)} năm trước`;
}

/** Điểm tươi 0..1, phân rã theo nửa đời `halfLifeDays` */
export function freshnessScore(d: Date | string | null | undefined, halfLifeDays = 14): number {
  if (!d) return 0.2;
  const t = typeof d === "string" ? new Date(d) : d;
  const ageDays = Math.max(0, (Date.now() - t.getTime()) / 86400000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
