import "dotenv/config";
import assert from "node:assert/strict";
import { db, pool } from "../src/db";
import { legalEntities, places, placeObservations, fieldProvenance, coverageCells, coverageJobs } from "../src/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getBackend } from "../src/core/backend";
import type { ObservationInput, PilotCommand } from "../src/core/pilot";

const prefix = `pilot-test-${Date.now()}`;
const ids: string[] = [];
async function main() {
  const backend = await getBackend("embedded");
  const cmd = (c: PilotCommand) => backend.pilotCommand!(c, prefix) as Promise<Record<string, unknown>>;
  const source = (branch: string, host: string, sourceType: ObservationInput["sourceType"] = "website"): ObservationInput => ({
    sourceType, sourceId: `${prefix}-${branch}-${host}`, sourceUrl: `https://${host}.example/${prefix}/${branch}`,
    observedAt: new Date().toISOString(), name: `Cửa hàng fixture ${prefix} ${branch}`, address: `${branch === "A" ? "10" : "20"} Đường kiểm thử`,
    communeId: branch === "A" ? "x_tan_an" : "x_yen_dung", provinceId: "t_bac_ninh", category: "vlxd", specialties: ["sắt thép"], fixture: true,
    phone: "0901234567", legalEntity: { taxId: "9999999999", legalName: `Doanh nghiệp fixture ${prefix}` },
  });
  try {
    const { GET, POST } = await import("../src/app/v1/pilot/route");
    const previousAdmin = process.env.VIETSCOPE_ADMIN_KEY;
    process.env.VIETSCOPE_ADMIN_KEY = prefix;
    try {
      assert.equal((await POST(new Request("http://test/v1/pilot",{method:"POST",body:JSON.stringify({action:"plan"})}))).status,403);
      const publicResult = await (await GET(new Request("http://test/v1/pilot"))).json();
      assert.equal(publicResult.capabilities.write,false);
      assert.deepEqual(publicResult.candidates,[]);
      const privateResult = await (await GET(new Request("http://test/v1/pilot",{headers:{authorization:`Bearer ${prefix}`}}))).json();
      assert.equal(privateResult.capabilities.write,true);
      console.log("PASS pilot HTTP auth: anonymous writes denied; private source payloads redacted");
    } finally {
      if(previousAdmin === undefined) delete process.env.VIETSCOPE_ADMIN_KEY; else process.env.VIETSCOPE_ADMIN_KEY = previousAdmin;
    }
    const a = source("A","registry-test","registry");
    const first = await cmd({action:"ingest",observations:[a]});
    assert.equal(first.inserted,1);
    const duplicate = await cmd({action:"ingest",observations:[a]});
    assert.equal(duplicate.duplicates,1);
    console.log("PASS immutable observation + retry/idempotency");
    const [row] = await db.select().from(placeObservations).where(eq(placeObservations.sourceId,a.sourceId));
    await assert.rejects(cmd({action:"review",outletKey:row.outletKey,decision:"approve",note:"Review fixture"}), /2 nguồn độc lập/);
    await cmd({action:"ingest",observations:[{...a,sourceId:a.sourceId+"same-owner",sourceUrl:a.sourceUrl+"/another"}]});
    await assert.rejects(cmd({action:"review",outletKey:row.outletKey,decision:"approve",note:"Same domain"}), /2 nguồn độc lập/);
    console.log("PASS one source and two URLs from same owner cannot verify");
    const independent = source("A","merchant-test");
    await cmd({action:"ingest",observations:[independent]});
    const approved = await cmd({action:"review",outletKey:row.outletKey,decision:"approve",note:"Fixture: two independent observations; never a verified real outlet"});
    ids.push(String(approved.placeId));
    assert.equal(approved.verified,false);
    assert.equal(approved.fixture,true);
    const prov=await db.select().from(fieldProvenance).where(eq(fieldProvenance.placeId,String(approved.placeId)));
    assert(prov.length>=6);
    console.log("PASS field-level provenance and fixture cannot become real verified data");
    const [again1,again2]=await Promise.all([cmd({action:"review",outletKey:row.outletKey,decision:"approve",note:"retry"}),cmd({action:"review",outletKey:row.outletKey,decision:"approve",note:"retry"})]);
    assert.equal(again1.placeId,again2.placeId);
    const b=source("B","registry-test","registry");
    await cmd({action:"ingest",observations:[b,source("B","merchant-test")]});
    const [rb]=await db.select().from(placeObservations).where(eq(placeObservations.sourceId,b.sourceId));
    const branch=await cmd({action:"review",outletKey:rb.outletKey,decision:"approve",note:"Second branch, same legal entity"});
    ids.push(String(branch.placeId));
    assert.notEqual(branch.placeId,approved.placeId);
    assert.equal(branch.legalEntityId,approved.legalEntityId);
    console.log("PASS concurrent retries + one LegalEntity to multiple distinct outlets");
    const conflict1={...source("C","registry-test","registry"),communeId:"x_tan_an"};
    await cmd({action:"ingest",observations:[conflict1,{...conflict1,sourceId:conflict1.sourceId+"conflict",sourceUrl:`https://other.example/${prefix}`,phone:"0919999999"}]});
    const [rc]=await db.select().from(placeObservations).where(eq(placeObservations.sourceId,conflict1.sourceId));
    await assert.rejects(cmd({action:"review",outletKey:rc.outletKey,decision:"approve",note:"Must reject conflict"}), /Mâu thuẫn/);
    await assert.rejects(cmd({action:"ingest",observations:[{...source("D","x"),provinceId:"t_ha_noi"}]}), /không khớp tỉnh/);
    console.log("PASS conflicting phone + outside-pilot observation rejected");
    const search=await backend.retrieve({query:"cửa hàng sắt Tân An",record:false});
    assert(!search.places.exact.some(p=>ids.includes(p.id)) && !search.places.unverified.some(p=>ids.includes(p.id)));
    console.log("PASS fixture outlets excluded from public retrieval");
    // Isolated demand bucket so tests do not pollute real search counters.
    const [cell]=await db.insert(coverageCells).values({key:prefix,adminId:"x_tan_an",provinceId:"t_bac_ninh",category:"vlxd",windowStart:new Date(),demand:83,zeroResults:83,canonicalCount:0,freshCount:0,confidence:.1}).returning();
    await cmd({action:"plan"});
    const [job]=await db.select().from(coverageJobs).where(eq(coverageJobs.cellId,cell.id));
    assert(job.priority>0);
    const outcomes=await Promise.allSettled([cmd({action:"claim",jobId:job.id}),cmd({action:"claim",jobId:job.id})]);
    assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
    const winner = outcomes.find(o=>o.status==="fulfilled") as PromiseFulfilledResult<Record<string,unknown>>;
    const leaseToken = String(winner.value.leaseToken);
    await assert.rejects(cmd({action:"ingest",observations:[{...source("F","stale"),communeId:"x_tan_an"}],jobId:job.id,leaseToken:"stale-token"}), /lease/);
    await assert.rejects(cmd({action:"ingest",observations:[source("E","job-test")],jobId:job.id,leaseToken}), /không khớp địa bàn/);
    await cmd({action:"ingest",observations:[{...source("E","job-test"),communeId:"x_tan_an"}],jobId:job.id,leaseToken});
    const [done]=await db.select().from(coverageJobs).where(eq(coverageJobs.id,job.id));
    assert.equal(done.status,"completed");
    console.log("PASS demand-driven priority + exclusive lease + batch completion");
  } finally {
    const observations=await db.select({id:placeObservations.id}).from(placeObservations).where(sql`${placeObservations.sourceId} like ${prefix+'%'}`);
    const oids=observations.map(o=>o.id);
    if(oids.length){await db.delete(fieldProvenance).where(inArray(fieldProvenance.observationId,oids));await db.delete(placeObservations).where(inArray(placeObservations.id,oids));}
    if(ids.length)await db.delete(places).where(inArray(places.id,ids));
    await db.delete(legalEntities).where(eq(legalEntities.legalName,`Doanh nghiệp fixture ${prefix}`));
    const cells=await db.select({id:coverageCells.id}).from(coverageCells).where(eq(coverageCells.key,prefix));
    if(cells.length){await db.delete(coverageJobs).where(eq(coverageJobs.cellId,cells[0].id));await db.delete(coverageCells).where(eq(coverageCells.id,cells[0].id));}
  }
}
main().then(()=>pool.end()).catch(async e=>{console.error(e);await pool.end();process.exit(1);});
