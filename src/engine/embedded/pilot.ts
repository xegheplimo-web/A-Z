import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminUnits, coverageCells, coverageJobs, fieldProvenance, legalEntities, placeObservations, places } from "@/db/schema";
import { PILOT_CATEGORIES, PILOT_LABELS, PilotError, type ObservationInput, type PilotCommand, type PilotSnapshot, type PilotCategory } from "@/core/pilot";
import { normalize } from "@/lib/vi";
import type { QueryUnderstanding } from "./understand";
import type { RetrievalResult } from "./retrieve";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const DAY = 86_400_000;
const PILOT_REGIONS = ["h_yen_dung", "x_yen_dung", "x_tan_an", "x_tien_phong", "x_canh_thuy"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
function text(v: unknown, field: string, max = 300) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new PilotError(`${field}: cần chuỗi từ 1 đến ${max} ký tự.`);
  return v.trim();
}
function sourceGroup(url: string) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  return labels.slice(/\.(com|org|gov|edu|net)\.vn$/.test(host) ? -3 : -2).join(".");
}
function phone(v: string | null | undefined) {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits.startsWith("84") ? `0${digits.slice(2)}` : digits;
}
export function validateObservation(raw: unknown): ObservationInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PilotError("Observation phải là object.");
  const r = raw as Record<string, unknown>;
  const sourceType = text(r.sourceType, "sourceType", 30) as ObservationInput["sourceType"];
  if (!["osm", "registry", "website", "directory", "merchant"].includes(sourceType)) throw new PilotError("sourceType không được hỗ trợ.");
  const sourceUrl = text(r.sourceUrl, "sourceUrl", 2000);
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new PilotError("URL nguồn không hợp lệ."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new PilotError("Nguồn cần URL HTTP(S) không kèm thông tin đăng nhập.");
  const observedAt = text(r.observedAt, "observedAt", 60);
  const date = new Date(observedAt);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 300_000) throw new PilotError("Thời điểm ghi nhận không hợp lệ hoặc nằm trong tương lai.");
  const category = text(r.category, "category", 40) as PilotCategory;
  if (!(PILOT_CATEGORIES as readonly string[]).includes(category)) throw new PilotError("Category ngoài phạm vi pilot LOCAL-1.");
  const coord = (v: unknown, max: number) => { if (v == null) return null; if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > max) throw new PilotError("Tọa độ không hợp lệ."); return v; };
  const lat = coord(r.lat, 90), lng = coord(r.lng, 180);
  if ((lat === null) !== (lng === null)) throw new PilotError("Cần cung cấp cả lat và lng hoặc để cả hai trống.");
  if (!Array.isArray(r.specialties) || r.specialties.length > 20) throw new PilotError("specialties: mảng tối đa 20 mục.");
  const optional = (v: unknown, name: string, max: number) => v == null || v === "" ? null : text(v, name, max);
  let entity: ObservationInput["legalEntity"] = null;
  if (r.legalEntity != null) {
    if (typeof r.legalEntity !== "object") throw new PilotError("legalEntity không hợp lệ.");
    const e = r.legalEntity as Record<string, unknown>;
    const taxId = text(e.taxId, "taxId", 14).replace(/-/g, "");
    if (!/^(\d{10}|\d{13})$/.test(taxId)) throw new PilotError("MST phải gồm 10 hoặc 13 chữ số.");
    entity = { taxId, legalName: text(e.legalName, "legalName"), registeredAddress: optional(e.registeredAddress, "registeredAddress", 500) ?? undefined, status: optional(e.status, "status", 60) ?? "unknown" };
  }
  return {
    sourceType, sourceId: text(r.sourceId, "sourceId", 200), sourceUrl: url.toString(), observedAt: date.toISOString(),
    name: text(r.name, "name", 200), address: text(r.address, "address", 500),
    communeId: text(r.communeId, "communeId", 100), provinceId: text(r.provinceId, "provinceId", 100),
    category, specialties: [...new Set(r.specialties.map(s => text(s, "specialty", 80)))].sort(),
    phone: optional(r.phone, "phone", 40), website: optional(r.website, "website", 1000), hours: optional(r.hours, "hours", 100), lat, lng, legalEntity: entity,
    fixture: r.fixture === true || /\.(test|example|invalid|localhost)$/.test(url.hostname) || ["example.org", "example.com", "example.net", "localhost"].includes(url.hostname),
  };
}
export const outletIdentity = (o: ObservationInput) => sha(`${normalize(o.name)}|${normalize(o.address)}|${o.communeId}`);

