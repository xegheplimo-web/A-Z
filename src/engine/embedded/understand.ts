// ---------------------------------------------------------------------------
// VietScope · Query Understanding (deterministic — không dùng LLM)
// Hiểu intent, entity, địa danh (kể cả lịch sử/sáp nhập), chuyên ngành,
// freshness, typing-lỗi không dấu của câu hỏi tiếng Việt.
// ---------------------------------------------------------------------------
import { normalize, tokenize, ngrams, expandSynonyms } from "@/lib/vi";
import { fuzzyFind, gramsOf } from "./fuzzy";
import type { AdminUnit } from "@/db/schema";

import type { Intent } from "@/core/contract";
export type { Intent };

export interface LocationMatch {
  unit: AdminUnit;
  matchedTerm: string; // cụm người dùng gõ (đã normalize)
  isHistorical: boolean;
  /** khớp gần đúng (typo) thay vì khớp chính xác */
  fuzzy?: boolean;
  fuzzyTarget?: string;
}

export interface QueryUnderstanding {
  raw: string;
  normalized: string;
  tokens: string[];
  intent: Intent;
  intentLabel: string;
  locations: LocationMatch[];
  /** ids đơn vị hành chính HIỆN HÀNH được resolve ra (gồm cả từ đơn vị lịch sử) */
  resolvedCurrentIds: string[];
  /** mô tả transition lịch sử → hiện tại */
  transition: { from: string; to: string[]; date: string | null } | null;
  specialty: string | null; // nhãn chuyên ngành chuẩn: "giò chả"
  specialtyTerms: string[]; // cụm tìm kiếm đã mở rộng đồng nghĩa
  categories: string[]; // category slug để lọc places
  freshness: "today" | "recent" | "any";
  compareTargets: [string, string] | null;
  isVietnamese: boolean;
  /** có địa danh/chuyên ngành suy ra bằng fuzzy (typo) hay không */
  fuzzyUsed: boolean;
  fuzzyNotes: string[];
}

// --- Bộ phát hiện intent ----------------------------------------------------
const RX = {
  compare: /(so sanh|\bvs\b|khac biet|nen chon|cai nao tot hon)/,
  weather: /(thoi+\s?tiet|du bao thoi|thoitiet|nhiet do|co mua khong|troi nang|troi mua)/,
  market:
    /(gia vang|gia xang|gia dau|ty gia|usd|vn ?index|chung khoan|co phieu|bitcoin|lai suat|gia bac|gia heo|gia ca phe thi truong)/,
  legal:
    /(nghi dinh|thong tu|luat |cong van|quyet dinh|chi thi|quy dinh|phap luat|phap lenh|muc phat|xu phat|thue |ho khoan|ho kinh doanh|hoa don|dang ky kinh doanh|nghi quyet \d)/,
  adminInfo:
    /(sap nhap|hop nhat|doi ten|thuoc tinh|tinh nao|huyen nao|xa nao|dia gioi hanh chinh|don vi hanh chinh|chuyen thanh|len tinh|34 tinh)/,
  local:
    /(quan |cua hang|cua hieu|tiem |nha hang|cho |nha thuoc|cay xang|tram xang|sua xe|cat toc|nha nghi|khach san|san bay|ben xe|gan day|o dau|o | ban | mua |an gi|uong gi|ngon|an dem|an sang|an trua)/,
  product: /(danh gia|review|thong so|co tot khong|co nen mua|gia bao nhieu|gia ban|thong tin san pham)/,
  news: /(tin tuc|moi nhat|hom nay|sang nay|hien nay|vua xay ra|nong hoi)/,
};

