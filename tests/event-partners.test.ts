import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile,readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { listMatchInfoPartners,matchInfoPartnerLevel } from "../netlify/functions/_shared/event-partners.ts";
import type { DatabaseClient } from "../netlify/functions/_shared/database.ts";

test("match info partners follow confirmed contracts, legacy fallback and tenant isolation",async()=>{
  const db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
  try{
    const migrations=new URL("../netlify/database/migrations/",import.meta.url);
    for(const dir of (await readdir(migrations)).sort())await db.exec(await readFile(new URL(`${dir}/migration.sql`,migrations),"utf8"));
    const tenant=randomUUID(),other=randomUUID();
    await db.query("INSERT INTO tenants(id,slug,name) VALUES($1,'partner-test','Testverein'),($2,'partner-other','Anderer Verein')",[tenant,other]);
    await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES($1,'partner-reader','viewer'),($2,'partner-reader','viewer')",[tenant,other]);
    const version=async(name:string,club=tenant)=>{
      const pack=randomUUID(),id=randomUUID();
      await db.query("INSERT INTO sponsorship_packages(id,tenant_id,created_by) VALUES($1,$2,'fixture')",[pack,club]);
      await db.query("INSERT INTO sponsorship_package_versions(id,tenant_id,package_id,version_number,name,price_cents,duration_months,payment_plan,created_by) VALUES($1,$2,$3,1,$4,40000,12,'annual','fixture')",[id,club,pack,name]);return id;
    };
    const gold=await version('Goldsponsor'),silver=await version('Silbersponsor'),bronze=await version('Bronzesponsor');
    const sponsor=async(name:string,assigned:string|null=null,status='active',club=tenant)=>{
      const id=randomUUID();await db.query("INSERT INTO sponsors(id,tenant_id,legal_name,assigned_package_version_id,status) VALUES($1,$2,$3,$4,$5)",[id,club,name,assigned,status]);return id;
    };
    const contract=async(sponsorId:string,versionId:string,snapshot:object={},status='confirmed',club=tenant)=>{
      const id=randomUUID();await db.query(`INSERT INTO sponsorship_contracts(id,tenant_id,contract_number,sponsor_id,package_version_id,package_snapshot,status,snapshot_hash,released_at,created_by)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'fixture')`,[id,club,'MT-TEST-'+id,sponsorId,versionId,JSON.stringify(snapshot),status,status==='draft'?null:'a'.repeat(64),status==='draft'?null:new Date()]);return id;
    };
    const goldOnly=await sponsor('Gold Contract Only');await contract(goldOnly,gold,{name:'Gold Sponsoring'});
    const silverOnly=await sponsor('Silver Contract Only');await contract(silverOnly,silver,{name:'Silber Sponsoring'});
    await sponsor('Legacy Gold',gold);
    const deduplicated=await sponsor('Duplicate Partner',gold);
    await contract(deduplicated,gold,{name:'Gold'});await contract(deduplicated,gold,{name:'Gold'});await contract(deduplicated,silver,{name:'Silber'});
    const changed=await sponsor('Changed To Silver',gold);await contract(changed,silver,{name:'Silber'});
    const noLongerGold=await sponsor('Changed To Bronze',gold);await contract(noLongerGold,bronze,{name:'Bronze'});
    const snapshot=await sponsor('Snapshot Partner');await contract(snapshot,bronze,{name:'Silver Partner'});
    const fallback=await sponsor('Version Fallback');await contract(fallback,silver,{name:' '});
    for(const status of ['draft','released','void'])await contract(await sponsor('Not Confirmed '+status),gold,{name:'Gold'},status);
    await contract(await sponsor('Inactive Partner',gold,'inactive'),gold,{name:'Gold'});
    const otherGold=await version('Gold',other);await contract(await sponsor('Foreign Partner',null,'active',other),otherGold,{name:'Gold'},'confirmed',other);
    await db.exec("CREATE ROLE partner_test NOLOGIN; GRANT USAGE ON SCHEMA public TO partner_test; GRANT SELECT ON ALL TABLES IN SCHEMA public TO partner_test");
    const list=async(club:string)=>db.transaction(async tx=>{
      await tx.exec('SET LOCAL ROLE partner_test');await tx.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id','partner-reader',true)",[club]);
      const client={query:async<Row>(sql:string,params?:unknown[])=>{const result=await tx.query<Row>(sql,params);return {rows:result.rows,rowCount:result.rows.length};},release(){}} as DatabaseClient;
      return listMatchInfoPartners(client,club);
    });
    const rows=await list(tenant);
    assert.deepEqual(rows.map(row=>row.sponsorName),['Changed To Silver','Duplicate Partner','Gold Contract Only','Legacy Gold','Silver Contract Only','Snapshot Partner','Version Fallback']);
    assert.equal(matchInfoPartnerLevel(rows.find(row=>row.sponsorName==='Duplicate Partner')!.packageName),'Gold');
    assert.equal(matchInfoPartnerLevel(rows.find(row=>row.sponsorName==='Changed To Silver')!.packageName),'Silber');
    assert.deepEqual((await list(other)).map(row=>row.sponsorName),['Foreign Partner']);
  }finally{await db.close();}
});