async function ingest(inputs: unknown[], actor: string, jobId?: string, leaseToken?: string) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 200) throw new PilotError("Mỗi batch cần 1–200 observations.");
  const observations = inputs.map(validateObservation);
  // Validate all administrative IDs BEFORE committing any item.
  const units = await db.select().from(adminUnits).where(inArray(adminUnits.id, [...new Set(observations.map(o=>o.communeId))]));
  for (const o of observations) {
    const u = units.find(u=>u.id===o.communeId);
    if (!u || u.status !== "current" || u.type !== "commune" || u.parentId !== o.provinceId || !PILOT_REGIONS.includes(o.communeId)) throw new PilotError(`Địa bàn ${o.communeId} không thuộc pilot Yên Dũng hoặc không khớp tỉnh.`);
  }
  return db.transaction(async tx => {
    if (jobId) {
      if (!UUID.test(jobId)) throw new PilotError("jobId không hợp lệ.");
      const [j] = await tx.select().from(coverageJobs).where(eq(coverageJobs.id, jobId)).for("update");
      if (!j || j.status !== "running" || j.owner !== actor || !leaseToken || j.leaseToken !== leaseToken || !j.leaseUntil || j.leaseUntil < new Date()) throw new PilotError("Job chưa được nhận, lease đã hết hoặc không thuộc worker này.", 409);
      const [cell] = await tx.select().from(coverageCells).where(eq(coverageCells.id, j.cellId));
      if (observations.some(o=>o.category!==cell.category || (cell.adminId !== "h_yen_dung" && o.communeId!==cell.adminId))) throw new PilotError("Observations không khớp địa bàn/category của job.", 409);
    }
    let inserted = 0;
    for (const o of observations) {
      const rows = await tx.insert(placeObservations).values({
        fingerprint: sha(`${o.sourceType}|${o.sourceId}|${stable(o)}`), outletKey: outletIdentity(o),
        sourceType: o.sourceType, sourceId: o.sourceId, sourceUrl: o.sourceUrl, sourceGroup: sourceGroup(o.sourceUrl), observedAt: new Date(o.observedAt), payload: o, fixture: !!o.fixture,
      }).onConflictDoNothing({ target: placeObservations.fingerprint }).returning({ id: placeObservations.id });
      inserted += rows.length;
    }
    if (jobId) {
      const [j] = await tx.update(coverageJobs).set({ status: "completed", completedAt: new Date(), leaseUntil: null, leaseToken: null }).where(eq(coverageJobs.id, jobId)).returning();
      await tx.update(coverageCells).set({ lastCrawled: new Date() }).where(eq(coverageCells.id, j.cellId));
    }
    return { inserted, duplicates: observations.length-inserted, status: "pending", message: "Đã lưu observations. Chưa tạo hay xác minh địa điểm canonical." };
  });
}