// --- Định danh chuyên ngành (cụm không dấu → nhãn + category) ---------------
const SPECIALTY_MAP: Record<string, { label: string; categories: string[] }> = {
  "gio cha": { label: "giò chả", categories: ["gio-cha"] },
  "cha lua": { label: "giò chả", categories: ["gio-cha"] },
  "gio lua": { label: "giò chả", categories: ["gio-cha"] },
  "ca phe": { label: "cà phê", categories: ["cafe"] },
  cafe: { label: "cà phê", categories: ["cafe"] },
  coffee: { label: "cà phê", categories: ["cafe"] },
  "tra chanh": { label: "trà chanh", categories: ["cafe"] },
  pho: { label: "phở", categories: ["pho"] },
  "bun cha": { label: "bún chả", categories: ["bun-cha"] },
  "banh cuon": { label: "bánh cuốn", categories: ["banh-cuon"] },
  "banh mi": { label: "bánh mì", categories: ["banh-mi"] },
  "com tam": { label: "cơm tấm", categories: ["com"] },
  com: { label: "cơm bình dân", categories: ["com"] },
  "com rang": { label: "cơm rang", categories: ["com"] },
  "bun bo": { label: "bún bò", categories: ["bun-bo"] },
  "mi quang": { label: "mì Quảng", categories: ["mi-quang"] },
  "banh da cua": { label: "bánh đa cua", categories: ["banh-da-cua"] },
  "com chay": { label: "cơm cháy", categories: ["com-chay"] },
  "cha ca": { label: "chả cá", categories: ["cha-ca"] },
  "banh phu the": { label: "bánh phu thê", categories: ["dac-san"] },
  "phu the": { label: "bánh phu thê", categories: ["dac-san"] },
  "an dem": { label: "ăn đêm", categories: ["an-dem"] },
  "quan nhau": { label: "quán nhậu", categories: ["an-dem"] },
  nhau: { label: "quán nhậu", categories: ["an-dem"] },
  lau: { label: "lẩu", categories: ["an-dem"] },
  "quan net": { label: "quán nét", categories: ["net"] },
  net: { label: "quán nét", categories: ["net"] },
  cyber: { label: "cyber game", categories: ["net"] },
  "tap hoa": { label: "tạp hóa", categories: ["tap-hoa"] },
  "bach hoa": { label: "tạp hóa", categories: ["tap-hoa"] },
  "cay xang": { label: "cây xăng", categories: ["xang-dau"] },
  "tram xang": { label: "trạm xăng", categories: ["xang-dau"] },
  "nha nghi": { label: "nhà nghỉ", categories: ["nha-nghi"] },
  "khach san": { label: "khách sạn", categories: ["nha-nghi"] },
  "sua xe": { label: "sửa xe", categories: ["sua-xe"] },
  "cat toc": { label: "cắt tóc", categories: [] },
  "vat lieu xay dung": { label: "vật liệu xây dựng", categories: ["vlxd"] },
  vlxd: { label: "vật liệu xây dựng", categories: ["vlxd"] },
  "sat thep": { label: "sắt thép", categories: ["vlxd"] },
  sat: { label: "sắt thép", categories: ["vlxd"] },
  "dien nuoc": { label: "điện nước", categories: ["dung-cu-dien"] },
  "may khoan": { label: "máy khoan", categories: ["dung-cu-dien"] },
  "dung cu dien": { label: "dụng cụ điện", categories: ["dung-cu-dien"] },
  "nha thuoc": { label: "nhà thuốc", categories: ["nha-thuoc"] },
};

const KNOWN_TARGETS: Record<string, string> = {
  "vf 8": "VinFast VF 8",
  vf8: "VinFast VF 8",
  "santa fe": "Hyundai Santa Fe",
  santafe: "Hyundai Santa Fe",
  "cx 8": "Mazda CX-8",
  cx8: "Mazda CX-8",
  "everest ": "Ford Everest",
};

/** [cụm có tên địa danh, cụm đã bỏ địa danh] — chỉ dùng khi dò vị trí */
const DISH_QUALIFIERS: [string, string][] = [
  ["bun bo hue", "bun bo"],
  ["cha ca la vong", "cha ca"],
];
const ADMIN_WORDS = new Set(["tinh", "huyen", "xa", "phuong", "tran", "thon", "tp"]);

