// ---------------------------------------------------------------------------
// VietScope · Seed data — dữ liệu Việt Nam (bản demo LOCAL-1)
// Lưu ý: corpus web/tin tức mang tính minh họa cho retrieval engine;
// cấu trúc hành chính bám Nghị quyết 202/2025/QH15 (hiệu lực 01/7/2025).
// ---------------------------------------------------------------------------

export interface SeedAdmin {
  id: string;
  name: string;
  type: "province" | "district" | "commune";
  status: "current" | "merged" | "abolished";
  parentId?: string | null;
  aliases?: string[];
  mergedInto?: string | null;
  replacedBy?: string[];
  mergedDate?: string | null;
  capital?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface SeedPlace {
  name: string;
  category: string;
  categoryLabel: string;
  specialties?: string[];
  address: string;
  communeId?: string | null;
  provinceId: string;
  historicalUnit?: string | null;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  hours?: string | null;
  open24?: boolean;
  rating?: number | null;
  reviewCount?: number;
  priceLabel?: string | null;
  source?: string;
  verified?: boolean;
  image?: string | null;
  note?: string | null;
}

export interface SeedDoc {
  title: string;
  url: string;
  domain: string;
  sourceType: "law" | "government" | "news" | "community" | "product" | "web";
  snippet: string;
  content: string;
  authority: number;
  hoursAgo: number; // độ tươi tương đối so với lúc seed
  entities?: string[];
}

// --- Ảnh minh họa (Pexels) -------------------------------------------------
const IMG = {
  food: "https://images.pexels.com/photos/33062498/pexels-photo-33062498.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  gioCha: "https://images.pexels.com/photos/31577034/pexels-photo-31577034.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  banhCuon: "https://images.pexels.com/photos/31577028/pexels-photo-31577028.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  chaGio: "https://images.pexels.com/photos/36752864/pexels-photo-36752864.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  cafe1: "https://images.pexels.com/photos/17400479/pexels-photo-17400479.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  cafe2: "https://images.pexels.com/photos/29665365/pexels-photo-29665365.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  cafe3: "https://images.pexels.com/photos/1004123/pexels-photo-1004123.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  cafe4: "https://images.pexels.com/photos/34689733/pexels-photo-34689733.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  nhau: "https://images.pexels.com/photos/33022448/pexels-photo-33022448.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
};

// --- 1. VIETNAM ADMIN GRAPH -------------------------------------------------
type ProvinceRow = [id: string, name: string, lat: number, lng: number, capital?: string, aliases?: string[]];
type OldProvinceRow = [id: string, name: string, mergedInto: string, aliases?: string[]];
type DistrictRow = [id: string, name: string, parent: string, status: "abolished", replacedBy: string[], aliases?: string[]];
type CommuneRow = [id: string, name: string, parentId: string, capital?: string | null, lat?: number | null, lng?: number | null, aliases?: string[]];

const PROVINCES_34: ProvinceRow[] = [
  // [id, name, lat, lng, capital, aliases]
  ["t_ha_noi", "Hà Nội", 21.0285, 105.8542, "Phường Hoàn Kiếm", ["Thăng Long", "Hà Nội City", "Ha Noi"]],
  ["t_hcm", "TP. Hồ Chí Minh", 10.8231, 106.6297, "Phường Sài Gòn", ["Sài Gòn", "TP.HCM", "TPHCM", "Hồ Chí Minh", "Ho Chi Minh City", "TP HCM"]],
  ["t_hai_phong", "Hải Phòng", 20.8449, 106.6881, "Phường Thủy Nguyên", ["HP", "Đất Cảng"]],
  ["t_hue", "Huế", 16.4637, 107.5909, "Phường Phú Xuân", ["Thừa Thiên Huế", "Cố đô Huế"]],
  ["t_da_nang", "Đà Nẵng", 16.0544, 108.2022, "Phường Hải Châu", ["ĐN", "Da Nang"]],
  ["t_can_tho", "Cần Thơ", 10.0452, 105.7469, "Phường Ninh Kiều", ["Tây Đô"]],
  ["t_an_giang", "An Giang", 10.3759, 105.4185, "Phường Long Xuyên", []],
  ["t_bac_ninh", "Bắc Ninh", 21.1861, 106.0763, "Phường Vũ Ninh", ["Kinh Bắc", "Bac Ninh"]],
  ["t_ca_mau", "Cà Mau", 9.1768, 105.1524, "Phường Tân Thành", ["Đất Mũi"]],
  ["t_cao_bang", "Cao Bằng", 22.6357, 106.2522, "Phường Nùng Trí Cao", []],
  ["t_dak_lak", "Đắk Lắk", 12.6667, 108.0378, "Phường Buôn Ma Thuột", ["Buôn Ma Thuột", "Dak Lak", "Đắc Lắc"]],
  ["t_dien_bien", "Điện Biên", 21.3864, 103.016, "Phường Điện Biên Phủ", []],
  ["t_dong_nai", "Đồng Nai", 10.9574, 106.8426, "Phường Tam Hiệp", ["Biên Hòa"]],
  ["t_dong_thap", "Đồng Tháp", 10.457, 105.6329, "Phường Cao Lãnh", ["Sa Đéc"]],
  ["t_gia_lai", "Gia Lai", 13.9833, 108.0, "Phường Pleiku", ["Pleiku"]],
  ["t_ha_tinh", "Hà Tĩnh", 18.3428, 105.9057, "Phường Thành Sen", []],
  ["t_hung_yen", "Hưng Yên", 20.6464, 106.0511, "Phường Sơn Nam", ["Phố Hiến"]],
  ["t_khanh_hoa", "Khánh Hòa", 12.2388, 109.1967, "Phường Nha Trang", ["Nha Trang"]],
  ["t_lai_chau", "Lai Châu", 22.3962, 103.4519, "Phường Đoàn Kết", []],
  ["t_lam_dong", "Lâm Đồng", 11.9404, 108.4583, "Phường Xuân Hương - Đà Lạt", ["Đà Lạt", "Da Lat"]],
  ["t_lang_son", "Lạng Sơn", 21.8337, 106.761, "Phường Tam Thanh", []],
  ["t_lao_cai", "Lào Cai", 22.4809, 103.9753, "Phường Lào Cai", ["Sa Pa"]],
  ["t_nghe_an", "Nghệ An", 18.6796, 105.6813, "Phường Thành Vinh", ["Xứ Nghệ"]],
  ["t_ninh_binh", "Ninh Bình", 20.2506, 105.9747, "Phường Hoa Lư", []],
  ["t_phu_tho", "Phú Thọ", 21.3228, 105.2279, "Phường Việt Trì", ["Đất Tổ", "Việt Trì"]],
  ["t_quang_ngai", "Quảng Ngãi", 15.1205, 108.7923, "Phường Quảng Phú", []],
  ["t_quang_ninh", "Quảng Ninh", 20.9712, 107.0448, "Phường Hạ Long", ["Hạ Long", "Vịnh Hạ Long"]],
  ["t_quang_tri", "Quảng Trị", 16.8171, 107.1008, "Phường Đông Hà", []],
  ["t_son_la", "Sơn La", 21.3255, 103.9182, "Phường Tô Hiệu", []],
  ["t_tay_ninh", "Tây Ninh", 11.3183, 106.0953, "Phường Hòa Thành", []],
  ["t_thanh_hoa", "Thanh Hóa", 19.807, 105.776, "Phường Hạc Thành", ["Xứ Thanh"]],
  ["t_thai_nguyen", "Thái Nguyên", 21.5672, 105.8252, "Phường Phan Đình Phùng", ["TP Thái Nguyên"]],
  ["t_tuyen_quang", "Tuyên Quang", 21.8235, 105.2141, "Phường Minh Xuân", []],
  ["t_vinh_long", "Vĩnh Long", 10.2537, 105.9722, "Phường Long Châu", []],
];

const OLD_PROVINCES: OldProvinceRow[] = [
  // [id, name, mergedInto, aliases]
  ["t_bac_giang", "Bắc Giang", "t_bac_ninh", ["Vùng Kinh Bắc", "Bac Giang"]],
  ["t_thai_binh", "Thái Bình", "t_hung_yen", []],
  ["t_ha_nam", "Hà Nam", "t_ninh_binh", []],
  ["t_nam_dinh", "Nam Định", "t_ninh_binh", []],
  ["t_vinh_phuc", "Vĩnh Phúc", "t_phu_tho", []],
  ["t_hoa_binh", "Hòa Bình", "t_phu_tho", []],
  ["t_bac_kan", "Bắc Kạn", "t_thai_nguyen", ["Bắc Cạn"]],
  ["t_yen_bai", "Yên Bái", "t_lao_cai", []],
  ["t_ha_giang", "Hà Giang", "t_tuyen_quang", []],
  ["t_hai_duong", "Hải Dương", "t_hai_phong", []],
  ["t_quang_binh", "Quảng Bình", "t_quang_tri", ["Quê Hương Động Phong Nha"]],
  ["t_quang_nam", "Quảng Nam", "t_da_nang", ["Hội An", "Xứ Quảng"]],
  ["t_kon_tum", "Kon Tum", "t_quang_ngai", []],
  ["t_binh_dinh", "Bình Định", "t_gia_lai", ["Quy Nhơn", "Đất Võ"]],
  ["t_phu_yen", "Phú Yên", "t_dak_lak", ["Tuy Hòa"]],
  ["t_dak_nong", "Đắk Nông", "t_lam_dong", ["Gia Nghĩa"]],
  ["t_binh_thuan", "Bình Thuận", "t_lam_dong", ["Mũi Né", "Phan Thiết"]],
  ["t_binh_phuoc", "Bình Phước", "t_dong_nai", []],
  ["t_long_an", "Long An", "t_tay_ninh", []],
  ["t_binh_duong", "Bình Dương", "t_hcm", ["Thủ Dầu Một"]],
  ["t_br_vt", "Bà Rịa - Vũng Tàu", "t_hcm", ["Vũng Tàu", "Bà Rịa"]],
  ["t_tien_giang", "Tiền Giang", "t_dong_thap", ["Mỹ Tho"]],
  ["t_ben_tre", "Bến Tre", "t_vinh_long", ["Xứ Dừa"]],
  ["t_tra_vinh", "Trà Vinh", "t_vinh_long", []],
  ["t_soc_trang", "Sóc Trăng", "t_can_tho", []],
  ["t_hau_giang", "Hậu Giang", "t_can_tho", ["Vị Thanh"]],
  ["t_kien_giang", "Kiên Giang", "t_an_giang", ["Phú Quốc", "Rạch Giá"]],
  ["t_bac_lieu", "Bạc Liêu", "t_ca_mau", []],
  ["t_ninh_thuan", "Ninh Thuận", "t_khanh_hoa", ["Phan Rang"]],
];

const DISTRICTS_HIST: DistrictRow[] = [
  // [id, name, parent(hist), status note → replacedBy ids, aliases]
  ["h_yen_dung", "Huyện Yên Dũng", "t_bac_giang", "abolished", ["x_yen_dung", "x_tan_an", "x_tien_phong", "x_canh_thuy"], ["Yên Dũng", "Huyện Yên Dũng Bắc Giang"]],
  ["h_tu_son", "Thị xã Từ Sơn", "t_bac_ninh_old", "abolished", ["p_tu_son", "x_dinh_bang"], ["Từ Sơn"]],
  ["h_que_vo", "Huyện Quế Võ", "t_bac_ninh_old", "abolished", []],
  ["h_gia_binh", "Huyện Gia Bình", "t_bac_ninh_old", "abolished", []],
  ["h_thuan_thanh", "Thị xã Thuận Thành", "t_bac_ninh_old", "abolished", []],
  ["h_viet_yen", "Huyện Việt Yên", "t_bac_giang", "abolished", []],
  ["h_tan_yen", "Huyện Tân Yên", "t_bac_giang", "abolished", []],
  ["h_luc_nam", "Huyện Lục Nam", "t_bac_giang", "abolished", []],
  ["h_hiep_hoa", "Huyện Hiệp Hòa", "t_bac_giang", "abolished", []],
  ["h_tp_bac_giang", "TP. Bắc Giang", "t_bac_giang", "abolished", ["p_bac_giang"], ["Thành phố Bắc Giang"]],
  ["h_hoan_kiem", "Quận Hoàn Kiếm", "t_ha_noi", "abolished", ["p_hoan_kiem"], ["Hoàn Kiếm"]],
];

const COMMUNES: CommuneRow[] = [
  // [id, name, parentProvince, note capital, lat, lng, aliases]
  ["x_yen_dung", "Xã Yên Dũng", "t_bac_ninh", null, 21.2150, 106.2150, ["TT Neo", "Thị trấn Neo", "Neo", "Nội Hoàng", "Tiến Dũng"]],
  ["x_tan_an", "Xã Tân An", "t_bac_ninh", null, 21.2600, 106.2000, ["Tân Liễu"]],
  ["x_tien_phong", "Xã Tiền Phong", "t_bac_ninh", null, 21.1800, 106.2400, []],
  ["x_canh_thuy", "Xã Cảnh Thụy", "t_bac_ninh", null, 21.1700, 106.1900, ["Cảnh Thụy"]],
  ["p_bac_giang", "Phường Bắc Giang", "t_bac_ninh", null, 21.2731, 106.1946, ["TP Bắc Giang", "Thành phố Bắc Giang"]],
  ["p_tu_son", "Phường Từ Sơn", "t_bac_ninh", null, 21.1160, 105.9570, ["Từ Sơn"]],
  ["x_dinh_bang", "Phường Đình Bảng", "t_bac_ninh", null, 21.1100, 105.9500, ["Đình Bảng"]],
  ["p_kinh_bac", "Phường Vũ Ninh", "t_bac_ninh", null, 21.1861, 106.0763, ["Kinh Bắc", "TP Bắc Ninh", "Thành phố Bắc Ninh"]],
  ["p_hoan_kiem", "Phường Hoàn Kiếm", "t_ha_noi", null, 21.0285, 105.8542, ["Hồ Gươm"]],
  ["p_saigon", "Phường Sài Gòn", "t_hcm", null, 10.7756, 106.7019, ["Quận 1", "Sài Gòn"]],
];

export const ADMIN_UNITS: SeedAdmin[] = [
  ...PROVINCES_34.map(([id, name, lat, lng, capital, aliases]) => ({
    id, name, type: "province" as const, status: "current" as const,
    capital: capital ?? null, lat, lng, aliases: aliases ?? [],
  })),
  ...OLD_PROVINCES.map(([id, name, mergedInto, aliases]) => ({
    id, name, type: "province" as const, status: "merged" as const,
    mergedInto, mergedDate: "2025-07-01", aliases: aliases ?? [],
  })),
  ...DISTRICTS_HIST.map(([id, name, parentId, status, replacedBy, aliases]) => ({
    id, name, type: "district" as const, status: status as "abolished",
    parentId: parentId === "t_bac_ninh_old" ? "t_bac_ninh" : parentId,
    replacedBy: replacedBy ?? [], mergedDate: "2025-07-01",
    mergedInto: "t_bac_ninh", aliases: aliases ?? [],
  })),
  ...COMMUNES.map(([id, name, parentId, capital, lat, lng, aliases]) => ({
    id, name, type: "commune" as const, status: "current" as const,
    parentId, capital: capital ?? null, lat: lat ?? null, lng: lng ?? null,
    aliases: aliases ?? [],
  })),
];

// --- 2. CANONICAL PLACES ----------------------------------------------------
export const PLACES: SeedPlace[] = [
  // ── Cụm Yên Dũng (trước 7/2025: Huyện Yên Dũng, Bắc Giang) ─────────────────
  {
    name: "Giò chả Tư Nhuận Nội Hoàng",
    category: "gio-cha", categoryLabel: "Giò chả",
    specialties: ["giò chả", "giò lụa", "chả mực", "đặc sản Nội Hoàng"],
    address: "Thôn Nội Hoàng, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    historicalUnit: "Huyện Yên Dũng, Bắc Giang (trước 7/2025)",
    lat: 21.2465, lng: 106.2621, phone: "0978 345 216",
    hours: "05:00–19:00", rating: 4.6, reviewCount: 328,
    priceLabel: "120.000–180.000đ/kg", source: "osm", verified: true,
    image: IMG.gioCha,
    note: "Làng nghề giò chả Nội Hoàng truyền thống, sản phẩm OCOP 4 sao.",
  },
  {
    name: "Giò chả Bích Hạnh Nội Hoàng",
    category: "gio-cha", categoryLabel: "Giò chả",
    specialties: ["giò chả", "giò tai", "chả quế", "đặc sản Nội Hoàng"],
    address: "Thôn Nội Hoàng, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    historicalUnit: "Huyện Yên Dũng, Bắc Giang (trước 7/2025)",
    lat: 21.2451, lng: 106.2598, phone: "0912 670 384",
    hours: "05:30–19:00", rating: 4.5, reviewCount: 214,
    priceLabel: "115.000–170.000đ/kg", source: "osm", verified: true,
    image: IMG.chaGio,
  },
  {
    name: "Giò chả Mến Diên - Quán ăn sáng",
    category: "gio-cha", categoryLabel: "Giò chả",
    specialties: ["giò chả", "bánh giò", "xôi"],
    address: "Thị trấn Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    historicalUnit: "Huyện Yên Dũng, Bắc Giang (trước 7/2025)",
    lat: 21.2132, lng: 106.217, hours: "05:00–10:30", rating: 4.2,
    reviewCount: 63, priceLabel: "15.000–45.000đ", source: "web",
    verified: false, image: IMG.gioCha,
    note: "Ghi nhận từ web, chưa đối chứng đủ 2 nguồn độc lập.",
  },
  {
    name: "Phở Gánh Neo",
    category: "pho", categoryLabel: "Phở",
    specialties: ["phở bò", "phở gà"],
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    historicalUnit: "Huyện Yên Dũng, Bắc Giang (trước 7/2025)",
    lat: 21.2148, lng: 106.2142, hours: "05:30–21:30", rating: 4.2,
    reviewCount: 145, priceLabel: "35.000–55.000đ", source: "osm",
    verified: true, image: IMG.food,
  },
  {
    name: "Bánh cuốn nóng Bà Đức",
    category: "banh-cuon", categoryLabel: "Bánh cuốn",
    specialties: ["bánh cuốn", "chả quế"],
    address: "Chợ Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2156, lng: 106.2161, hours: "06:00–11:00", rating: 4.3,
    reviewCount: 88, priceLabel: "20.000–40.000đ", source: "osm",
    verified: true, image: IMG.banhCuon,
  },
  {
    name: "Cà phê Sân Vườn Vũ",
    category: "cafe", categoryLabel: "Cà phê",
    specialties: ["cà phê", "cafe sân vườn", "trà đá", "view sông"],
    address: "Thôn Bồng Lai, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    historicalUnit: "Huyện Yên Dũng, Bắc Giang (trước 7/2025)",
    lat: 21.2302, lng: 106.2411, phone: "0988 522 140",
    hours: "06:30–22:30", rating: 4.4, reviewCount: 176,
    priceLabel: "20.000–50.000đ", source: "osm", verified: true,
    image: IMG.cafe2, note: "Không gian vườn rộng, nhiều cây xanh.",
  },
  {
    name: "Trà chanh Nội Hoàng - Chém gió",
    category: "cafe", categoryLabel: "Trà chanh · Cà phê",
    specialties: ["trà chanh", "cà phê", "ăn vặt"],
    address: "Thôn Nội Hoàng, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2472, lng: 106.264, hours: "08:00–23:00", rating: 4.1,
    reviewCount: 97, priceLabel: "10.000–30.000đ", source: "osm",
    verified: true, image: IMG.cafe1,
  },
  {
    name: "Cà phê Ama Neo",
    category: "cafe", categoryLabel: "Cà phê",
    specialties: ["cà phê máy", "sinh tố", "cafe"],
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2141, lng: 106.2155, hours: "06:00–22:00", rating: 3.9,
    reviewCount: 54, priceLabel: "15.000–45.000đ", source: "web",
    verified: false, image: IMG.cafe4,
  },
  {
    name: "Quán nhậu Bảy Bự",
    category: "an-dem", categoryLabel: "Quán nhậu · Ăn đêm",
    specialties: ["quán nhậu", "ăn đêm", "lẩu", "chân gà", "bia"],
    address: "Xã Cảnh Thụy, Bắc Ninh",
    communeId: "x_canh_thuy", provinceId: "t_bac_ninh",
    historicalUnit: "Huyện Yên Dũng, Bắc Giang (trước 7/2025)",
    lat: 21.1705, lng: 106.1904, phone: "0963 118 905",
    hours: "15:00–02:00", rating: 4.2, reviewCount: 231,
    priceLabel: "100.000–400.000đ", source: "osm", verified: true,
    image: IMG.nhau, note: "Mở đến 2h sáng, đông khách về đêm.",
  },
  {
    name: "NetCore Gaming Neo",
    category: "net", categoryLabel: "Quán nét · Cyber game",
    specialties: ["quán nét", "cyber game", "internet"],
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.216, lng: 106.213, open24: true, rating: 4.0,
    reviewCount: 42, priceLabel: "8.000–15.000đ/giờ", source: "osm",
    verified: true, image: null,
  },
  {
    name: "Tạp hóa Hồng Vân",
    category: "tap-hoa", categoryLabel: "Tạp hóa",
    specialties: ["tạp hóa", "đồ gia dụng", "nước giải khát"],
    address: "Thôn Nội Hoàng, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2461, lng: 106.2612, hours: "06:00–21:00", rating: 4.0,
    reviewCount: 21, source: "osm", verified: true, image: null,
  },
  {
    name: "Cửa hàng xăng dầu Neo",
    category: "xang-dau", categoryLabel: "Cây xăng",
    specialties: ["xăng", "dầu", "trạm xăng"],
    address: "QL37, TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2145, lng: 106.2188, hours: "05:00–22:00", rating: 3.8,
    reviewCount: 35, source: "osm", verified: true, image: null,
  },
  {
    name: "Nhà nghỉ Thanh Xuân",
    category: "nha-nghi", categoryLabel: "Nhà nghỉ",
    specialties: ["nhà nghỉ", "phòng trọ"],
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2138, lng: 106.2167, phone: "0913 204 467",
    hours: "24/7", open24: true, rating: 3.8, reviewCount: 47,
    priceLabel: "200.000–350.000đ/đêm", source: "osm", verified: true,
    image: null,
  },
  {
    name: "Vật liệu xây dựng Cường Thịnh",
    category: "vlxd", categoryLabel: "Vật liệu xây dựng",
    specialties: ["sắt thép", "xi măng", "vật liệu xây dựng"],
    address: "QL37, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2195, lng: 106.2215, phone: "0986 551 273",
    hours: "06:30–18:00", rating: 4.1, reviewCount: 29,
    source: "registry", verified: true, image: null,
  },
  {
    name: "Điện nước & Dụng cụ Minh Tâm",
    category: "dung-cu-dien", categoryLabel: "Dụng cụ điện · Điện nước",
    specialties: ["điện nước", "dụng cụ điện", "máy khoan", "máy cắt", "Bosch", "Makita"],
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2153, lng: 106.2149, phone: "0975 314 802",
    hours: "07:00–19:30", rating: 4.3, reviewCount: 66,
    source: "merchant", verified: true, image: null,
    note: "Đại lý dụng cụ cầm tay Bosch, Makita chính hãng.",
  },
  {
    name: "Nhà thuốc An Sinh",
    category: "nha-thuoc", categoryLabel: "Nhà thuốc",
    specialties: ["thuốc", "thực phẩm chức năng", "máy đo huyết áp"],
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2149, lng: 106.2159, phone: "024 3981 0427",
    hours: "06:30–21:30", rating: 4.4, reviewCount: 58,
    source: "registry", verified: true, image: null,
  },
  {
    name: "Bún chả Mẹt Yên Dũng",
    category: "bun-cha", categoryLabel: "Bún chả",
    specialties: ["bún chả", "nem cua bể"],
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2144, lng: 106.2151, hours: "09:00–15:00", rating: 4.3,
    reviewCount: 112, priceLabel: "30.000–50.000đ", source: "web",
    verified: false, image: IMG.food,
  },
  {
    name: "Cơm rang Thịnh Neo",
    category: "com", categoryLabel: "Cơm bình dân",
    specialties: ["cơm rang", "cơm trưa", "phở xào"],
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2158, lng: 106.2171, hours: "09:30–20:30", rating: 4.0,
    reviewCount: 38, priceLabel: "30.000–60.000đ", source: "osm",
    verified: true, image: IMG.food,
  },
  {
    name: "Sửa xe máy Đức Hạnh",
    category: "sua-xe", categoryLabel: "Sửa xe",
    specialties: ["sửa xe máy", "vá xe", "thay nhớt"],
    address: "QL37, xã Yên Dũng, Bắc Ninh",
    communeId: "x_yen_dung", provinceId: "t_bac_ninh",
    lat: 21.2188, lng: 106.2201, hours: "07:00–19:00", rating: 4.2,
    reviewCount: 25, source: "osm", verified: true, image: null,
  },
  // ── Phường Bắc Giang (trước: TP. Bắc Giang) ───────────────────────────────
  {
    name: "Giò chả Nội Hoàng - Chi nhánh Bắc Giang",
    category: "gio-cha", categoryLabel: "Giò chả",
    specialties: ["giò chả", "đặc sản Nội Hoàng"],
    address: "Đường Hoàng Văn Thụ, phường Bắc Giang, Bắc Ninh",
    communeId: "p_bac_giang", provinceId: "t_bac_ninh",
    historicalUnit: "TP. Bắc Giang (trước 7/2025)",
    lat: 21.2742, lng: 106.1961, hours: "07:00–20:00", rating: 4.4,
    reviewCount: 96, priceLabel: "120.000–180.000đ/kg", source: "web",
    verified: false, image: IMG.gioCha,
  },
  {
    name: "Cộng Cà Phê Bắc Giang",
    category: "cafe", categoryLabel: "Cà phê",
    specialties: ["cà phê", "cốt dừa", "cafe"],
    address: "Số 12 Ngô Gia Tự, phường Bắc Giang, Bắc Ninh",
    communeId: "p_bac_giang", provinceId: "t_bac_ninh",
    lat: 21.2755, lng: 106.1934, hours: "07:00–23:00", rating: 4.4,
    reviewCount: 402, priceLabel: "35.000–65.000đ", source: "osm",
    verified: true, image: IMG.cafe3,
  },
  // ── Bắc Ninh ──────────────────────────────────────────────────────────────
  {
    name: "Bánh phu thê Xuân Hạ Đình Bảng",
    category: "dac-san", categoryLabel: "Đặc sản",
    specialties: ["bánh phu thê", "đặc sản Đình Bảng", "bánh su sê"],
    address: "Làng Đình Bảng, phường Đình Bảng, Bắc Ninh",
    communeId: "x_dinh_bang", provinceId: "t_bac_ninh",
    lat: 21.1105, lng: 105.9508, phone: "0904 321 765",
    hours: "07:00–19:00", rating: 4.6, reviewCount: 512,
    priceLabel: "5.000–8.000đ/cái", source: "osm", verified: true,
    image: IMG.food, note: "Làng nghề bánh phu thê lâu đời bậc nhất Kinh Bắc.",
  },
  {
    name: "Phở Gân Bắc Ninh",
    category: "pho", categoryLabel: "Phở",
    specialties: ["phở bò gầu gân"],
    address: "Phường Vũ Ninh, Bắc Ninh",
    communeId: "p_kinh_bac", provinceId: "t_bac_ninh",
    lat: 21.188, lng: 106.078, hours: "06:00–14:00", rating: 4.3,
    reviewCount: 189, priceLabel: "40.000–60.000đ", source: "osm",
    verified: true, image: IMG.food,
  },
  {
    name: "Căn tin & Cafe Thủy Tạ Kinh Bắc",
    category: "cafe", categoryLabel: "Cà phê",
    specialties: ["cà phê", "view hồ", "cafe"],
    address: "Phường Vũ Ninh, Bắc Ninh",
    communeId: "p_kinh_bac", provinceId: "t_bac_ninh",
    lat: 21.1855, lng: 106.0761, hours: "06:30–22:00", rating: 4.2,
    reviewCount: 233, source: "osm", verified: true, image: IMG.cafe4,
  },
  // ── Hà Nội ────────────────────────────────────────────────────────────────
  {
    name: "Phở Thìn Bờ Hồ",
    category: "pho", categoryLabel: "Phở",
    specialties: ["phở bò tái lăn"],
    address: "13 Lò Đúc, Hai Bà Trưng, Hà Nội",
    provinceId: "t_ha_noi", lat: 21.0168, lng: 105.8605,
    hours: "06:00–20:30", rating: 4.5, reviewCount: 3210,
    priceLabel: "70.000–100.000đ", source: "osm", verified: true,
    image: IMG.food,
  },
  {
    name: "Cafe Giảng",
    category: "cafe", categoryLabel: "Cà phê",
    specialties: ["cà phê trứng", "coffee"],
    address: "39 Nguyễn Hữu Huân, Hoàn Kiếm, Hà Nội",
    communeId: "p_hoan_kiem", provinceId: "t_ha_noi",
    lat: 21.0329, lng: 105.8521, hours: "07:00–22:00", rating: 4.6,
    reviewCount: 5140, priceLabel: "25.000–60.000đ", source: "osm",
    verified: true, image: IMG.cafe1,
    note: "Cà phê trứng truyền thống từ 1946.",
  },
  {
    name: "Bún chả Hương Liên",
    category: "bun-cha", categoryLabel: "Bún chả",
    specialties: ["bún chả", "bún chả Obama"],
    address: "24 Lê Văn Hưu, Hai Bà Trưng, Hà Nội",
    provinceId: "t_ha_noi", lat: 21.0182, lng: 105.8517,
    hours: "09:00–21:00", rating: 4.4, reviewCount: 2870,
    priceLabel: "50.000–120.000đ", source: "osm", verified: true,
    image: IMG.food,
  },
  {
    name: "Bánh cuốn Thanh Vân",
    category: "banh-cuon", categoryLabel: "Bánh cuốn",
    specialties: ["bánh cuốn nhân thịt"],
    address: "14 Hàng Gà, Hoàn Kiếm, Hà Nội",
    provinceId: "t_ha_noi", lat: 21.0337, lng: 105.8493,
    hours: "07:00–21:00", rating: 4.2, reviewCount: 980,
    priceLabel: "35.000–60.000đ", source: "osm", verified: true,
    image: IMG.banhCuon,
  },
  {
    name: "Chả cá Lã Vọng",
    category: "cha-ca", categoryLabel: "Chả cá",
    specialties: ["chả cá Lã Vọng"],
    address: "14 Chả Cá, Hoàn Kiếm, Hà Nội",
    provinceId: "t_ha_noi", lat: 21.0345, lng: 105.8474,
    hours: "11:00–21:30", rating: 4.3, reviewCount: 4120,
    priceLabel: "150.000–250.000đ", source: "osm", verified: true,
    image: IMG.food,
  },
  // ── TP. Hồ Chí Minh ───────────────────────────────────────────────────────
  {
    name: "Bánh mì Huỳnh Hoa",
    category: "banh-mi", categoryLabel: "Bánh mì",
    specialties: ["bánh mì pate", "banh mi"],
    address: "26 Lê Thị Riêng, phường Bến Thành, TP. Hồ Chí Minh",
    communeId: "p_saigon", provinceId: "t_hcm",
    lat: 10.7671, lng: 106.6899, hours: "14:30–22:30", rating: 4.4,
    reviewCount: 8930, priceLabel: "50.000–70.000đ", source: "osm",
    verified: true, image: IMG.banhCuon,
  },
  {
    name: "Phở Lệ",
    category: "pho", categoryLabel: "Phở",
    specialties: ["phở bò nam"],
    address: "413 Nguyễn Trãi, TP. Hồ Chí Minh",
    provinceId: "t_hcm", lat: 10.7589, lng: 106.6759,
    hours: "06:00–22:00", rating: 4.5, reviewCount: 6540,
    priceLabel: "75.000–110.000đ", source: "osm", verified: true,
    image: IMG.food,
  },
  {
    name: "Cơm tấm Ba Ghiền",
    category: "com", categoryLabel: "Cơm tấm",
    specialties: ["cơm tấm sườn bì chả"],
    address: "84 Đặng Văn Ngữ, TP. Hồ Chí Minh",
    provinceId: "t_hcm", lat: 10.7962, lng: 106.6892,
    hours: "06:30–21:00", rating: 4.4, reviewCount: 3410,
    priceLabel: "60.000–120.000đ", source: "osm", verified: true,
    image: IMG.food,
  },
  {
    name: "Cà phê vợt Cổ Động",
    category: "cafe", categoryLabel: "Cà phê",
    specialties: ["cà phê vợt", "bạc xỉu", "cafe"],
    address: "Phường Cầu Ông Lãnh, TP. Hồ Chí Minh",
    provinceId: "t_hcm", lat: 10.7654, lng: 106.6966,
    hours: "05:00–22:30", rating: 4.3, reviewCount: 1250,
    priceLabel: "20.000–45.000đ", source: "osm", verified: true,
    image: IMG.cafe2,
  },
  // ── Vùng khác ─────────────────────────────────────────────────────────────
  {
    name: "Bún bò Bà Tuyết",
    category: "bun-bo", categoryLabel: "Bún bò Huế",
    specialties: ["bún bò Huế"],
    address: "Phường Phú Xuân, Huế",
    provinceId: "t_hue", lat: 16.4698, lng: 107.5851,
    hours: "06:00–10:30", rating: 4.3, reviewCount: 640,
    priceLabel: "30.000–50.000đ", source: "osm", verified: true,
    image: IMG.food,
  },
  {
    name: "Mì Quảng Bà Mua",
    category: "mi-quang", categoryLabel: "Mì Quảng",
    specialties: ["mì Quảng tôm thịt"],
    address: "19 Trần Bình Trọng, Đà Nẵng",
    provinceId: "t_da_nang", lat: 16.0652, lng: 108.2125,
    hours: "06:30–20:30", rating: 4.4, reviewCount: 1980,
    priceLabel: "35.000–60.000đ", source: "osm", verified: true,
    image: IMG.food,
  },
  {
    name: "Bánh đa cua Bà Cụ",
    category: "banh-da-cua", categoryLabel: "Bánh đa cua",
    specialties: ["bánh đa cua"],
    address: "179 Cầu Đất, Hải Phòng",
    provinceId: "t_hai_phong", lat: 20.8513, lng: 106.6809,
    hours: "07:00–21:00", rating: 4.4, reviewCount: 1560,
    priceLabel: "40.000–65.000đ", source: "osm", verified: true,
    image: IMG.food,
  },
  {
    name: "Cơm cháy Hoàng Long Ninh Bình",
    category: "com-chay", categoryLabel: "Cơm cháy",
    specialties: ["cơm cháy Ninh Bình", "dê núi"],
    address: "Phường Hoa Lư, Ninh Bình",
    provinceId: "t_ninh_binh", lat: 20.2551, lng: 105.9701,
    hours: "09:00–21:30", rating: 4.2, reviewCount: 720,
    priceLabel: "80.000–250.000đ", source: "web", verified: false,
    image: IMG.food,
  },
];

// --- 3. DOCUMENTS (corpus evidence) ----------------------------------------
export const DOCUMENTS: SeedDoc[] = [
  {
    title: "Nghị định 70/2025/NĐ-CP sửa đổi, bổ sung Nghị định 123/2020/NĐ-CP về hóa đơn, chứng từ",
    url: "https://vanban.chinhphu.vn/?pageid=27160&docid=213051",
    domain: "vanban.chinhphu.vn", sourceType: "law", authority: 1.0, hoursAgo: 24 * 210,
    snippet: "Hộ kinh doanh, cá nhân kinh doanh có doanh thu từ 1 tỷ đồng/năm trở lên thuộc trường hợp phải sử dụng hóa đơn điện tử khởi tạo từ máy tính tiền kết nối với cơ quan thuế, áp dụng từ ngày 01/6/2025.",
    content:
      "Ngày 20/3/2025, Chính phủ ban hành Nghị định 70/2025/NĐ-CP sửa đổi Nghị định 123/2020/NĐ-CP về hóa đơn, chứng từ, có hiệu lực từ 01/6/2025. " +
      "Điểm mới quan trọng: hộ kinh doanh, cá nhân kinh doanh có doanh thu từ 1 tỷ đồng/năm trở lên thuộc lĩnh vực ăn uống, nhà hàng, khách sạn, siêu thị, bán lẻ... phải sử dụng hóa đơn điện tử khởi tạo từ máy tính tiền có kết nối truyền dữ liệu đến cơ quan thuế. " +
      "Nghị định cũng bổ sung hình thức hóa đơn điện tử từ máy tính tiền, sửa quy định về thời điểm lập hóa đơn và xử phạt vi phạm về hóa đơn. Từ 01/01/2026, hộ kinh doanh chuyển sang kê khai theo doanh thu thực tế, chấm dứt cơ chế thuế khoán.",
    entities: ["thue", "hoa-don-dien-tu", "ho-kinh-doanh", "phap-luat"],
  },
  {
    title: "Từ 1/1/2026 chính thức bãi thuế khoán, hộ kinh doanh kê khai theo doanh thu thực tế",
    url: "https://baochinhphu.vn/bai-thue-khoan-tu-2026-102250601101137542.htm",
    domain: "baochinhphu.vn", sourceType: "government", authority: 0.92, hoursAgo: 24 * 60,
    snippet: "Theo Nghị quyết 198/2025/QH15 và Luật Quản lý thuế sửa đổi, từ 01/01/2026, hộ kinh doanh sẽ nộp thuế theo phương pháp kê khai, chấm dứt hoàn toàn thuế khoán.",
    content:
      "Quốc hội thông qua Nghị quyết 198/2025/QH15 về một số cơ chế chính sách đặc thù phát triển kinh tế tư nhân. " +
      "Từ 01/01/2026, hộ kinh doanh, cá nhân kinh doanh sẽ xác định thuế theo phương pháp kê khai trên doanh thu thực tế, chấm dứt phương pháp thuế khoán. " +
      "Hộ kinh doanh có doanh thu dưới 500 triệu đồng/năm thuộc diện không phải nộp thuế giá trị gia tăng và thuế thu nhập cá nhân; doanh thu từ 500 triệu đến 3 tỷ có thể chọn kê khai theo tờ khai. Ngưỡng doanh thu tính thuế và mức thuế suất được điều chỉnh nhằm giảm gánh nặng tuân thủ cho hộ kinh doanh nhỏ.",
    entities: ["thue", "ho-kinh-doanh", "phap-luat", "2026"],
  },
  {
    title: "Nghị quyết 202/2025/QH15 của Quốc hội về sắp xếp đơn vị hành chính cấp tỉnh",
    url: "https://quochoi.vn/tintuc/Pages/tin-tong-hop.aspx?ItemID=78912",
    domain: "quochoi.vn", sourceType: "law", authority: 1.0, hoursAgo: 24 * 150,
    snippet: "Quốc hội quyết định sắp xếp, cả nước còn 34 đơn vị hành chính cấp tỉnh, thành phố. Sáp nhập toàn bộ tỉnh Bắc Giang vào tỉnh Bắc Ninh, giữ tên gọi Bắc Ninh.",
    content:
      "Ngày 12/6/2025, Quốc hội biểu quyết thông qua Nghị quyết 202/2025/QH15 về sắp xếp đơn vị hành chính cấp tỉnh, hiệu lực từ 01/7/2025. " +
      "Cả nước còn 34 đơn vị hành chính cấp tỉnh (28 tỉnh, 6 thành phố), giảm từ 63 đơn vị. Trong đó: sáp nhập Bắc Giang vào Bắc Ninh lấy tên Bắc Ninh, trung tâm chính trị tại TP. Bắc Ninh; sáp nhập Bình Dương, Bà Rịa - Vũng Tàu vào TP. Hồ Chí Minh; Hải Dương vào Hải Phòng; Hà Nam, Nam Định vào Ninh Bình; Vĩnh Phúc, Hòa Bình vào Phú Thọ... " +
      "Đồng thời, cấp huyện kết thúc hoạt động, mô hình chính quyền địa phương 2 cấp chính thức vận hành.",
    entities: ["sap-nhap", "hanh-chinh", "bac-giang", "bac-ninh", "dia-gioi"],
  },
  {
    title: "Tỉnh Bắc Ninh công bố các đơn vị hành chính cấp xã sau sắp xếp",
    url: "https://bacninh.gov.vn/tin-tuc/-/asset_publisher/cong-bo-don-vi-hanh-chinh-cap-xa-2025",
    domain: "bacninh.gov.vn", sourceType: "government", authority: 0.95, hoursAgo: 24 * 145,
    snippet: "Xã Yên Dũng mới được thành lập trên cơ sở sáp nhập thị trấn Neo, xã Nội Hoàng và xã Tiến Dũng thuộc huyện Yên Dũng cũ, tỉnh Bắc Giang.",
    content:
      "UBND tỉnh Bắc Ninh công bố danh sách đơn vị hành chính cấp xã áp dụng từ 01/7/2025. " +
      "Khu vực huyện Yên Dũng (Bắc Giang cũ) được sắp xếp thành các xã: Yên Dũng (gồm thị trấn Neo, xã Nội Hoàng, xã Tiến Dũng), Tân An, Tiền Phong và Cảnh Thụy. " +
      "Tên gọi 'huyện Yên Dũng, tỉnh Bắc Giang' chính thức kết thúc từ 01/7/2025; địa chỉ hành chính mới theo cấu trúc: xã/phường - tỉnh Bắc Ninh.",
    entities: ["yen-dung", "noi-hoang", "bac-giang", "bac-ninh", "sap-nhap", "hanh-chinh"],
  },
  {
    title: "Giá vàng hôm nay: SJC tiếp tục neo cao theo đà thế giới",
    url: "https://vneconomy.vn/gia-vang-hom-nay-sjc-neo-cao.htm",
    domain: "vneconomy.vn", sourceType: "news", authority: 0.8, hoursAgo: 2,
    snippet: "Sáng nay, vàng SJC giao dịch quanh ngưỡng 81,8 - 83,8 triệu đồng/lượng; vàng nhẫn 9999 khoảng 80,9 - 82,4 triệu đồng/lượng, tăng nhẹ so với phiên trước.",
    content:
      "Giá vàng trong nước phiên sáng nay tăng nhẹ theo đà giá thế giới. Vàng miếng SJC tại các hệ thống lớn giao dịch quanh 81,8 triệu đồng/lượng (mua vào) - 83,8 triệu đồng/lượng (bán ra), tăng khoảng 300 nghìn đồng mỗi lượng so với chốt phiên hôm qua. " +
      "Vàng nhẫn tròn trơn 9999 quanh 80,9 - 82,4 triệu đồng/lượng. Giá vàng thế giới giao ngay quanh 2.940 USD/ounce, tương đương 91,5 triệu đồng/lượng quy đổi (chưa thuế phí). Chênh lệch trong - ngoài vẫn ở vùng cao khoảng 7-8 triệu đồng/lượng. " +
      "Lưu ý: số liệu trong corpus demo, vui lòng kiểm tra giá trực tiếp tại điểm giao dịch chính thức.",
    entities: ["gia-vang", "thi-truong", "sjc", "hom-nay"],
  },
  {
    title: "Vì sao giá vàng tăng mạnh trong năm qua?",
    url: "https://cafef.vn/vi-sao-gia-vang-tang-manh.188240712103122982.chn",
    domain: "cafef.vn", sourceType: "news", authority: 0.78, hoursAgo: 30,
    snippet: "Kỳ vọng Fed cắt giảm lãi suất, nhu cầu trú ẩn và việc các ngân hàng trung ương tăng mua vàng là ba động lực chính đẩy kim loại quý lập đỉnh liên tiếp.",
    content:
      "Ba yếu tố chính đứng sau chuỗi tăng giá của vàng: (1) Thị trường đặt cược Fed và các NHTW lớn cắt giảm lãi suất, làm chi phí cơ hội của việc nắm giữ vàng giảm; " +
      "(2) Các ngân hàng trung ương, đặc biệt tại châu Á, tiếp tục mua vàng ròng kỷ lục nhằm đa dạng hóa dự trữ; (3) Rủi ro địa chính trị và lo ngại lạm phát kéo dài khiến nhu cầu trú ẩn tăng. " +
      "Trong nước, nguồn cung vàng miếng SJC hạn chế còn đẩy chênh lệch so với thế giới lên cao. Giới phân tích khuyến nghị nhà đầu tư cá nhân tránh 'đuổi sóng' khi chênh lệch mua - bán đang lớn.",
    entities: ["gia-vang", "thi-truong", "fed", "phan-tich"],
  },
  {
    title: "Giá xăng dầu hôm nay: RON 95-III giữ ổn định quanh ngưỡng 21.000 đồng/lít",
    url: "https://thanhnien.vn/gia-xang-dau-hom-nay-ron-95-on-dinh.htm",
    domain: "thanhnien.vn", sourceType: "news", authority: 0.75, hoursAgo: 5,
    snippet: "Sau kỳ điều hành mới nhất của Bộ Công Thương - Tài chính, xăng RON 95-III niêm yết không quá 21.100 đồng/lít, E5 RON 92 không quá 20.200 đồng/lít.",
    content:
      "Tại kỳ điều hành giá xăng dầu mới nhất, liên Bộ quyết định giữ ổn định giá xăng, giảm nhẹ mặt hàng dầu. Xăng RON 95-III niêm yết tối đa 21.100 đồng/lít, E5 RON 92 tối đa 20.200 đồng/lít, dầu diesel 0.05S tối đa 19.450 đồng/lít. " +
      "Kỳ điều hành tiếp theo dự kiến vào chiều thứ Năm tuần sau. Số liệu minh họa corpus demo.",
    entities: ["gia-xang", "thi-truong", "hom-nay"],
  },
  {
    title: "Tỷ giá USD/VND hôm nay: ngân hàng niêm yết quanh 25.4xx - 26.0xx",
    url: "https://vnbusiness.vn/ty-gia-usd-vnd-hom-nay",
    domain: "vnbusiness.vn", sourceType: "news", authority: 0.7, hoursAgo: 6,
    snippet: "Giá bán USD tại các ngân hàng thương mại lớn dao động quanh 26.050 VND/USD; tỷ giá trung tâm đi ngang.",
    content:
      "Tỷ giá trung tâm USD/VND sáng nay đi ngang. Các ngân hàng lớn niêm yết USD mua vào quanh 25.420 - 25.470, bán ra 26.040 - 26.080 VND/USD. Thị trường tự do cao hơn ngân hàng khoảng 80-120 đồng. Số liệu minh họa corpus demo.",
    entities: ["ty-gia", "usd", "thi-truong", "hom-nay"],
  },
  {
    title: "Dự báo thời tiết khu vực Bắc Bộ và tỉnh Bắc Ninh",
    url: "https://nchmf.gov.vn/Kttvsite/vi-VN/1/du-bao-thoi-tiet-bac-bo.html",
    domain: "nchmf.gov.vn", sourceType: "government", authority: 0.85, hoursAgo: 3,
    snippet: "Khu vực Bắc Bộ ngày nắng nóng nhẹ, chiều tối và đêm có mưa dông rải rác, chưa với vùng núi phía Bắc. Nhiệt độ khu vực đồng bằng (gồm Bắc Ninh) 25 - 34°C.",
    content:
      "Trung tâm Dự báo Khí tượng Thủy văn Quốc gia dự báo: khu vực Bắc Bộ và Thủ đô Hà Nội ngày nắng, trưa chiều nắng nóng nhẹ; chiều tối và đêm có mưa rào, dông rải rác. " +
      "Nhiệt độ vùng đồng bằng Bắc Bộ (Hà Nội, Bắc Ninh, Hưng Yên, Hải Phòng...) 24 - 25°C buổi sáng, cao nhất 32 - 34°C; độ ẩm trung bình 75 - 85%. Trong mưa dông có khả năng xảy ra lốc, sét, mưa đá và gió giật mạnh. " +
      "Số liệu minh họa demo — người dùng cần kiểm tra bản tin mới nhất từ Tổng cục KTTV.",
    entities: ["thoi-tiet", "bac-ninh", "bac-bo", "hom-nay"],
  },
  {
    title: "Đánh giá VinFast VF 8 2025: thực dụng, đậm chất điện, giá tốt sau ưu đãi",
    url: "https://caredge.vn/danh-gia-vinfast-vf8-2025",
    domain: "caredge.vn", sourceType: "community", authority: 0.72, hoursAgo: 24 * 20,
    snippet: "VF 8 Plus 402 mã lực, dẫn động hai cầu, quãng đường 400-420 km/sạc (WLTP Eco 471 km). Điểm trừ: treo cứng ở đường xấu, hữu ích nhất khi có trạm sạc nhà.",
    content:
      "VF 8 2025 bản Plus dùng hai mô tơ điện công suất 300 kW (402 mã lực), mô-men 620 Nm, tăng tốc 0-100 km/h trong 5,5 giây; bản Eco 260 kW, phạm vi WLTP 471 km. " +
      "Ưu điểm: tăng tốc mạnh, cabin rộng, màn hình HUD, miễn phí một phần phí sạc, chi phí vận hành bằng khoảng 1/4 xe xăng cùng cỡ. Nhược: cảm giác treo hơi cứng trên mặt đường gồ ghề, trầm lắng trong thành phố tốt hơn cao tốc. " +
      "Giá công bố của hãng sau các chương trình ưu đãi quanh 1.019 tỷ đồng (Eco) và 1.199 tỷ (Plus); người dùng nên cân nhắc điều kiện sạc tại nhà trước khi mua.",
    entities: ["vinfast", "vf8", "xe-dien", "danh-gia", "so-sanh"],
  },
  {
    title: "So sánh VinFast VF 8 và Hyundai Santa Fe 2025: điện hay xăng hybrid?",
    url: "https://autodaily.vn/so-sanh-vf8-santa-fe-2025",
    domain: "autodaily.vn", sourceType: "news", authority: 0.7, hoursAgo: 24 * 12,
    snippet: "Santa Fe 2.5T HTRAC mạnh 281 mã lực, 3 hàng ghế thực dụng; VF 8 mạnh hơn, rẻ vận hành hơn nhưng phụ thuộc hạ tầng sạc. Mức giá: VF 8 từ 1,019 tỷ, Santa Fe từ 1,029 tỷ.",
    content:
      "Giá niêm yết: VF 8 Eco 1.019 tỷ; VF 8 Plus 1.199 tỷ; Hyundai Santa Fe 2025 tại Việt Nam từ 1.029 tỷ đến 1.365 tỷ đồng (2.5T xăng 281 mã lực hoặc 1.6T hybrid 232-235 mã lực, tùy bản AWD/FWD). " +
      "Không gian: Santa Fe dài 4.830 mm, 3 hàng ghế 6-7 chỗ, hàng ghế thứ ba dùng được cho người lớn chặng ngắn; VF 8 dài 4.750 mm thuần 5 chỗ, hàng ghế hai rộng rãi hơn. " +
      "Vận hành: VF 8 tiết kiệm nhiên liệu rõ rệt nếu sạc tại nhà (khoảng 1/4 chi phí xăng), Santa Fe hybrid tiêu hao ~6-7L/100 km; bảo trì xe điện đơn giản hơn. Kết luận của bài: gia đình cần 7 chỗ và hay đi xa nơi chưa có trạm sạc chọn Santa Fe; người dùng đô thị, muốn xe mạnh và tiết kiệm vận hành chọn VF 8.",
    entities: ["vinfast", "vf8", "hyundai", "santa-fe", "so-sanh", "xe"],
  },
  {
    title: "Thông số kỹ thuật chính thức VinFast VF 8 - vinfastauto.com",
    url: "https://vinfastauto.com/vn_vi/car-vf8",
    domain: "vinfastauto.com", sourceType: "product", authority: 0.9, hoursAgo: 24 * 45,
    snippet: "VF 8: SUV 5 chỗ, Eco 260 kW phạm vi WLTP 471 km; Plus 300 kW/402 mã lực; sạc nhanh 10-70% trong khoảng 26-28 phút; bảo hành 10 năm/200.000 km.",
    content:
      "Thông số chính hãng VF 8: kích thước 4.750 x 1.900 x 1.660 mm, trục cơ sở 2.950 mm, 5 chỗ. Bản Eco: một mô tơ 260 kW (349 mã lực), 500 Nm, cầu trước, phạm vi WLTP 471 km; bản Plus: hai mô tơ 300 kW (402 mã lực), 620 Nm, AWD, phạm vi 457 km. " +
      "Pin 87,7 kWh, sạc nhanh DC tối đa 150 kW, 10-70% khoảng 26-28 phút. Màn hình cảm ứng 15,6 inch, HUD, ADAS cấp 2. Bảo hành 10 năm hoặc 200.000 km.",
    entities: ["vinfast", "vf8", "thong-so", "xe-dien"],
  },
  {
    title: "Hyundai Santa Fe 2025 tại Việt Nam: trang bị và giá bán",
    url: "https://hyundai.com/vn/san-pham/santa-fe",
    domain: "hyundai.com", sourceType: "product", authority: 0.9, hoursAgo: 24 * 40,
    snippet: "Santa Fe thế hệ mới: 2.5 T-GDi 281 mã lực/421 Nm hoặc 1.6 T-GDi hybrid; 6-7 chỗ; giá từ 1.029 đến 1.365 tỷ đồng.",
    content:
      "Santa Fe 2025: kích thước 4.830 x 1.900 x 1.770 mm, 6 hoặc 7 chỗ. Động cơ 2.5 T-GDi xăng 281 mã lực, 421 Nm, hộp số 8 cấp ly hợp kép, dẫn động HTRAC bản cao; bản hybrid 1.6 T-GDi 232-235 mã lực. " +
      "Trang bị: hai màn hình cong 12,3 inch, sạc không dây kép, ghế thư giãn, ADAS SmartSense. Giá công bố 1.029 tỷ (bản tiêu chuẩn) đến 1.365 tỷ đồng (Calligraphy AWD).",
    entities: ["hyundai", "santa-fe", "xe", "gia-ban"],
  },
  {
    title: "Bosch GSB 13 RE - máy khoan động lực 600W bán chạy cho gia đình và thợ",
    url: "https://toolsreview.vn/bosch-gsb-13-re-danh-gia",
    domain: "toolsreview.vn", sourceType: "product", authority: 0.68, hoursAgo: 24 * 90,
    snippet: "GSB 13 RE: 600W, cốt 13mm, tốc độ 0-2.800 vòng/phút, khoan tường/gỗ/đồng thau; giá tham khảo 1.050.000 - 1.150.000đ tại đại lý chính hãng Bắc Ninh.",
    content:
      "Máy khoan động lực Bosch GSB 13 RE: công suất 600W, đầu kẹp 13mm, 0-2.800 v/p, đảo chiều, khoan được tường gạch 13mm, gỗ 25mm, thép 10mm. " +
      "Phù hợp sửa chữa gia đình, lắp đặt điện nước. Giá tham khảo tại các đại lý dụng cụ chính hãng khu vực Bắc Ninh - Bắc Giang: 1.050.000 - 1.150.000đ (chưa VAT). Cần phân biệt bản RE (đảo chiều) với bản thường và hàng không tem chính hãng.",
    entities: ["may-khoan", "bosch", "dung-cu-dien", "bac-ninh", "cua-hang"],
  },
  {
    title: "Ăn gì ở Yên Dũng? Một vòng đặc sản huyện cũ nức tiếng giò chả Nội Hoàng",
    url: "https://dulichkinhbac.vn/blog/an-gi-o-yen-dung-gio-cha-noi-hoang",
    domain: "dulichkinhbac.vn", sourceType: "web", authority: 0.55, hoursAgo: 24 * 100,
    snippet: "Giò chả Nội Hoàng là đặc sản hàng trăm năm của làng Nội Hoàng (xã Yên Dũng hiện nay). Tiếng lành xa nhất phải kể cơ sở Tư Nhuận, Bích Hạnh, Đức Hường.",
    content:
      "Làng Nội Hoàng (nay thuộc xã Yên Dũng, tỉnh Bắc Ninh; trước đây là xã Nội Hoàng, huyện Yên Dũng, Bắc Giang) nổi tiếng nghề làm giò chả hàng trăm năm tuổi. " +
      "Giò được giã tay từ thớ thịt nóng, gói lá chuối, luộc vừa lửa nên dai giòn, thơm nước cốt. Các cơ sở lâu đời được dân địa phương nhắc nhiều: Tư Nhuận, Bích Hạnh, Đức Hường, Vân Diên; giờ mở cửa chủ yếu sáng sớm - chiều tối. " +
      "Ngoài giò chả, khu vực chợ Neo có bánh cuốn nóng buổi sáng, phở gánh, và các quán nhậu sân bãi sông Cầu bán đến khuya.",
    entities: ["gio-cha", "noi-hoang", "yen-dung", "dac-san", "an-gi"],
  },
  {
    title: "Top quán ăn đêm khu vực Neo - Yên Dũng theo dân bản địa",
    url: "https://foodtalk.vn/top-quan-an-dem-neo-yen-dung",
    domain: "foodtalk.vn", sourceType: "community", authority: 0.5, hoursAgo: 24 * 30,
    snippet: "Ăn đêm ở Yên Dũng chủ yếu tập trung vòng xuyến TT Neo và bãi sông: nhậu Bảy Bự (Cảnh Thụy), lẩu cá Neo 2, cháo vịt 24h gần ngã tư Cầu Đò.",
    content:
      "Cộng đồng FoodTalk tổng hợp các quán ăn đêm khu vực thị trấn Neo - Yên Dũng: quán nhậu Bảy Bự (xã Cảnh Thụy, mở đến 2h sáng, nổi chân gà rang muối và lẩu ếch), lẩu cá Neo 2 (giờ cao điểm 21-24h), cháo vịt 24h gần ngã tư Cầu Đò (đang chờ đối chứng số điện thoại). " +
      "Lưu ý số giờ mở cửa có thể thay đổi theo mùa, nên gọi trước khi đến.",
    entities: ["an-dem", "yen-dung", "neo", "quan-nhau"],
  },
  {
    title: "Group những quán cà phê đẹp quanh Yên Dũng - Bắc Giang cũ",
    url: "https://cafehop.vn/review/cafe-dep-yen-dung",
    domain: "cafehop.vn", sourceType: "community", authority: 0.5, hoursAgo: 24 * 75,
    snippet: "Sân Vườn Vũ (Bồng Lai) view ruộng sông thoáng; Ama Neo cafe máy ổn tầm giá 30k; quán vỉa hè Nội Hoàng dân văn phòng hay né nắng.",
    content:
      "Tổng hợp từ group CafeHop: Cà phê Sân Vườn Vũ (thôn Bồng Lai, xã Yên Dũng) được khen không gian vườn rộng, view cánh đồng và sông, đèn cào hợp nhóm bạn; Cà phê Ama Neo ở thị trấn Neo có cafe máy tầm trung dễ uống; trà chanh Nội Hoàng đông giờ chiều tối. " +
      "Cảnh báo hài hước của group: cuối tuần Sân Vườn Vũ chật cứng bàn, ai muốn yên tĩnh nên đi sáng từ thứ hai đến thứ sáu.",
    entities: ["cafe", "yen-dung", "review", "san-vuon"],
  },
  {
    title: "Giò chả Nội Hoàng đạt sản phẩm OCOP 4 sao cấp tỉnh",
    url: "https://nongnghiep.vn/gio-cha-noi-hoang-ocop-4-sao.html",
    domain: "nongnghiep.vn", sourceType: "news", authority: 0.8, hoursAgo: 24 * 380,
    snippet: "Làng nghề giò chả Nội Hoàng (huyện Yên Dũng, Bắc Giang) có 3 cơ sở đạt chứng nhận OCOP 4 sao, quy trình an toàn thực phẩm được chuẩn hóa.",
    content:
      "Giò chả Nội Hoàng là một trong những sản phẩm làng nghề tiêu biểu của vùng Kinh Bắc, từng đạt chứng nhận sản phẩm OCOP 4 sao cấp tỉnh Bắc Giang. " +
      "Điểm đặc trưng: thịt lợn cằm nọc nóng giã tay, nêm chỉ nước mắm cốt và tiêu rừng, gói hai lớp lá chuối. Sau sắp xếp hành chính, làng nghề thuộc xã Yên Dũng, tỉnh Bắc Ninh.",
    entities: ["gio-cha", "noi-hoang", "ocop", "yen-dung", "bac-giang"],
  },
  {
    title: "Hướng dẫn tra cứu hóa đơn điện tử và đối chiếu doanh thu hộ kinh doanh trên cổng Tổng cục Thuế",
    url: "https://gdt.gov.vn/wps/portal/huong-dan-tra-cuu-hoa-don-dien-tu",
    domain: "gdt.gov.vn", sourceType: "government", authority: 0.9, hoursAgo: 24 * 55,
    snippet: "Tổng cục Thuế hướng dẫn tra cứu hóa đơn điện tử hợp lệ bằng mã số thuế người bán, số hóa đơn và tổng tiền thanh toán.",
    content:
      "Người mua có thể tra cứu tính hợp lệ của hóa đơn điện tử tại cổng thông tin của Tổng cục Thuế bằng mã số thuế người bán, ký hiệu hóa đơn, số hóa đơn và tổng giá trị thanh toán. " +
      "Hộ kinh doanh dùng hóa đơn từ máy tính tiền cần đảm bảo thiết bị có kết nối với hệ thống của cơ quan thuế theo Nghị định 70/2025/NĐ-CP.",
    entities: ["hoa-don-dien-tu", "thue", "tra-cuu"],
  },
  {
    title: "Cẩm nang chọn quán giò chả ngon: quy tắc '3 không' của nghệ nhân làng Nội Hoàng",
    url: "https://amthucnuitang.vn/cam-nang-chon-gio-cha-ngon-noi-hoang",
    domain: "amthucnuitang.vn", sourceType: "web", authority: 0.45, hoursAgo: 24 * 220,
    snippet: "Giò chả ngon không để qua đêm, không dùng hàn the, không giã máy. Giá bán lẻ đầu ngõ làng rẻ hơn các điểm bán lại 10-15%.",
    content:
      "Nghệ nhân làng Nội Hoàng chia sẻ quy tắc '3 không': giò ngon không để qua đêm ngoài tủ lạnh bề mặt (vỏ sẽ nhũn), không dùng phụ gia hàn the, không giã máy vì mất độ dai kết dính tự nhiên. " +
      "Khi mua nên bóp nhẹ: giò đàn hồi, bề mặt ráo mỡ, thái lát có màu hồng đất và độ phai tự nhiên. Giá dịp lễ Tết có thể tăng 10-20%.",
    entities: ["gio-cha", "noi-hoang", "cam-nang", "meo"],
  },
];