async function review(outletKey: string, decision: string, note: string, actor: string) {
  if (!/^[a-f0-9]{64}$/.test(outletKey) || !["approve", "reject"].includes(decision)) throw new PilotError("Yêu cầu review không hợp lệ.");
  note = text(note, "Ghi chú xác minh", 1000);
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${outletKey}))`);
    const rows = await tx.select().from(placeObservations).where(eq(placeObservations.outletKey, outletKey)).orderBy(desc(placeObservations.observedAt)).for("update");
    if (!rows.length) throw new PilotError("Không tìm thấy nhóm observations.", 404);
    const pending = rows.filter(r=>r.status==="pending");
    if (!pending.length) return { status: rows[0].status, placeId: rows.find(r=>r.placeId)?.placeId ?? null, unchanged: true };
    if (decision === "reject") {
      await tx.update(placeObservations).set({ status: "rejected", reviewer: actor, reviewNote: note, reviewedAt: new Date() }).where(inArray(placeObservations.id, pending.map(r=>r.id)));
      return { status: "rejected" };
    }
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (row.status !== "rejected" && !latest.has(`${row.sourceType}:${row.sourceId}`)) latest.set(`${row.sourceType}:${row.sourceId}`, row);
    const active = [...latest.values()].filter(r=>Date.now()-r.observedAt.getTime()<=90*DAY);
    if (new Set(active.map(r=>r.sourceGroup)).size < 2) throw new PilotError("Cần ít nhất 2 nguồn độc lập, được ghi nhận trong 90 ngày. Hai trang cùng domain không tính là hai nguồn.", 409);
    const data = active.map(r=>r.payload as ObservationInput);
    const first = data[0];
    const values = (field: keyof ObservationInput) => data.map(d=>d[field]).filter(v=>v!=null && v!=="").map(v=>typeof v === "string" ? normalize(v) : stable(v));
    for (const field of ["category", "communeId", "provinceId"] as const) if (new Set(values(field)).size>1) throw new PilotError(`Mâu thuẫn ${field}; cần đối chiếu nguồn trước khi promote.`,409);
    if (new Set(data.map(d=>phone(d.phone)).filter(Boolean)).size>1 || new Set(data.map(d=>d.legalEntity?.taxId).filter(Boolean)).size>1) throw new PilotError("Mâu thuẫn số điện thoại hoặc MST giữa các nguồn.",409);
    const sharedSpecialties = first.specialties.filter(sp=>data.every(d=>d.specialties.some(s=>normalize(s)===normalize(sp)))) ;
    if (!sharedSpecialties.length) throw new PilotError("Chưa có specialty được các nguồn cùng xác nhận.",409);
    if (data.some(d=>d.lat!=null && first.lat!=null && (Math.abs(d.lat-first.lat)>.002 || Math.abs((d.lng ?? 0)-(first.lng ?? 0))>.002))) throw new PilotError("Tọa độ các nguồn mâu thuẫn; cần kiểm tra chi nhánh.",409);
    const fixture = active.some(r=>r.fixture);
    let entityId: string | null = null;
    const registry = data.find(d=>d.sourceType==="registry" && d.legalEntity);
    if (registry?.legalEntity) {
      const entity = registry.legalEntity;
      await tx.insert(legalEntities).values({ taxId: entity.taxId, legalName: entity.legalName, registeredAddress: entity.registeredAddress, status: fixture ? "fixture" : entity.status, sourceUrl: registry.sourceUrl, observedAt: new Date(registry.observedAt) }).onConflictDoNothing({ target: legalEntities.taxId });
      const [saved] = await tx.select().from(legalEntities).where(eq(legalEntities.taxId, entity.taxId)).for("update");
      if ((saved.status === "fixture") !== fixture || normalize(saved.legalName) !== normalize(entity.legalName)) throw new PilotError("MST đã gắn với pháp nhân khác hoặc khác lớp fixture; cần kiểm chứng riêng.", 409);
      entityId = saved.id;
    }
    const canonical = {
      name: first.name, nameSearch: normalize(first.name), address: first.address, addressSearch: normalize(first.address),
      category: first.category, categoryLabel: PILOT_LABELS[first.category], specialties: sharedSpecialties, specialtiesSearch: sharedSpecialties.map(normalize).join(" · "),
      communeId: first.communeId, provinceId: first.provinceId,
      lat: first.lat ?? null, lng: first.lng ?? null, phone: first.phone ?? null, hours: first.hours ?? null,
      source: "observations", verified: !fixture, dataClass: fixture ? "pilot-fixture" : "observed", outletKey, legalEntityId: entityId, note: fixture ? "Dữ liệu fixture kiểm thử — không phải cơ sở đã xác minh ngoài thực tế." : note,
      updatedAt: new Date(),
    };
    // Conservative indexed resolution into pre-existing canonical data. Never merge by tax ID/phone alone.
    const existing = await tx.select().from(places).where(and(eq(places.nameSearch, canonical.nameSearch), eq(places.addressSearch, canonical.addressSearch), eq(places.communeId, canonical.communeId))).limit(3).for("update");
    if (existing.length > 1) throw new PilotError("Nhiều địa điểm trùng tên/địa chỉ; cần đối chiếu thủ công trước khi gộp.",409);
    if (existing[0] && ((existing[0].dataClass === "pilot-fixture") !== fixture)) throw new PilotError("Không được dùng fixture để sửa dữ liệu canonical thực tế.",409);
    const [place] = existing.length
      ? await tx.update(places).set(canonical).where(eq(places.id,existing[0].id)).returning()
      : await tx.insert(places).values(canonical).onConflictDoUpdate({ target: places.outletKey, set: canonical }).returning();
    await tx.update(fieldProvenance).set({ chosen: false }).where(eq(fieldProvenance.placeId, place.id));
    for (let i=0;i<active.length;i++) {
      for (const field of ["name", "address", "category", "specialties", "phone", "hours", "lat", "lng", "legalEntity"] as const) {
        const value = data[i][field];
        if (value == null) continue;
        await tx.insert(fieldProvenance).values({ placeId: place.id, observationId: active[i].id, field, value, chosen: true }).onConflictDoUpdate({ target: [fieldProvenance.placeId, fieldProvenance.observationId, fieldProvenance.field], set: { chosen: true } });
      }
    }
    await tx.update(placeObservations).set({ status: "canonical", placeId: place.id, reviewer: actor, reviewNote: note, reviewedAt: new Date() }).where(inArray(placeObservations.id, active.map(r=>r.id)));
    return { status: "canonical", placeId: place.id, verified: !fixture, fixture, legalEntityId: entityId, sources: new Set(active.map(r=>r.sourceGroup)).size };
  });
}

/** Atomic demand aggregation, no read-modify-write counter races. Unknown H3 remains null. */
export async function recordPilotDemand(u: QueryUnderstanding, r: RetrievalResult) {
  const category = u.categories[0] as PilotCategory;
  if (u.intent !== "local_search" || !(PILOT_CATEGORIES as readonly string[]).includes(category)) return;
  const specific = u.locations.find(l=>l.unit.type==="commune" && l.unit.status==="current");
  const region = specific?.unit.id ?? u.locations[0]?.unit.id;
  if (!region || !PILOT_REGIONS.includes(region)) return;
  const window = new Date(Math.floor(Date.now()/(7*DAY))*(7*DAY));
  const key = `${region}|-|${category}|${window.toISOString()}`;
  const fresh = r.places.exact.filter(p=>p.updatedAt && Date.now()-p.updatedAt.getTime() < 90*DAY).length;
  const values = { key, adminId: region, provinceId: "t_bac_ninh", h3Cell: null, category, windowStart: window, demand: 1, zeroResults: r.places.exact.length ? 0 : 1, canonicalCount: r.places.exact.length, freshCount: fresh, confidence: r.places.exact.length ? .8 : .1 };
  await db.insert(coverageCells).values(values).onConflictDoUpdate({ target: coverageCells.key, set: { demand: sql`${coverageCells.demand}+1`, zeroResults: sql`${coverageCells.zeroResults}+${values.zeroResults}`, canonicalCount: values.canonicalCount, freshCount: values.freshCount, confidence: values.confidence, updatedAt: new Date() } });
}

async function planJobs() {
  const cells = await db.select().from(coverageCells).where(sql`${coverageCells.windowStart} >= now() - interval '14 days'`).limit(500);
  let count=0;
  for (const c of cells) {
    const gap = Math.max(0, 1-c.freshCount/5);
    if (!gap) continue;
    const staleness = c.lastCrawled ? Math.min(4, 1+(Date.now()-c.lastCrawled.getTime())/(30*DAY)) : 2;
    const businessValue = c.category === "nha-thuoc" ? 1.3 : 1;
    const priority = Math.round(c.demand * gap * staleness * businessValue * (1-c.confidence) * 100)/100;
    await db.insert(coverageJobs).values({ cellId: c.id, priority, plan: { region: c.adminId, category: c.category, h3: c.h3Cell, stages: ["osm-pbf", "registry", "permitted-web"], budget: { maxObservations: 200 }, factors: { demand: c.demand, gap, staleness, businessValue, confidenceDeficit: 1-c.confidence } } }).onConflictDoUpdate({ target: coverageJobs.cellId, set: { priority }, setWhere: eq(coverageJobs.status,"queued") });
    count++;
  }
  return { planned: count, note: "Chỉ tạo job có nhu cầu và thiếu dữ liệu. Chưa có crawler toàn quốc chạy trong preview." };
}

export async function pilotCommand(command: PilotCommand, actor: string): Promise<unknown> {
  switch(command.action) {
    case "ingest": return ingest(command.observations, actor, command.jobId, command.leaseToken);
    case "review": return review(command.outletKey, command.decision, command.note, actor);
    case "plan": return planJobs();
    case "claim": {
      if (!UUID.test(command.jobId)) throw new PilotError("jobId không hợp lệ.");
      const [job] = await db.update(coverageJobs).set({ status: "running", owner: actor, leaseToken: randomUUID(), leaseUntil: new Date(Date.now()+10*60_000), attempts: sql`${coverageJobs.attempts}+1` }).where(and(eq(coverageJobs.id, command.jobId), or(eq(coverageJobs.status,"queued"), and(eq(coverageJobs.status,"running"), lte(coverageJobs.leaseUntil,new Date()))))).returning();
      if (!job) throw new PilotError("Job đã được worker khác nhận hoặc hoàn tất.",409);
      return { jobId: job.id, leaseToken: job.leaseToken, leaseUntil: job.leaseUntil, plan: job.plan };
    }
    default: throw new PilotError("action không được hỗ trợ.");
  }
}

export async function pilotSnapshot(): Promise<PilotSnapshot> {
  const [obs, jobs, countO, countE, countP, pendingCount] = await Promise.all([
    db.select().from(placeObservations).orderBy(desc(placeObservations.createdAt)).limit(200),
    db.select({ job: coverageJobs, cell: coverageCells }).from(coverageJobs).innerJoin(coverageCells,eq(coverageCells.id,coverageJobs.cellId)).orderBy(desc(coverageJobs.priority)).limit(50),
    db.select({ n: sql<number>`count(*)` }).from(placeObservations), db.select({ n: sql<number>`count(*)` }).from(legalEntities),
    db.select({ n: sql<number>`count(*)` }).from(places).where(sql`${places.outletKey} is not null`),
    db.select({ n: sql<number>`count(*)` }).from(placeObservations).where(eq(placeObservations.status,"pending")),
  ]);
  const grouped = new Map<string, typeof obs>();
  for (const row of obs) grouped.set(row.outletKey,[...(grouped.get(row.outletKey) ?? []),row]);
  return { backend:"embedded", capabilities:{write:true}, summary:{observations:Number(countO[0].n),pending:Number(pendingCount[0].n),legalEntities:Number(countE[0].n),outlets:Number(countP[0].n),jobs:jobs.length},
    candidates:[...grouped].map(([key,rows])=>{const p=rows[0].payload as ObservationInput;return {key,name:p.name,address:p.address,commune:p.communeId,category:p.category,sources:new Set(rows.map(r=>r.sourceGroup)).size,status:rows.some(r=>r.status==="pending")?"pending":rows[0].status,fixture:rows.some(r=>r.fixture),observations:rows.map(r=>({id:r.id,sourceType:r.sourceType,url:r.sourceUrl,observedAt:r.observedAt.toISOString(),payload:r.payload as Record<string,unknown>}))};}),
    jobs:jobs.map(({job,cell})=>({id:job.id,region:cell.adminId,category:cell.category,demand:cell.demand,canonicalCount:cell.canonicalCount,priority:job.priority,status:job.status,h3Cell:cell.h3Cell,lastCrawled:cell.lastCrawled?.toISOString() ?? null})),
  };
}