export function understandQuery(raw: string, units: AdminUnit[]): QueryUnderstanding {
  const normalized = normalize(raw);
  const tokens = tokenize(raw);
  const padded = ` ${normalized} `;
  // Tên món có chứa địa danh ("bún bò Huế") — không để "Huế" bị hiểu là vị trí
  let locPadded = padded;
  for (const [dish, plain] of DISH_QUALIFIERS) locPadded = locPadded.replace(` ${dish} `, ` ${plain} `);

  // --- entity compare targets ------------------------------------------------
  let compareTargets: [string, string] | null = null;
  const foundTargets: string[] = [];
  for (const [key, label] of Object.entries(KNOWN_TARGETS)) {
    if (padded.includes(` ${key.trim()} `) || padded.includes(key)) {
      if (!foundTargets.includes(label)) foundTargets.push(label);
    }
  }
  if (foundTargets.length >= 2) compareTargets = [foundTargets[0], foundTargets[1]];

  // --- vị trí / địa danh -----------------------------------------------------
  const locations: LocationMatch[] = [];
  const usedSpans: string[] = [];
  // sắp xếp cụm dài trước để "huyen yen dung" thắng "yen dung"
  const cands: { unit: AdminUnit; terms: string[] }[] = units
    .map((u) => {
      const short = u.nameSearch.replace(/^(xa|phuong|thi tran) /, "");
      const historicalNameExists = units.some((h) => h.status !== "current" && (h.searchAliases.includes(short) || h.nameSearch.replace(/^(huyen|quan|thi xa) /, "") === short));
      return { unit: u, terms: [u.nameSearch, ...u.searchAliases, ...(u.type === "commune" && !historicalNameExists ? [short] : [])] };
    })
    .sort((a, b) => Math.max(...b.terms.map((t) => t.length)) - Math.max(...a.terms.map((t) => t.length)));

  for (const { unit, terms } of cands) {
    for (const term of terms) {
      if (!term || term.length < 2) continue;
      const needle = ` ${term} `;
      const idx = locPadded.indexOf(needle);
      if (idx === -1) continue;
      // tránh match đè span đã dùng
      if (usedSpans.some((s) => needle.trim().split(" ").every((w) => s.includes(w)) && s.length >= needle.trim().length && unit.type !== "province")) {
        // cho phép province trùng span với commune/district (vd Yên Dũng, Bắc Giang)
      }
      if (!locations.some((l) => l.unit.id === unit.id)) {
        locations.push({ unit, matchedTerm: term, isHistorical: unit.status !== "current" });
        usedSpans.push(term);
      }
      break;
    }
  }
  // dedupe: nếu cùng id xuất hiện nhiều lần → giữ 1
  const seen = new Set<string>();
  let locs = locations.filter((l) => (seen.has(l.unit.id) ? false : (seen.add(l.unit.id), true)));
  // A bare province/city alias (Sài Gòn) must not accidentally become its namesake ward.
  // An explicit "phường Sài Gòn" has a longer matchedTerm and remains specific.
  locs = locs.filter(l => !(l.unit.type === "commune" && locs.some(p => p.unit.type === "province" && p.unit.status === "current" && p.matchedTerm === l.matchedTerm)));

  // NGÃ RẼ DỰ PHÒNG: không khớp địa danh nào → thử fuzzy (typo, thiếu/thừa chữ)
  const fuzzyNotes: string[] = [];
  if (locs.length === 0) {
    const hits = fuzzyFind(
      gramsOf(locPadded.trim(), 3),
      cands.map((c) => ({ value: c.unit, terms: c.terms })),
      { minLen: 5, maxHits: 2 }
    );
    for (const h of hits) {
      locs.push({ unit: h.value, matchedTerm: h.matched, isHistorical: h.value.status !== "current", fuzzy: true, fuzzyTarget: h.target });
      fuzzyNotes.push(`địa danh “${h.matched}” ≈ “${h.value.name}” (sửa ${h.distance} ký tự)`);
    }
  }

  // resolve đồ thị hành chính: lịch sử → hiện tại
  const byId = new Map(units.map((u) => [u.id, u]));
  const resolvedCurrentIds = new Set<string>();
  let transition: QueryUnderstanding["transition"] = null;

  for (const l of locs) {
    const u = l.unit;
    if (u.status === "current") {
      resolvedCurrentIds.add(u.id);
      if (u.type === "commune" && u.parentId) resolvedCurrentIds.add(u.parentId);
      if (u.type === "province") resolvedCurrentIds.add(u.id);
    } else {
      // đơn vị lịch sử
      const toNames: string[] = [];
      for (const cid of u.replacedBy ?? []) {
        const cu = byId.get(cid);
        if (cu) {
          resolvedCurrentIds.add(cid);
          if (cu.parentId) resolvedCurrentIds.add(cu.parentId);
          toNames.push(cu.name);
        }
      }
      if (u.mergedInto) {
        resolvedCurrentIds.add(u.mergedInto);
        const mp = byId.get(u.mergedInto);
        if (mp) toNames.push(mp.name);
      }
      if (!transition) {
        transition = {
          from: `${u.type === "province" ? "Tỉnh" : u.type === "district" ? "" : ""}${u.name}`,
          to: [...new Set(toNames)],
          date: u.mergedDate,
        };
      }
    }
  }

  // A named current commune/alias (Neo, Tân An) narrows a historical district.
  // Never union the district's other descendants back into a specific commune query.
  const specific = locs.filter((l) => l.unit.type === "commune" && l.unit.status === "current");
  if (specific.length) {
    resolvedCurrentIds.clear();
    for (const l of specific) {
      resolvedCurrentIds.add(l.unit.id);
      if (l.unit.parentId) resolvedCurrentIds.add(l.unit.parentId);
    }
  }

  // --- specialty: cụm chuyên ngành dài nhất còn lại --------------------------
  // Loại cụm địa danh khỏi câu, phần còn lại → n-gram (≤4 từ) để dò chuyên ngành
  let remainder = locPadded;
  for (const l of locs) remainder = remainder.replace(` ${l.matchedTerm} `, " ");
  // Không dùng tokenize() ở đây: stopword có thể nuốt một chữ trong tên món
  // ("bánh phu thê" → "banh phu"). Chỉ lọc từ chỉ đơn vị hành chính.
  const restTokens = remainder.trim().split(/\s+/).filter((t) => t.length > 0 && !ADMIN_WORDS.has(t));
  const candidateGrams = [...new Set(ngrams(restTokens, 4))].sort((x, y) => y.length - x.length);

  // --- intent (tính trước để cổng specialty cho đúng ngữ cảnh) ---------------
  const has = (rx: RegExp) => rx.test(padded);
  const isCompare = compareTargets !== null;
  const preWeather = has(RX.weather);
  const preMarket = has(RX.market);
  const preLegal = has(RX.legal);
  const preAdmin = has(RX.adminInfo);
  const preLocal = has(RX.local) || locs.length > 0;
  const preProduct = has(RX.product);

  // --- specialty ---
  let specialty: string | null = null;
  let categories: string[] = [];
  let strongSpecialty = false; // match vòng 1 (cụm chuyên ngành thật trong query)
  // vòng 1: khớp chính xác key chuyên ngành (bigram/unigram nguyên cụm)
  for (const g of candidateGrams) {
    if (SPECIALTY_MAP[g]) {
      specialty = SPECIALTY_MAP[g].label;
      categories = SPECIALTY_MAP[g].categories;
      strongSpecialty = true;
      break;
    }
  }
  // vòng 2: mở rộng đồng nghĩa nhưng vẫn exact-only — chỉ áp dụng khi ngữ cảnh
  // cho phép (local/product), tránh "hóa đơn ĐIỆN tử" → "điện nước"
  if (!specialty && (preLocal || preProduct || isCompare)) {
    const expanded = expandSynonyms(candidateGrams, true);
    for (const g of expanded) {
      if (candidateGrams.includes(g)) continue;
      if (SPECIALTY_MAP[g]) {
        specialty = SPECIALTY_MAP[g].label;
        categories = SPECIALTY_MAP[g].categories;
        break;
      }
    }
  }
  // vòng 3 (dự phòng): fuzzy chuyên ngành — "banh da cuа", "gio chạ" vẫn bắt được
  if (!specialty && (preLocal || preProduct || isCompare)) {
    const fSp = fuzzyFind(
      candidateGrams.filter((g) => g.length >= 5),
      Object.keys(SPECIALTY_MAP).map((k) => ({ value: k, terms: [k] })),
      { minLen: 5, maxHits: 1 }
    );
    if (fSp.length) {
      const key = fSp[0].value;
      specialty = SPECIALTY_MAP[key].label;
      categories = SPECIALTY_MAP[key].categories;
      fuzzyNotes.push(`chuyên ngành “${fSp[0].matched}” ≈ “${specialty}”`);
    }
  }
  // nếu ngữ cảnh không phải local/product → không gắn specialty
  if (!preLocal && !preProduct && !isCompare) {
    if (preWeather || preMarket || preLegal || (preAdmin && !specialty)) {
      if (!candidateGrams.some((g) => g.includes(" ") && SPECIALTY_MAP[g])) {
        specialty = null;
        categories = [];
      }
    }
  }

  const specialtyTerms = specialty
    ? expandSynonyms([...candidateGrams].filter((g) => g.length > 2))
    : [...candidateGrams].filter((g) => g.length > 2);

  // --- intent ----------------------------------------------------------------
  let intent: Intent = "general";
  if (isCompare) intent = "compare";
  else if (preWeather) intent = "weather";
  else if (preMarket) intent = "market_price";
  else if (preLegal) intent = "legal";
  else if (preAdmin && !strongSpecialty) intent = "admin_info";
  else if (specialty && preLocal) intent = "local_search";
  else if (has(RX.local) && locs.length > 0) intent = "local_search";
  else if (preProduct || has(RX.local)) intent = "product";
  else if (has(RX.news)) intent = "news";

  const intentLabel: Record<Intent, string> = {
    local_search: "Tìm địa điểm (Local Search)",
    legal: "Pháp luật · văn bản",
    market_price: "Giá thị trường",
    weather: "Thời tiết",
    compare: "So sánh sản phẩm",
    admin_info: "Hành chính · địa giới",
    product: "Sản phẩm",
    news: "Tin tức",
    general: "Tìm kiếm tổng hợp",
  };

  const freshness: QueryUnderstanding["freshness"] =
    /(hom nay|sang nay|bay gio|hien nay|moi nhat|vua roi)/.test(padded)
      ? "today"
      : /(tuan (truoc|nay)|thang nay|gan day)/.test(padded)
        ? "recent"
        : "any";

  return {
    raw,
    normalized,
    tokens,
    intent,
    intentLabel: intentLabel[intent],
    locations: locs,
    resolvedCurrentIds: [...resolvedCurrentIds],
    transition,
    specialty,
    specialtyTerms,
    categories,
    freshness,
    compareTargets,
    fuzzyUsed: fuzzyNotes.length > 0,
    fuzzyNotes,
    isVietnamese: /[\u0102-\u1EF9]|ấ|ầ|ẩ|ẫ|ậ|ắ|ằ|ẳ|ẵ|ặ/.test(raw) || tokens.some((t) => ["quan", "tinh", "huyen", "xa", "gi", "nao"].includes(t)),
  };
}
