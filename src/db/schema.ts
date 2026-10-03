import {
  pgTable,
  text,
  uuid,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  date,
  bigint,
  primaryKey,
  index,
  customType,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";

/** tsvector lưu sẵn (generated) — để full-text dùng GIN thay vì tính lại to_tsvector cho từng dòng mỗi truy vấn */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// ---------------------------------------------------------------------------
// Vietnam Admin Graph — địa danh hiện tại + lịch sử + sáp nhập + đổi tên
// ---------------------------------------------------------------------------
export const adminUnits = pgTable("admin_units", {
  id: text("id").primaryKey(), // slug: "t_bac_ninh", "h_yen_dung", "x_noi_hoang"
  name: text("name").notNull(), // "Yên Dũng"
  nameSearch: text("name_search").notNull(), // "yen dung"
  type: text("type").notNull(), // province | district | commune
  status: text("status").notNull().default("current"), // current | merged | abolished
  parentId: text("parent_id"), // tỉnh chủ quản hiện tại (nếu có)
  aliases: text("aliases").array().notNull().default([]), // hiển thị: ["Sài Gòn","TP.HCM"]
  searchAliases: text("search_aliases").array().notNull().default([]), // unaccented
  mergedInto: text("merged_into"), // id đơn vị tiếp nhận
  replacedBy: text("replaced_by").array().notNull().default([]), // các đơn vị hiện tại thay thế
  mergedDate: text("merged_date"), // ngày hiệu lực
  capital: text("capital"),
  lat: real("lat"),
  lng: real("lng"),
});

// Legal identity is separate from the physical outlet. One taxpayer may own many branches.
export const legalEntities = pgTable("legal_entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  taxId: text("tax_id").notNull().unique(),
  legalName: text("legal_name").notNull(),
  registeredAddress: text("registered_address"),
  status: text("status").notNull().default("unknown"),
  sourceUrl: text("source_url").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Canonical Places — lớp dữ liệu địa điểm Việt Nam (PostGIS-lite, lat/lng)
// ---------------------------------------------------------------------------
export const places = pgTable("places", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  nameSearch: text("name_search").notNull(),
  legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id),
  outletKey: text("outlet_key"),
  dataClass: text("data_class").notNull().default("legacy-demo"),
  category: text("category").notNull(), // slug: "gio-cha", "cafe"...
  categoryLabel: text("category_label").notNull(),
  specialties: text("specialties").array().notNull().default([]),
  specialtiesSearch: text("specialties_search").notNull().default(""),
  address: text("address").notNull(),
  addressSearch: text("address_search").notNull(),
  communeId: text("commune_id"),
  provinceId: text("province_id").notNull(),
  historicalUnit: text("historical_unit"), // "Huyện Yên Dũng, Bắc Giang (trước 7/2025)"
  lat: real("lat"),
  lng: real("lng"),
  phone: text("phone"),
  hours: text("hours"), // "05:30–19:00"
  open24: boolean("open24").default(false),
  rating: real("rating"),
  reviewCount: integer("review_count").default(0),
  priceLabel: text("price_label"),
  source: text("source").notNull().default("osm"), // osm | registry | merchant | web
  verified: boolean("verified").notNull().default(false),
  image: text("image"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex("places_outlet_key_idx").on(t.outletKey)]);

// ---------------------------------------------------------------------------
// Place Candidates — web/OSM discovery staging (data flywheel)
// ---------------------------------------------------------------------------
export const placeCandidates = pgTable("place_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  nameSearch: text("name_search").notNull(),
  specialty: text("specialty"),
  specialtySearch: text("specialty_search"),
  address: text("address"),
  addressSearch: text("address_search"),
  provinceId: text("province_id"),
  sourceUrl: text("source_url"),
  sourceTitle: text("source_title"),
  evidence: text("evidence"),
  status: text("status").notNull().default("pending"), // pending | promoted | rejected
  discoveredVia: text("discovered_via"),
  promotedPlaceId: uuid("promoted_place_id"),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Documents — corpus web/tin/pháp luật đã crawl (evidence layer)
// ---------------------------------------------------------------------------
export const documents = pgTable(
  "documents",
  {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  titleSearch: text("title_search").notNull(),
  url: text("url").notNull(),
  domain: text("domain").notNull(),
  sourceType: text("source_type").notNull(), // law | government | news | community | product | web
  snippet: text("snippet").notNull().default(""),
  content: text("content").notNull().default(""),
  contentSearch: text("content_search").notNull().default(""),
  authority: real("authority").notNull().default(0.5), // 0..1
  publishedAt: timestamp("published_at", { withTimezone: true }),
  entities: text("entities").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  fts: tsvector("fts").generatedAlwaysAs((): SQL => sql`to_tsvector('simple', ${documents.titleSearch} || ' ' || ${documents.contentSearch})`),
  },
  (t) => [index("documents_fts_gin_idx").using("gin", t.fts)]
);

// ---------------------------------------------------------------------------
// Coverage Gaps — Coverage Engine (P5): chỗ dữ liệu Việt Nam còn thiếu
// ---------------------------------------------------------------------------
export const coverageGaps = pgTable("coverage_gaps", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(), // intent|specialty|location — khoá gộp
  intent: text("intent").notNull(),
  querySample: text("query_sample").notNull(),
  specialty: text("specialty"),
  locationId: text("location_id"),
  provinceId: text("province_id"),
  reason: text("reason").notNull(),
  hits: integer("hits").notNull().default(1),
  status: text("status").notNull().default("open"), // open | staged | resolved
  action: text("action"), // việc Coverage Engine nên làm (crawl lane nào)
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Feedback — nhãn của người dùng/agent trên từng trace (dữ liệu preference/DPO)
// ---------------------------------------------------------------------------
export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  traceId: uuid("trace_id"),
  query: text("query").notNull(),
  verdict: text("verdict").notNull(), // good | bad | mixed
  usefulPlaceIds: text("useful_place_ids").array().notNull().default([]),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Search Traces — nhật ký pipeline (training traces + flywheel coverage)
// ---------------------------------------------------------------------------
export const searchTraces = pgTable("search_traces", {
  id: uuid("id").defaultRandom().primaryKey(),
  query: text("query").notNull(),
  /** dạng query đã lược PII (phone/email/mã dài) — tầng analytics dài hạn dùng cột này, không dùng `query` raw */
  querySafe: text("query_safe"),
  normalized: text("normalized").notNull(),
  intent: text("intent").notNull(),
  locationId: text("location_id"),
  specialty: text("specialty"),
  resultsTotal: integer("results_total").default(0),
  exactCount: integer("exact_count").default(0),
  relatedCount: integer("related_count").default(0),
  coverageGap: boolean("coverage_gap").default(false),
  budget: text("budget"),
  synthesizer: text("synthesizer"), // extractive | llm:<model>
  verifiedRatio: real("verified_ratio"),
  confidence: real("confidence"),
  latencyMs: integer("latency_ms"),
  /** vết đầy đủ để dựng dataset huấn luyện VietScope-LM (query → plan → providers → evidence → answer → citations) */
  trace: jsonb("trace"),
  timingsMs: jsonb("timings_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Search Interactions — tín hiệu hành vi (impression/click/source/map/call/
// reformulate). Không lưu IP, không lưu key; session_id là id tạm mỗi tab do
// client tự sinh, đủ để phát hiện reformulation mà không tracking người dùng.
// ---------------------------------------------------------------------------
export const searchInteractions = pgTable(
  "search_interactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceId: uuid("trace_id"), // search_id xuyên suốt — nullable, không FK cứng
    sessionId: text("session_id"),
    kind: text("kind").notNull(),
    resultId: text("result_id"),
    rank: integer("rank"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("search_interactions_trace_idx").on(t.traceId),
    index("search_interactions_kind_idx").on(t.kind, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Bad Search Reviews — human judgment over the live telemetry-derived queue.
// Queue scoring stays derived in quality.ts; this table stores ONLY reviewer
// state. "promoted_to_golden" is reserved for P-LEARNING-6.
// ---------------------------------------------------------------------------
export const badSearchReviews = pgTable(
  "bad_search_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    querySafe: text("query_safe").notNull(),
    status: text("status").notNull().default("open"), // open | reviewed_good | confirmed_bad | ignored | promoted_to_golden
    note: text("note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("bad_search_reviews_query_idx").on(t.querySafe),
    index("bad_search_reviews_status_idx").on(t.status, t.updatedAt),
  ],
);

// ---------------------------------------------------------------------------
// Golden Candidates — P-LEARNING-6: confirmed_bad review → human-labeled
// benchmark case. Versioned: sửa = version mới + supersedes, không overwrite.
// evidence_snapshot giữ evidence tối thiểu vì trace JSONB bị retention drop.
// ---------------------------------------------------------------------------
export const goldenCandidates = pgTable(
  "golden_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** bad_search_review (confirmed_bad) | manual_nomination (positive control, review_id=null) */
    source: text("source").notNull().default("bad_search_review"),
    reviewId: uuid("review_id"), // provenance → bad_search_reviews.id — bắt buộc khi source=bad_search_review
    traceId: uuid("trace_id"),   // trace gốc lúc phát hiện (có thể đã retention-purge; null khi dry-run nominate)
    querySafe: text("query_safe").notNull(),
    version: integer("version").notNull().default(1),
    supersedesId: uuid("supersedes_id"), // → case cũ bị thay thế (self-ref)
    status: text("status").notNull().default("draft"), // draft|labeled|approved|promoted|superseded
    evidenceSnapshot: jsonb("evidence_snapshot"), // intent/scope/results/coverage lúc tạo
    // --- human labels (P6: chỉ người mới ghi, telemetry chỉ đề cử) ---
    intent: text("intent"),
    geoScope: jsonb("geo_scope"),              // VN100-0: {admin_ids?, anchor?, radius_m?}
    specialty: text("specialty"),
    expectedEntities: jsonb("expected_entities"),   // string[] tên/id mong đợi
    relevanceLabels: jsonb("relevance_labels"),     // {entity_name: 0..3}
    freshnessRequirement: text("freshness_requirement"), // enum: static|slow|medium|high|realtime
    authorityRequirement: text("authority_requirement"), // enum: any|*_or_better|authoritative
    abstentionExpected: boolean("abstention_expected").notNull().default(false),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    labeledAt: timestamp("labeled_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("golden_candidates_status_idx").on(t.status, t.updatedAt),
    index("golden_candidates_query_idx").on(t.querySafe),
  ],
);

// Append-only audit — KHÔNG UPDATE/DELETE; một lần ghi một lần đọc.
export const goldenCandidateEvents = pgTable(
  "golden_candidate_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id").notNull(), // → golden_candidates.id
    eventType: text("event_type").notNull(), // candidate_created|labeled|approved|promoted|superseded
    actor: text("actor").notNull().default("ops"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("golden_events_candidate_idx").on(t.candidateId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Eval Runs — benchmark VietScope (tài sản đo lường chất lượng)
// ---------------------------------------------------------------------------
export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  suite: text("suite").notNull().default("vn-golden"),
  queryCount: integer("query_count").default(0),
  metrics: jsonb("metrics").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ===========================================================================
// FACADE tables — thuộc sản phẩm vietscope-1 (auth · usage · trace · feedback · eval)
// (Các bảng phía trên — admin_units, places, place_candidates, documents, coverage_gaps — thuộc
//  RETRIEVAL BRAIN; facade không đọc chúng. Khi dùng search-router chúng nằm ở hệ thống của brain.)
// ===========================================================================

/** API key — chỉ lưu SHA-256 của key, không lưu plaintext */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(), // 12 ký tự đầu, để nhận diện trong danh sách
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull().default(["*"]),
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(60),
  monthlyQuota: integer("monthly_quota"), // null = không giới hạn
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Usage theo ngày. Token chỉ cộng khi là usage THẬT của provider; ước lượng chỉ đếm số request. */
export const apiUsage = pgTable(
  "api_usage",
  {
    keyId: uuid("key_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    requests: integer("requests").notNull().default(0),
    promptTokens: bigint("prompt_tokens", { mode: "number" }).notNull().default(0),
    completionTokens: bigint("completion_tokens", { mode: "number" }).notNull().default(0),
    estimatedRequests: integer("estimated_requests").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.day] })]
);

/** Rate limit dùng chung giữa các instance (fixed window theo phút). Phase H: chuyển sang Redis sliding window. */
export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    subject: text("subject").notNull(),
    windowStart: bigint("window_start", { mode: "number" }).notNull(), // epoch phút
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.subject, t.windowStart] })]
);

export type AdminUnit = typeof adminUnits.$inferSelect;
export type Place = typeof places.$inferSelect;
/** Dòng tài liệu không kèm cột fts (tsvector chỉ dùng cho truy vấn, không kéo về process) */
export type DocumentRow = Omit<typeof documents.$inferSelect, "fts">;
export type PlaceCandidate = typeof placeCandidates.$inferSelect;
export type CoverageGap = typeof coverageGaps.$inferSelect;
export type FeedbackRow = typeof feedback.$inferSelect;
export type SearchTrace = typeof searchTraces.$inferSelect;
export type BadSearchReviewRow = typeof badSearchReviews.$inferSelect;
export type GoldenCandidateRow = typeof goldenCandidates.$inferSelect;
export type GoldenCandidateEventRow = typeof goldenCandidateEvents.$inferSelect;

// Immutable observations: revisions append a new row, never overwrite the source payload.
export const placeObservations = pgTable("place_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  outletKey: text("outlet_key").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceGroup: text("source_group").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
  fixture: boolean("fixture").notNull().default(false),
  status: text("status").notNull().default("pending"),
  placeId: uuid("place_id").references(() => places.id),
  reviewer: text("reviewer"),
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("observations_outlet_idx").on(t.outletKey), index("observations_status_idx").on(t.status)]);

export const fieldProvenance = pgTable("field_provenance", {
  id: uuid("id").defaultRandom().primaryKey(),
  placeId: uuid("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  observationId: uuid("observation_id").notNull().references(() => placeObservations.id),
  field: text("field").notNull(),
  value: jsonb("value").notNull(),
  chosen: boolean("chosen").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("provenance_evidence_unique").on(t.placeId, t.observationId, t.field)]);

// Demand is aggregated per seven-day window, administrative scope and optional H3 cell.
// A null H3 means unknown (NOT a synthetic H3 index). Do not infer coordinates from centroids.
export const coverageCells = pgTable("coverage_cells", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  adminId: text("admin_id").notNull(),
  provinceId: text("province_id").notNull(),
  h3Cell: text("h3_cell"),
  category: text("category").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  demand: integer("demand").notNull().default(0),
  zeroResults: integer("zero_results").notNull().default(0),
  canonicalCount: integer("canonical_count").notNull().default(0),
  freshCount: integer("fresh_count").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  lastCrawled: timestamp("last_crawled", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const coverageJobs = pgTable("coverage_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  cellId: uuid("cell_id").notNull().references(() => coverageCells.id).unique(),
  priority: real("priority").notNull(),
  status: text("status").notNull().default("queued"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  leaseToken: uuid("lease_token"),
  owner: text("owner"),
  plan: jsonb("plan").notNull(),
  attempts: integer("attempts").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("coverage_jobs_priority_idx").on(t.status, t.priority)]);
