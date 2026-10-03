import "dotenv/config";
import { db } from "./index";
import {
  adminUnits,
  places,
  documents,
  placeCandidates,
  searchTraces,
  coverageGaps,
  feedback,
} from "./schema";
import { ADMIN_UNITS, PLACES, DOCUMENTS } from "./seed-data";
import { normalize } from "../lib/vi";
import { sql } from "drizzle-orm";

const CANDIDATES = [
  {
    name: "Giò chả Đức Hường Nội Hoàng",
    specialty: "giò chả",
    address: "Thôn Nội Hoàng, xã Yên Dũng, Bắc Ninh",
    provinceId: "t_bac_ninh",
    sourceUrl: "https://dulichkinhbac.vn/blog/an-gi-o-yen-dung-gio-cha-noi-hoang",
    sourceTitle: "Ăn gì ở Yên Dũng? Đặc sản giò chả Nội Hoàng",
    evidence: "Được nhắc trong bài blog du lịch Kinh Bắc là một trong các cơ sở lâu đời tại làng Nội Hoàng, chưa có số điện thoại/giờ mở cửa.",
  },
  {
    name: "Cháo vịt 24h ngã tư Cầu Đò",
    specialty: "ăn đêm",
    address: "Ngã tư Cầu Đò, xã Yên Dũng, Bắc Ninh",
    provinceId: "t_bac_ninh",
    sourceUrl: "https://foodtalk.vn/top-quan-an-dem-neo-yen-dung",
    sourceTitle: "Top quán ăn đêm khu vực Neo - Yên Dũng",
    evidence: "Xuất hiện trong bài tổng hợp cộng đồng về quán ăn đêm, chưa đối chiếu được nguồn thứ hai.",
  },
  {
    name: "Lẩu cá Neo 2",
    specialty: "ăn đêm",
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    provinceId: "t_bac_ninh",
    sourceUrl: "https://foodtalk.vn/top-quan-an-dem-neo-yen-dung",
    sourceTitle: "Top quán ăn đêm khu vực Neo - Yên Dũng",
    evidence: "Được nhắc giờ cao điểm 21-24h trong bài cộng đồng.",
  },
  {
    name: "Cà phê Mộc Tiền Phong",
    specialty: "cà phê",
    address: "Xã Tiền Phong, Bắc Ninh",
    provinceId: "t_bac_ninh",
    sourceUrl: "https://cafehop.vn/review/cafe-dep-yen-dung",
    sourceTitle: "Những quán cà phê đẹp quanh Yên Dũng",
    evidence: "1 lượt nhắc trong group cà phê, chưa xác minh vị trí chính xác.",
  },
  {
    name: "Điện máy Anh Tuấn - dụng cụ Bosch",
    specialty: "máy khoan",
    address: "TT Neo, xã Yên Dũng, Bắc Ninh",
    provinceId: "t_bac_ninh",
    sourceUrl: "https://toolsreview.vn/bosch-gsb-13-re-danh-gia",
    sourceTitle: "Bosch GSB 13 RE - máy khoan 600W bán chạy",
    evidence: "Bài review dụng cụ nhắc đại lý khu vực Bắc Ninh - Bắc Giang, chưa chắc địa chỉ hiện tại.",
  },
];

async function main() {
  console.log("⏳ Clearing old data…");
  await db.execute(sql`TRUNCATE admin_units, places, documents, place_candidates, search_traces, search_interactions, bad_search_reviews, eval_runs, coverage_gaps, feedback RESTART IDENTITY CASCADE`);

  console.log("⏳ Seeding admin graph…", ADMIN_UNITS.length);
  for (const a of ADMIN_UNITS) {
    await db.insert(adminUnits).values({
      id: a.id,
      name: a.name,
      nameSearch: normalize(a.name),
      type: a.type,
      status: a.status,
      parentId: a.parentId ?? null,
      aliases: a.aliases ?? [],
      searchAliases: (a.aliases ?? []).map(normalize),
      mergedInto: a.mergedInto ?? null,
      replacedBy: a.replacedBy ?? [],
      mergedDate: a.mergedDate ?? null,
      capital: a.capital ?? null,
      lat: a.lat ?? null,
      lng: a.lng ?? null,
    });
  }

  console.log("⏳ Seeding places…", PLACES.length);
  for (const p of PLACES) {
    await db.insert(places).values({
      name: p.name,
      nameSearch: normalize(p.name),
      category: p.category,
      categoryLabel: p.categoryLabel,
      specialties: p.specialties ?? [],
      specialtiesSearch: (p.specialties ?? []).map(normalize).join(" · "),
      address: p.address,
      addressSearch: normalize(p.address),
      communeId: p.communeId ?? null,
      provinceId: p.provinceId,
      historicalUnit: p.historicalUnit ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      phone: p.phone ?? null,
      hours: p.hours ?? null,
      open24: p.open24 ?? false,
      rating: p.rating ?? null,
      reviewCount: p.reviewCount ?? 0,
      priceLabel: p.priceLabel ?? null,
      source: p.source ?? "osm",
      verified: p.verified ?? false,
      image: p.image ?? null,
      note: p.note ?? null,
    });
  }

  console.log("⏳ Seeding documents…", DOCUMENTS.length);
  const now = Date.now();
  for (const d of DOCUMENTS) {
    await db.insert(documents).values({
      title: d.title,
      titleSearch: normalize(d.title),
      url: d.url,
      domain: d.domain,
      sourceType: d.sourceType,
      snippet: d.snippet,
      content: d.content,
      contentSearch: normalize(`${d.title} ${d.snippet} ${d.content}`),
      authority: d.authority,
      publishedAt: new Date(now - d.hoursAgo * 3600_000),
      entities: d.entities ?? [],
    });
  }

  console.log("⏳ Seeding place candidates…", CANDIDATES.length);
  for (const c of CANDIDATES) {
    await db.insert(placeCandidates).values({
      name: c.name,
      nameSearch: normalize(c.name),
      specialty: c.specialty,
      specialtySearch: normalize(c.specialty),
      address: c.address,
      addressSearch: normalize(c.address),
      provinceId: c.provinceId,
      sourceUrl: c.sourceUrl,
      sourceTitle: c.sourceTitle,
      evidence: c.evidence,
      status: "pending",
      discoveredVia: "quán ăn đêm & đặc sản Yên Dũng",
    });
  }

  // eval_runs: không seed số liệu giả — benchmark thật chạy qua POST /v1/eval/run (hoặc tự chạy khi mở /docs lần đầu)

  console.log("✅ Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
