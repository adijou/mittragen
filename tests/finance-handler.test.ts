import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile,readdir,writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PDFDocument } from "pdf-lib";
import type { DatabaseClient } from "../netlify/functions/_shared/database.ts";
import { billingSources } from "../netlify/functions/_shared/billing-sources.ts";
import { sourceMatches } from "../netlify/functions/_shared/billing-ledger.ts";
import { swissToday } from "../shared/billing.ts";

const hooks=registerHooks({load(url,context,nextLoad){
  if(url.includes("/node_modules/@netlify/identity/"))return{shortCircuit:true,format:"module",source:`
    export class AuthError extends Error {}; export const admin={}; export const getIdentityConfig=()=>{throw new Error("identity network access forbidden in this test")};
    let user; export const setTestUser=value=>{user=value};
    export const getUser=async()=>user;export const refreshSession=async()=>{};
    export const verifyRequestOrigin=request=>{if(request.headers.get('origin')!==new URL(request.url).origin)throw new Error('origin')};`};
  if(url.endsWith("/netlify/functions/_shared/database.ts"))return{shortCircuit:true,format:"module",source:`
    let session;export const setTestSession=value=>{session=value};export const withSession=(...args)=>session(...args);
    export const isUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);`};
  return nextLoad(url,context);
}});
const {default:handler}=await import("../netlify/functions/finance.mts");
const {default:contractHandler}=await import("../netlify/functions/contracts.mts");
const {default:bookHandler}=await import("../netlify/functions/event-sponsoring-public.mts");
const {preparePostal,sendPostal}=await import("../netlify/functions/_shared/postal-dispatch.ts");
const {sendInvoiceEmail}=await import("../netlify/functions/_shared/invoice-email.ts");
const {setTestSession}=await import("../netlify/functions/_shared/database.ts") as never as {setTestSession:(fn:unknown)=>void};
const {setTestUser}=await import("@netlify/identity") as never as {setTestUser:(user:unknown)=>void};
hooks.deregister();

test("finance routes enforce real PostgreSQL isolation, money allocation and retry safety",async(t)=>{
  const db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
  try{
    const migrations=new URL("../netlify/database/migrations/",import.meta.url);
    for(const directory of (await readdir(migrations)).sort())await db.exec(await readFile(new URL(`${directory}/migration.sql`,migrations),"utf8"));
    await db.exec("CREATE ROLE finance_test NOLOGIN; GRANT USAGE ON SCHEMA public TO finance_test; GRANT ALL ON ALL TABLES IN SCHEMA public TO finance_test; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO finance_test;");
    const session=async<T>(id:string,tenant:string|null,operation:(client:DatabaseClient)=>Promise<T>,email?:string)=>db.transaction(async tx=>{
      await tx.exec("SET LOCAL ROLE finance_test");
      await tx.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('app.user_email',$3,true)",[id,tenant??"",email??""]);
      return operation({query:async<Row>(sql:string,values?:unknown[])=>{const result=await tx.query<Row>(sql,values);return{rows:result.rows,rowCount:result.affectedRows??result.rows.length};},release(){}});
    });setTestSession(session);
    Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>name==="BILLING_OPERATOR_USER_IDS"?"operator":undefined}}});
    const tenantA=randomUUID(),tenantB=randomUUID(),eventA=randomUUID(),eventB=randomUUID();
    const bookingA=randomUUID(),bookingB=randomUUID(),legacy=randomUUID(),cash=randomUUID();
    await db.query("INSERT INTO tenants(id,slug,name) VALUES ($1,'billing-a','Verein A'),($2,'billing-b','Verein B')",[tenantA,tenantB]);
    await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES ($1,'operator','owner'),($1,'club-owner','owner'),($1,'reader','viewer'),($2,'operator','owner')",[tenantA,tenantB]);
    for(const [tenant,event] of [[tenantA,eventA],[tenantB,eventB]])await db.query("INSERT INTO sponsorship_events(id,tenant_id,team_name,opponent,starts_at,price_cents,status,created_by) VALUES ($1,$2,'FC Beispiel','FC Gast','2026-10-01',100000,'published','fixture')",[event,tenant]);
    for(const [id,tenant,event,bp,mode,ref] of [[bookingA,tenantA,eventA,250,"invoice","AAAAAAAA"],[bookingB,tenantB,eventB,250,"invoice","BBBBBBBB"],[legacy,tenantA,eventA,0,"invoice","CCCCCCCC"],[cash,tenantA,eventA,0,"cash","DDDDDDDD"]])await db.query(`INSERT INTO event_sponsorship_bookings
      (id,tenant_id,event_id,reference,sponsor_name,address,postal_code,city,contact_name,contact_email,payment_mode,amount_cents,fee_basis_points)
      VALUES ($1,$2,$3,$4,'Muster Sponsor AG','Hauptstrasse 1','3186','Düdingen','Max Muster','test@example.invalid',$5,100000,$6)`,[id,tenant,event,`MB-2026-${ref}`,mode,bp]);
    let user="operator";setTestUser({id:user,email:"operator@example.invalid"});
    const request=(tenant:string,path="",body?:object,extra:Record<string,string>={})=>new Request(`https://test.invalid/api/finance/${tenant}${path}`,{method:body?"POST":"GET",headers:{Origin:"https://test.invalid","X-Sponsor-Account":user,...extra},body:body?JSON.stringify(body):undefined});
    const call=async(tenant:string,path="",body?:object,status=200)=>{const result=await handler(request(tenant,path,body),{requestId:"finance-test"} as never);const data=await result.json();assert.equal(result.status,status,JSON.stringify(data));return data;};
    let invoiceId="",invoiceB="",receiptId="",payoutId="";
    await t.test("no session, wrong account and non-member requests cannot read or write",async()=>{
      setTestUser(null);await call(tenantA,"",undefined,401);setTestUser({id:"stranger"});user="stranger";await call(tenantA,"",undefined,403);
      user="operator";setTestUser({id:user});const result=await handler(request(tenantA,"",undefined,{"X-Sponsor-Account":"another-account"}),{requestId:"test"} as never);assert.equal(result.status,409);
      const origin=await handler(request(tenantA,"/invoices",{sourceKey:`event:${bookingA}`},{Origin:"https://evil.invalid"}),{requestId:"test"} as never);assert.equal(origin.status,403);
    });
    await t.test("only invoice-mode bookings are listed and existing contributions retain zero surcharge",async()=>{
      const data=await call(tenantA);assert.equal(data.sources.length,2);
      assert.equal(data.sources.find((row:{sourceId:string})=>row.sourceId===legacy).platformFeeCents,0);
      assert.equal(data.sources.find((row:{sourceId:string})=>row.sourceId===bookingA).platformFeeCents,2500);
      assert.equal(data.readiness.postalSendingEnabled,false);
      await call(tenantA,"/invoices",{sourceKey:`event:${bookingB}`},409);
    });
    await t.test("repeated draft creation is idempotent and ignores client supplied amounts",async()=>{
      const first=await call(tenantA,"/invoices",{sourceKey:`event:${bookingA}`,contributionCents:1},201);invoiceId=first.invoice.id;
      assert.equal(first.invoice.contribution_cents,100000);assert.equal(first.invoice.platform_fee_cents,2500);
      assert.equal((await call(tenantA,"/invoices",{sourceKey:`event:${bookingA}`},201)).invoice.id,invoiceId);
      invoiceB=(await call(tenantB,"/invoices",{sourceKey:`event:${bookingB}`},201)).invoice.id;
    });
    await t.test("club owners cannot attest central bank movements; viewers cannot create drafts",async()=>{
      user="club-owner";setTestUser({id:user});await call(tenantA,`/invoices/${invoiceId}/receipts`,{},403);
      user="reader";setTestUser({id:user});await call(tenantA,"/invoices",{sourceKey:`event:${legacy}`},403);
      user="operator";setTestUser({id:user});
    });
    const partial={idempotencyKey:randomUUID(),amountCents:51250,receivedOn:"2026-08-31",bankReference:"BANK-IN-001",bankEvidenceConfirmed:true};
    await t.test("partial receipt is split, replay is harmless, conflicting replay and overpayment rejected",async()=>{
      receiptId=(await call(tenantA,`/invoices/${invoiceId}/receipts`,partial,201)).id;
      assert.equal((await call(tenantA,`/invoices/${invoiceId}/issue`,{detailsConfirmed:true},409)).error,"billing_invoice_already_received");
      assert.equal((await call(tenantA,`/invoices/${invoiceId}/receipts`,partial,201)).id,receiptId);
      await call(tenantA,`/invoices/${invoiceId}/receipts`,{...partial,amountCents:5},409);
      await call(tenantA,`/invoices/${invoiceId}/receipts`,{...partial,idempotencyKey:randomUUID(),bankReference:"OVER",amountCents:51251},409);
      const data=await call(tenantA);assert.equal(data.receipts.length,1);assert.equal(data.receipts[0].club_cents,50000);assert.equal(data.receipts[0].platform_cents,1250);
    });
    await t.test("one bank transaction cannot credit two clubs",async()=>{
      await call(tenantB,`/invoices/${invoiceB}/receipts`,{...partial,idempotencyKey:randomUUID()},409);
      assert.equal((await call(tenantB)).receipts.length,0);
    });
    await t.test("monthly batch reserves only actual club receipts and cannot duplicate its allocation",async()=>{
      payoutId=(await call(tenantA,"/payouts",{month:"2026-08"},201)).id;
      assert.equal((await call(tenantA,"/payouts",{month:"2026-08"},201)).id,payoutId);
      const data=await call(tenantA);assert.equal(Number(data.payouts[0].amount_cents),50000);assert.equal(data.receipts[0].payout_id,payoutId);
      await call(tenantA,"/payouts",{month:"2026-07"},409);
      await call(tenantA,"/payouts",{month:"2200-01"},422);
      await call(tenantA,`/receipts/${receiptId}/reverse`,{reason:"Already in payout"},409);
    });
    await t.test("payout recording requires bank evidence and is repeat-safe",async()=>{
      await call(tenantA,`/payouts/${payoutId}/paid`,{paidOn:"2026-09-02",bankReference:"OUT-1"},422);
      const body={paidOn:"2026-09-02",bankReference:"OUT-1",bankEvidenceConfirmed:true};
      await call(tenantA,`/payouts/${payoutId}/paid`,{...body,paidOn:"2026-08-30"},422);
      await call(tenantA,`/payouts/${payoutId}/paid`,body);await call(tenantA,`/payouts/${payoutId}/paid`,body);
      await call(tenantA,`/payouts/${payoutId}/paid`,{...body,bankReference:"OUT-2"},409);
      await call(tenantA,`/payouts/${payoutId}/discard`,{reason:"Cannot undo real payout"},409);
    });
    await t.test("a wrong unassigned receipt can be reversed without deleting evidence",async()=>{
      const body={...partial,idempotencyKey:randomUUID(),bankReference:"BANK-IN-002",receivedOn:"2026-09-01"};
      const id=(await call(tenantA,`/invoices/${invoiceId}/receipts`,body,201)).id;
      await call(tenantA,`/receipts/${id}/reverse`,{reason:"Betrag falsch zugeordnet"});
      const data=await call(tenantA);assert.equal(data.receipts.length,2);assert.equal(Number(data.invoices[0].received_cents),51250);
      assert.ok(data.receipts.find((row:{id:string})=>row.id===id).reversed_at);
    });
    await t.test("database RLS and PDF access cannot cross the tenant boundary",async()=>{
      const rows=await session("operator",tenantB,client=>client.query("SELECT id FROM billing_invoices WHERE id=$1",[invoiceId]));assert.equal(rows.rows.length,0);
      await call(tenantB,`/invoices/${invoiceId}/pdf`,undefined,404);
      const result=await handler(request(tenantA,`/invoices/${invoiceId}/pdf`),{requestId:"pdf-test"} as never);assert.equal(result.status,200);
      const bytes=new Uint8Array(await result.arrayBuffer());const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getSubject(),"Entwurf - keine Zahlungsaufforderung");
      if(process.env.BILLING_PDF_FIXTURE)await writeFile(process.env.BILLING_PDF_FIXTURE,bytes);
    });
    await t.test("cancellation blocks further collection against an obsolete source",async()=>{
      await db.query("UPDATE event_sponsorship_bookings SET status='cancelled' WHERE id=$1",[bookingA]);
      assert.equal((await call(tenantA)).invoices[0].sourceAvailable,false);
      await call(tenantA,`/invoices/${invoiceId}/receipts`,{...partial,idempotencyKey:randomUUID(),bankReference:"AFTER-CANCEL"},409);
    });
    await t.test("an unexecuted payout can be discarded, corrected and rebuilt with an audit trail",async()=>{
      const entry=await call(tenantB,`/invoices/${invoiceB}/receipts`,{...partial,idempotencyKey:randomUUID(),bankReference:"BANK-B-002"},201);
      const prepared=await call(tenantB,"/payouts",{month:"2026-08"},201);
      await call(tenantB,`/payouts/${prepared.id}/discard`,{reason:"Bankeingang muss korrigiert werden"});
      const data=await call(tenantB);assert.equal(data.payouts.length,0);assert.equal(data.receipts[0].payout_id,null);
      await call(tenantB,`/receipts/${entry.id}/reverse`,{reason:"Falscher Betrag erfasst"});
      assert.ok((await db.query("SELECT id FROM audit_events WHERE object_id=$1 AND action='billing.payout_preparation_discarded'",[prepared.id])).rows.length);
    });
    await t.test("corrective contract versions cannot bill overlapping periods under a new number",async()=>{
      const sponsor=randomUUID(),pack=randomUUID(),version=randomUUID(),root=randomUUID(),revision=randomUUID();
      await db.query("INSERT INTO sponsors(id,tenant_id,legal_name) VALUES($1,$2,'Vertragssponsor')",[sponsor,tenantA]);
      await db.query("INSERT INTO sponsorship_packages(id,tenant_id,created_by) VALUES($1,$2,'fixture')",[pack,tenantA]);
      await db.query("INSERT INTO sponsorship_package_versions(id,tenant_id,package_id,version_number,name,price_cents,duration_months,payment_plan,created_by) VALUES($1,$2,$3,1,'Jahrespaket',10001,12,'quarterly','fixture')",[version,tenantA,pack]);
      const snapshot={name:"Jahrespaket",priceCents:10001,durationMonths:12,paymentPlan:"quarterly",validFrom:"2026-07-01",validUntil:"2027-06-30",rights:[]};
      const insert=async(id:string,parent:string|null,number:string,data:object)=>db.query(`INSERT INTO sponsorship_contracts
        (id,tenant_id,parent_contract_id,contract_number,sponsor_id,package_version_id,package_snapshot,sponsor_snapshot,organization_snapshot,status,snapshot_hash,released_at,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'{"legalName":"Vertragssponsor","street":"Testweg 1","postalCode":"8000","city":"Zürich"}'::jsonb,'{"legalName":"Verein A","street":"Testweg 2","postalCode":"8000","city":"Zürich","country":"CH"}'::jsonb,'confirmed',$8,now(),'fixture')`,[id,tenantA,parent,number,sponsor,version,JSON.stringify(data),"a".repeat(64)]);
      await insert(root,null,"MT-2026-TEST1",snapshot);
      const created=await call(tenantA,"/invoices",{sourceKey:`contract:${root}:2026-07-01`},201);
      assert.equal(created.invoice.contribution_cents,2500);assert.equal(created.invoice.platform_fee_cents,0);
      await db.query("UPDATE sponsorship_contracts SET status='void',voided_at=now(),voided_by='fixture',void_reason='Korrektur' WHERE id=$1",[root]);
      await insert(revision,root,"MT-2026-TEST2",{...snapshot,paymentPlan:"annual",validFrom:"2026-08-01",validUntil:"2027-07-31",billing:{feeBasisPoints:250,collectionNotice:"Testgebühr"}});
      const rejected=await call(tenantA,"/invoices",{sourceKey:`contract:${root}:2026-08-01`},409);assert.equal(rejected.error,"billing_period_overlap");
      assert.equal((await call(tenantA,`/invoices/${invoiceId}/refresh`,{},409)).error,"billing_invoice_already_received");
      const path=`/invoices/${created.invoice.id}/refresh`;
      const selected={sourceKey:`contract:${root}:2026-08-01`};
      const before=(await call(tenantA)).invoices.find((row:{id:string})=>row.id===created.invoice.id);
      assert.equal(before.sourceAvailable,false);assert.equal(before.refreshSources.length,1);
      assert.equal(before.refreshSources[0].platformFeeCents,250);
      await call(tenantB,path,selected,404);
      user="reader";setTestUser({id:user});await call(tenantA,path,selected,403);
      user="club-owner";setTestUser({id:user});
      await call(tenantA,path,{sourceKey:`event:${bookingB}`},409);
      const blocker=randomUUID();
      await db.query(`INSERT INTO billing_invoices(id,tenant_id,source_type,source_id,source_key,reference,description,recipient,issuer,contribution_cents,fee_basis_points,platform_fee_cents,created_by,period_start,period_end)
        SELECT $2,tenant_id,source_type,source_id,$3,'ENT-TEST-BLOCK','Other period',recipient,issuer,contribution_cents,fee_basis_points,platform_fee_cents,created_by,'2026-10-01','2026-12-31' FROM billing_invoices WHERE id=$1`,[created.invoice.id,blocker,`contract:${root}:2026-10-01`]);
      assert.equal((await call(tenantA,path,selected,409)).error,"billing_period_overlap");
      await db.query("DELETE FROM billing_invoices WHERE id=$1",[blocker]);
      const refreshed=(await call(tenantA,path,selected)).invoice;
      assert.equal(refreshed.id,created.invoice.id);assert.equal(refreshed.reference,created.invoice.reference);
      assert.equal(refreshed.source_key,selected.sourceKey);assert.equal(refreshed.source_id,revision);
      assert.equal(refreshed.period_start.slice(0,10),"2026-08-01");assert.equal(refreshed.period_end.slice(0,10),"2027-07-31");
      assert.equal(refreshed.contribution_cents,10001);assert.equal(refreshed.platform_fee_cents,250);
      assert.equal((await call(tenantA,path,selected)).invoice.id,created.invoice.id);
      assert.equal((await call(tenantA)).invoices.find((row:{id:string})=>row.id===created.invoice.id).sourceAvailable,true);
      assert.equal((await db.query("SELECT count(*)::integer count FROM billing_invoices WHERE tenant_id=$1 AND source_key LIKE $2",[tenantA,`contract:${root}:%`])).rows[0].count,1);
      Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>({BILLING_OPERATOR_USER_IDS:"operator",BILLING_QR_CREDITOR:JSON.stringify({iban:"CH4431999123000889012",name:"Test Inkasso",street:"",houseNumber:"",postalCode:"8000",city:"Zürich",country:"CH"})}[name])}}});
      await call(tenantA,`/invoices/${created.invoice.id}/issue`,{detailsConfirmed:true});
      await call(tenantA,path,selected,409);
      const replacement=(await call(tenantA,`/invoices/${created.invoice.id}/recreate`,{confirmed:true,reason:'Bestätigte Vertragskorrektur',...selected})).invoice;
      assert.equal(replacement.source_id,revision);assert.equal(replacement.platform_fee_cents,250);
      assert.equal(replacement.replacement_for,created.invoice.id);
      await call(tenantA,`/invoices/${replacement.id}/refresh`,selected);
      await call(tenantA,`/invoices/${replacement.id}/cancel`,{confirmed:true,reason:'Neue Abrechnung vorbereiten'});
      // Both predecessor periods are cancelled, so the same confirmed period can be billed again.
      await call(tenantA,'/invoices',selected,201);
      user="operator";setTestUser({id:user});

    });
    await t.test("open-ended annual billing offers only the current year and retains earlier invoices across renewal",async()=>{
      user="operator";setTestUser({id:user});
      const year=Number(swissToday().slice(0,4));
      const sponsor=randomUUID(),pack=randomUUID(),version=randomUUID(),contract=randomUUID();
      await db.query("INSERT INTO sponsors(id,tenant_id,legal_name) VALUES($1,$2,'Unbefristeter Testsponsor')",[sponsor,tenantA]);
      await db.query("INSERT INTO sponsorship_packages(id,tenant_id,created_by) VALUES($1,$2,'fixture')",[pack,tenantA]);
      await db.query("INSERT INTO sponsorship_package_versions(id,tenant_id,package_id,version_number,name,price_cents,duration_months,payment_plan,created_by) VALUES($1,$2,$3,1,'Jahrespaket',40000,12,'annual','fixture')",[version,tenantA,pack]);
      const snapshot={name:"Jahrespaket",priceCents:40000,durationMonths:12,paymentPlan:"annual",validFrom:`${year-3}-01-01`,validUntil:null,rights:[],billing:{feeBasisPoints:250,collectionNotice:"Verein und 2.5 % Plattformgebühr"}};
      await db.query(`INSERT INTO sponsorship_contracts
        (id,tenant_id,contract_number,sponsor_id,package_version_id,package_snapshot,sponsor_snapshot,organization_snapshot,status,snapshot_hash,released_at,created_by)
        VALUES($1,$2,'MT-TEST-ANNUAL',$3,$4,$5::jsonb,'{"legalName":"Unbefristeter Testsponsor"}'::jsonb,'{"legalName":"Verein A"}'::jsonb,'confirmed',$6,now(),'fixture')`,[contract,tenantA,sponsor,version,JSON.stringify(snapshot),"b".repeat(64)]);
      const data=await call(tenantA);
      const annualSources=data.sources.filter((row:{sourceId:string})=>row.sourceId===contract);
      assert.equal(annualSources.length,1);
      assert.equal(annualSources[0].periodStart,`${year}-01-01`);
      assert.equal(annualSources[0].periodEnd,`${year}-12-31`);
      assert.equal(data.unresolved.some((row:{reference:string})=>row.reference==='MT-TEST-ANNUAL'),false);
      await call(tenantA,"/invoices",{sourceKey:`contract:${contract}:${year-1}-01-01`},409);
      await call(tenantA,"/invoices",{sourceKey:`contract:${contract}:${year+1}-01-01`},409);
      await call(tenantB,"/invoices",{sourceKey:annualSources[0].sourceKey},409);
      const invoice=(await call(tenantA,"/invoices",{sourceKey:annualSources[0].sourceKey},201)).invoice;
      assert.equal(invoice.contribution_cents,40000);assert.equal(invoice.platform_fee_cents,1000);
      assert.equal((await call(tenantA,"/invoices",{sourceKey:annualSources[0].sourceKey},201)).invoice.id,invoice.id);
      assert.equal((await call(tenantA)).sources.some((row:{sourceId:string})=>row.sourceId===contract),false);
      const renewal=await session(user,tenantA,client=>billingSources(client,tenantA,`${year+1}-01-01`));
      assert.equal(sourceMatches(invoice,renewal.sources),true);
      const next=renewal.sources.filter(row=>row.sourceId===contract&&row.canCreateDraft);
      assert.equal(next.length,1);assert.equal(next[0].periodStart,`${year+1}-01-01`);
      assert.equal(next[0].contributionCents,40000);assert.equal(next[0].platformFeeCents,1000);
      const missingStart=await db.query("SELECT package_snapshot FROM sponsorship_contracts WHERE id=$1",[contract]);
      assert.equal((missingStart.rows[0].package_snapshot as typeof snapshot).validUntil,null);
      // An imported prior-year invoice may be corrected, but cannot be created as new back-billing.
      const historical=randomUUID(),historicalKey=`contract:${contract}:${year-1}-01-01`;
      await db.query(`INSERT INTO billing_invoices(id,tenant_id,source_type,source_id,source_key,reference,description,recipient,issuer,contribution_cents,fee_basis_points,platform_fee_cents,created_by,period_start,period_end)
        SELECT $2,tenant_id,source_type,source_id,$3,'ENT-HISTORICAL-TEST',description,recipient,issuer,contribution_cents,fee_basis_points,platform_fee_cents,created_by,$4,$5 FROM billing_invoices WHERE id=$1`,[invoice.id,historical,historicalKey,`${year-1}-01-01`,`${year-1}-12-31`]);
      const replacement=(await call(tenantA,`/invoices/${historical}/recreate`,{confirmed:true,reason:'Historische Rechnung korrigieren',sourceKey:historicalKey})).invoice;
      assert.equal(replacement.period_start.slice(0,10),`${year-1}-01-01`);assert.equal(replacement.replacement_for,historical);
      assert.equal((await call(tenantA)).sources.some((row:{sourceKey:string})=>row.sourceKey===historicalKey),false);
    });
    await t.test("QR issuance is tenant-scoped, atomic, immutable and repeat-safe",async()=>{
      // SIX public example account: no actual customer account data in fixtures.
      const creditor={iban:"CH4431999123000889012",name:"Test Inkasso",street:"",houseNumber:"",postalCode:"8000",city:"Zürich",country:"CH"};
      const env:Record<string,string>={BILLING_OPERATOR_USER_IDS:"operator"};
      Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>env[name]}}});
      const draft=(await call(tenantA,"/invoices",{sourceKey:`event:${legacy}`},201)).invoice;
      await call(tenantA,`/invoices/${draft.id}/issue`,{detailsConfirmed:true},422);
      env.BILLING_QR_CREDITOR=JSON.stringify(creditor);
      await call(tenantB,`/invoices/${draft.id}/issue`,{detailsConfirmed:true},404);
      await call(tenantA,`/invoices/${draft.id}/issue`,{},422);
      user="reader";setTestUser({id:user});await call(tenantA,`/invoices/${draft.id}/issue`,{detailsConfirmed:true},403);
      user="club-owner";setTestUser({id:user});
      await db.query("UPDATE event_sponsorship_bookings SET city='Bern',postal_code='3000' WHERE id=$1",[legacy]);
      assert.equal((await call(tenantA,`/invoices/${draft.id}/issue`,{detailsConfirmed:true},409)).error,"billing_draft_outdated");
      await call(tenantA,"/invoices",{sourceKey:`event:${legacy}`,refresh:true},201);
      await db.query("UPDATE event_sponsorship_bookings SET city=repeat('i',36) WHERE id=$1",[legacy]);
      await call(tenantA,"/invoices",{sourceKey:`event:${legacy}`,refresh:true},201);
      await call(tenantA,`/invoices/${draft.id}/issue`,{detailsConfirmed:true},422);
      assert.equal((await db.query("SELECT invoice_id FROM billing_invoice_documents WHERE invoice_id=$1",[draft.id])).rows.length,0);
      assert.equal((await call(tenantA)).invoices.find((row:{id:string})=>row.id===draft.id).status,"draft");
      await db.query("UPDATE event_sponsorship_bookings SET city='Bern' WHERE id=$1",[legacy]);
      await call(tenantA,"/invoices",{sourceKey:`event:${legacy}`,refresh:true},201);
      const issued=(await call(tenantA,`/invoices/${draft.id}/issue`,{detailsConfirmed:true,amountCents:1})).invoice;
      assert.equal(issued.status,"issued");assert.equal(issued.platform_fee_cents,0);assert.match(issued.invoice_number,/^RE-\d{4}-\d{8}$/);
      assert.match(issued.qr_reference,/^\d{27}$/);assert.equal(issued.payment_creditor.name,creditor.name);
      assert.equal((await call(tenantA,`/invoices/${draft.id}/issue`,{detailsConfirmed:true})).invoice.invoice_number,issued.invoice_number);
      await call(tenantA,"/invoices",{sourceKey:`event:${legacy}`,refresh:true},409);
      const pdf=async()=>new Uint8Array(await (await handler(request(tenantA,`/invoices/${draft.id}/pdf`),{requestId:"qr-pdf"} as never)).arrayBuffer());
      const bytes=await pdf();assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
      if(process.env.BILLING_QR_PDF_FIXTURE)await writeFile(process.env.BILLING_QR_PDF_FIXTURE,bytes);
      env.BILLING_QR_CREDITOR="invalid";
      await db.query("UPDATE event_sponsorship_bookings SET status='cancelled' WHERE id=$1",[legacy]);
      assert.deepEqual(await pdf(),bytes);
      assert.equal((await call(tenantA,`/invoices/${draft.id}/issue`,{detailsConfirmed:true})).invoice.invoice_number,issued.invoice_number);
      assert.equal((await session("operator",tenantB,client=>client.query("SELECT invoice_id FROM billing_invoice_documents WHERE invoice_id=$1",[draft.id]))).rows.length,0);
      await assert.rejects(db.query("UPDATE billing_invoices SET description='changed' WHERE id=$1",[draft.id]),/immutable/);
      await assert.rejects(db.query("DELETE FROM billing_invoice_documents WHERE invoice_id=$1",[draft.id]),/immutable/);
      user="operator";setTestUser({id:user});env.BILLING_QR_CREDITOR=JSON.stringify(creditor);
      await call(tenantA,`/invoices/${draft.id}/receipts`,{...partial,idempotencyKey:randomUUID(),bankReference:"ISSUED-IN",amountCents:100000},201);
      // A different tenant receives another global reference, with the disclosed 2.5% fee intact.
      const other=(await call(tenantB,`/invoices/${invoiceB}/issue`,{detailsConfirmed:true})).invoice;
      assert.notEqual(other.qr_reference,issued.qr_reference);assert.equal(other.platform_fee_cents,2500);
      if(process.env.BILLING_QR_FEE_PDF_FIXTURE){const response=await handler(request(tenantB,`/invoices/${invoiceB}/pdf`),{requestId:"qr-fee-pdf"} as never);await writeFile(process.env.BILLING_QR_FEE_PDF_FIXTURE,new Uint8Array(await response.arrayBuffer()));}
      const audit=await db.query("SELECT id FROM audit_events WHERE object_id=$1 AND action='billing.invoice_issued'",[draft.id]);assert.equal(audit.rows.length,1);
    });
    await t.test("only a disclosed public price can be booked and retries cannot create duplicate fees",async()=>{
      const key="a".repeat(36);
      await db.query("INSERT INTO tenant_event_sponsoring_settings(tenant_id,public_key,is_published) VALUES ($1,$2,true)",[tenantA,key]);
      await db.query("UPDATE sponsorship_events SET starts_at=now()+interval '1 day' WHERE id=$1",[eventA]);
      Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>({BILLING_ENABLED:"true",BILLING_OPERATOR_NAME:"Test Inkasso"}[name])}}});
      const body={eventId:eventA,sponsorName:"Neuer Sponsor",address:"Teststrasse 10",postalCode:"3186",city:"Düdingen",contactName:"Test Person",contactEmail:"test@example.invalid",contactPhone:"",referredByMember:"",includeFnMention:false,paymentMode:"invoice",termsAccepted:true,website:"",startedAt:Date.now()-5000,idempotencyKey:randomUUID(),expectedTotalCents:102500,expectedFeeBasisPoints:250};
      const post=async(value:object)=>bookHandler(new Request(`https://test.invalid/api/event-sponsoring-public/${key}/book`,{method:"POST",headers:{Origin:"https://test.invalid"},body:JSON.stringify(value)}),{requestId:"booking-test"} as never);
      assert.equal((await post({...body,expectedTotalCents:100000})).status,409);
      const result=await post(body);assert.equal(result.status,201);const saved=(await result.json()).booking;
      assert.equal(saved.amountCents,102500);assert.equal(saved.paymentMode,"invoice");
      assert.equal((await post(body)).status,201);
      assert.equal((await post({...body,sponsorName:"Another Sponsor"})).status,409);
      assert.equal((await post({...body,paymentMode:"cash"})).status,409);
      assert.equal((await post({...body,includeFnMention:true})).status,409);
      const rows=await db.query<{id:string;fee_basis_points:number;amount_cents:number;collection_notice:string}>("SELECT id,fee_basis_points,amount_cents,collection_notice FROM event_sponsorship_bookings WHERE checkout_key=$1",[body.idempotencyKey]);
      assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].fee_basis_points,250);assert.equal(rows.rows[0].amount_cents,100000);assert.match(rows.rows[0].collection_notice,/Test Inkasso/);
      const finance=await call(tenantA);
      assert.ok(finance.sources.some((row:{sourceId:string})=>row.sourceId===rows.rows[0].id));
      assert.equal(finance.invoices.some((row:{source_id:string})=>row.source_id===rows.rows[0].id),false);
    });
    await t.test("cash matchball collection retains disclosed fees without automatic invoices, dispatches or bank credits",async()=>{
      const key="a".repeat(36),checkoutKey=randomUUID();
      const body={eventId:eventA,sponsorName:"Barsponsor",address:"Testweg 1",postalCode:"3186",city:"Düdingen",contactName:"Test Person",contactEmail:"cash@example.invalid",contactPhone:"",referredByMember:"Test Mitglied",includeFnMention:false,paymentMode:"cash",termsAccepted:true,website:"",startedAt:Date.now()-5000,idempotencyKey:checkoutKey,expectedTotalCents:102500,expectedFeeBasisPoints:250};
      const post=(value:object)=>bookHandler(new Request(`https://test.invalid/api/event-sponsoring-public/${key}/book`,{method:"POST",headers:{Origin:"https://test.invalid"},body:JSON.stringify(value)}),{requestId:"cash-booking-test"} as never);
      const before=await call(tenantA);
      const originalFetch=globalThis.fetch;let networkCalls=0;
      globalThis.fetch=(async()=>{networkCalls++;throw new Error("Booking must not send mail or post");}) as typeof fetch;
      try{
        for(const invalid of [{expectedTotalCents:100000},{expectedFeeBasisPoints:0},{idempotencyKey:null}])assert.equal((await post({...body,...invalid})).status,409);
        const response=await post(body);assert.equal(response.status,201);
        const first=(await response.json()).booking;assert.equal(first.paymentMode,"cash");assert.equal(first.amountCents,102500);
        const replay=await post(body);assert.equal(replay.status,201);assert.deepEqual((await replay.json()).booking,first);
        for(const change of [{paymentMode:"invoice"},{includeFnMention:true}])assert.equal((await post({...body,...change})).status,409);
        const rows=await db.query<{id:string;payment_mode:string;fee_basis_points:number;amount_cents:number;collection_notice:string;referred_by_member:string}>("SELECT id,payment_mode,fee_basis_points,amount_cents,collection_notice,referred_by_member FROM event_sponsorship_bookings WHERE checkout_key=$1",[checkoutKey]);
        assert.equal(rows.rows.length,1);const booking=rows.rows[0];
        assert.equal(booking.payment_mode,"cash");assert.equal(booking.amount_cents,100000);assert.equal(booking.fee_basis_points,250);assert.equal(booking.referred_by_member,"Test Mitglied");
        assert.match(booking.collection_notice,/inklusive Plattformgebühr/);assert.match(booking.collection_notice,/bar einkassiert/);assert.doesNotMatch(booking.collection_notice,/Test Inkasso|monatlich/);
        const after=await call(tenantA);
        assert.equal(after.sources.some((row:{sourceId:string})=>row.sourceId===booking.id),false);
        assert.deepEqual(after.invoices,before.invoices);assert.deepEqual(after.receipts,before.receipts);
        assert.deepEqual(after.dispatches,before.dispatches);assert.deepEqual(after.emailDispatches,before.emailDispatches);
        assert.equal((await call(tenantA,"/invoices",{sourceKey:`event:${booking.id}`},409)).error,"billing_source_unavailable");
        assert.equal(networkCalls,0);
      }finally{globalThis.fetch=originalFetch;}
    });
    await t.test("package-based correction drafts can add a disclosed fee and retain it on release",async()=>{
      user="operator";setTestUser({id:user,email:"operator@example.invalid"});
      const env:Record<string,string>={BILLING_OPERATOR_NAME:"Test Inkasso"};
      Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>env[name]}}});
      const sponsor=randomUUID(),pack=randomUUID(),version=randomUUID();
      await db.query("INSERT INTO sponsors(id,tenant_id,legal_name,street,postal_code,city,contact_name,contact_email) VALUES($1,$2,'Paket Testsponsor','Testweg 1','8000','Zürich','Test Person','test@example.invalid')",[sponsor,tenantA]);
      await db.query("INSERT INTO tenant_contract_settings(tenant_id,legal_name,street,postal_code,city,representative_name,representative_title,contact_email,updated_by) VALUES($1,'Testverein','Testweg 2','8000','Zürich','Test Person','Vorstand','club@example.invalid','fixture') ON CONFLICT(tenant_id) DO NOTHING",[tenantA]);
      await db.query("INSERT INTO sponsorship_packages(id,tenant_id,created_by) VALUES($1,$2,'fixture')",[pack,tenantA]);
      await db.query("INSERT INTO sponsorship_package_versions(id,tenant_id,package_id,version_number,name,price_cents,duration_months,payment_plan,status,valid_from,valid_until,created_by) VALUES($1,$2,$3,1,'Paketpreis',40000,12,'annual','published','2026-01-01','2026-12-31','fixture')",[version,tenantA,pack]);
      const contractCall=async(method:string,path:string,body:object,status=200)=>{
        const response=await contractHandler(new Request(`https://test.invalid/api/contracts/${tenantA}${path}`,{method,headers:{Origin:"https://test.invalid","X-Sponsor-Account":user},body:JSON.stringify(body)}),{requestId:"contract-billing-test"} as never);
        const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
      };
      const selection={sponsorId:sponsor,packageVersionId:version,annualValueCents:1,usePackagePrice:true};
      const original=(await contractCall("POST","",selection,201)).detail.contract;
      assert.equal(original.package_snapshot.priceCents,40000);assert.equal(original.package_snapshot.billing,undefined);
      await contractCall("POST",`/${original.id}/release`,{legalReviewAcknowledged:true});
      const revision=(await contractCall("POST",`/${original.id}/revision`,{reason:"Plattformgebühr ergänzen"},201)).detail.contract;
      const edit={...selection,title:"Vertrag mit Plattformabrechnung",specialAgreements:"Keine.",signingMethod:"click",enablePlatformFee:true};
      await contractCall("PATCH",`/${revision.id}`,edit,409);
      env.BILLING_ENABLED="true";
      const updated=(await contractCall("PATCH",`/${revision.id}`,edit)).detail.contract;
      assert.equal(updated.package_snapshot.billing.feeBasisPoints,250);assert.equal(updated.package_snapshot.priceCents,40000);
      assert.match(updated.package_snapshot.billing.collectionNotice,/2.5 %/);
      assert.match(updated.package_snapshot.billing.contractNotice,/Infrastruktur/);
      assert.doesNotMatch(updated.package_snapshot.billing.contractNotice,/Test Inkasso|2.5|monatlich|CHF/);
      const preserved=(await contractCall("PATCH",`/${revision.id}`,{...edit,enablePlatformFee:false})).detail.contract;
      assert.equal(preserved.package_snapshot.billing.feeBasisPoints,250);
      const released=(await contractCall("POST",`/${revision.id}/release`,{legalReviewAcknowledged:true})).detail.contract;
      assert.equal(released.package_snapshot.billing.feeBasisPoints,250);assert.ok(released.snapshot_hash);
      assert.equal(released.package_snapshot.billing.contractNotice,updated.package_snapshot.billing.contractNotice);
      await contractCall("PATCH",`/${revision.id}`,edit,409);
      const prior=(await db.query("SELECT package_snapshot FROM sponsorship_contracts WHERE id=$1",[original.id])).rows[0];
      assert.equal((prior.package_snapshot as any).billing,undefined);
    });
    await t.test("club fee fallback closes only the surcharge, preserves cash and deducts exactly once",async()=>{
      user="operator";setTestUser({id:user});
      const creditor={iban:"CH4431999123000889012",name:"Test Inkasso",street:"",houseNumber:"",postalCode:"8000",city:"Zürich",country:"CH"};
      Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>({BILLING_OPERATOR_USER_IDS:"operator",BILLING_QR_CREDITOR:JSON.stringify(creditor)}[name])}}});
      const tenant=randomUUID(),event=randomUUID(),booking=randomUUID();
      await db.query("INSERT INTO tenants(id,slug,name) VALUES($1,'fee-fallback','Verein Gebührenprüfung')",[tenant]);
      await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES($1,'operator','owner'),($1,'club-owner','owner')",[tenant]);
      await db.query("INSERT INTO sponsorship_events(id,tenant_id,team_name,opponent,starts_at,price_cents,status,created_by) VALUES($1,$2,'Test A','Test B','2026-01-01',40000,'published','fixture')",[event,tenant]);
      await db.query("INSERT INTO event_sponsorship_bookings(id,tenant_id,event_id,reference,sponsor_name,address,postal_code,city,contact_name,contact_email,payment_mode,amount_cents,fee_basis_points) VALUES($1,$2,$3,'MB-2026-EEEEEEEE','Testsponsor','Testweg 1','8000','Zürich','Test','test@example.invalid','invoice',40000,250)",[booking,tenant,event]);
      const draft=(await call(tenant,"/invoices",{sourceKey:`event:${booking}`},201)).invoice;
      const reason={confirmed:true,reason:"Sponsor bezahlt den Vereinsbeitrag ohne Zuschlag."};
      await call(tenant,`/invoices/${draft.id}/assume-fee`,reason,409);
      await call(tenant,`/invoices/${draft.id}/issue`,{detailsConfirmed:true});
      const originalPdf=(await db.query("SELECT sha256 FROM billing_invoice_documents WHERE invoice_id=$1",[draft.id])).rows[0].sha256;
      const monthDate=new Date(`${swissToday().slice(0,7)}-01T12:00:00Z`);monthDate.setUTCMonth(monthDate.getUTCMonth()-1);
      const month=monthDate.toISOString().slice(0,7),receivedOn=`${month}-15`;
      const first={amountCents:20000,receivedOn,bankReference:"FEE-PART-1",idempotencyKey:randomUUID(),bankEvidenceConfirmed:true};
      await call(tenant,`/invoices/${draft.id}/receipts`,first,201);
      await call(tenant,`/invoices/${draft.id}/assume-fee`,reason,409);
      const second=(await call(tenant,`/invoices/${draft.id}/receipts`,{...first,bankReference:"FEE-PART-2",idempotencyKey:randomUUID()},201)).id;
      const oldPayout=(await call(tenant,"/payouts",{month},201)).id;
      await call(tenant,`/invoices/${draft.id}/assume-fee`,{reason:reason.reason},422);
      user="club-owner";setTestUser({id:user});await call(tenant,`/invoices/${draft.id}/assume-fee`,reason,403);
      user="operator";setTestUser({id:user});
      await call(tenantB,`/invoices/${draft.id}/assume-fee`,reason,404);
      let feeId=(await call(tenant,`/invoices/${draft.id}/assume-fee`,reason)).id;
      assert.equal((await call(tenant,`/invoices/${draft.id}/assume-fee`,reason)).id,feeId);
      const data=await call(tenant);assert.equal(data.invoices[0].received_cents,"40000");assert.equal(data.invoices[0].fee_waived_cents,1000);
      assert.equal(data.feeSettlements[0].club_charge_cents,24);assert.equal(data.feeSettlements[0].received_platform_cents,976);
      await call(tenant,`/invoices/${draft.id}/receipts`,{...first,amountCents:1000,bankReference:"FEE-EXTRA",idempotencyKey:randomUUID()},409);
      await call(tenant,`/receipts/${second}/reverse`,{reason:"Testkorrektur des Eingangs"},409);
      assert.equal((await session(user,tenantB,c=>c.query("SELECT id FROM billing_fee_settlements WHERE id=$1",[feeId]))).rows.length,0);
      await db.query("UPDATE billing_fee_settlements SET booked_on=$2 WHERE id=$1",[feeId,receivedOn]);
      assert.equal((await call(tenant,`/payouts/${oldPayout}/paid`,{paidOn:swissToday(),bankReference:"FEE-OUT",bankEvidenceConfirmed:true},409)).error,"billing_payout_costs_changed");
      await call(tenant,`/payouts/${oldPayout}/discard`,{reason:"Gebührenabzug ergänzen"});
      await call(tenant,`/fee-settlements/${feeId}/reverse`,{reason:"Zuordnung erneut prüfen"});
      assert.equal((await call(tenant)).invoices[0].fee_waived_cents,0);
      feeId=(await call(tenant,`/invoices/${draft.id}/assume-fee`,reason)).id;
      await db.query("UPDATE billing_fee_settlements SET booked_on=$2 WHERE id=$1",[feeId,receivedOn]);
      const payout=(await call(tenant,"/payouts",{month},201)).id;
      const ledger=await call(tenant);
      assert.equal(Number(ledger.payouts[0].gross_cents),39024);assert.equal(Number(ledger.payouts[0].fee_cents),24);assert.equal(Number(ledger.payouts[0].amount_cents),39000);
      assert.equal(ledger.feeItems.length,1);
      assert.equal((await call(tenant,"/payouts",{month},201)).id,payout);
      await call(tenant,`/fee-settlements/${feeId}/reverse`,{reason:"Bereits zugeordnet"},409);
      await call(tenant,`/payouts/${payout}/paid`,{paidOn:swissToday(),bankReference:"FEE-OUT",bankEvidenceConfirmed:true});
      assert.equal((await db.query("SELECT sha256 FROM billing_invoice_documents WHERE invoice_id=$1",[draft.id])).rows[0].sha256,originalPdf);
      assert.equal((await db.query("SELECT count(*)::integer count FROM audit_events WHERE action='billing.fee_assumed_by_club' AND tenant_id=$1",[tenant])).rows[0].count,2);
    });
    await t.test("invoice deletion and replacement preserve accounting and delivery evidence",async(t)=>{
      const tenant=randomUUID(),event=randomUUID();
      await db.query("INSERT INTO tenants(id,slug,name) VALUES($1,'invoice-correction','Testverein')",[tenant]);
      await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES($1,'club-owner','owner'),($1,'reader','viewer'),($1,'operator','owner')",[tenant]);
      await db.query("INSERT INTO sponsorship_events(id,tenant_id,team_name,opponent,starts_at,price_cents,status,created_by) VALUES($1,$2,'FC Test','FC Gast','2026-10-01',40000,'published','fixture')",[event,tenant]);
      const env:Record<string,string>={BILLING_OPERATOR_USER_IDS:'operator',BILLING_QR_CREDITOR:JSON.stringify({iban:'CH4431999123000889012',name:'Test Inkasso',street:'',houseNumber:'',postalCode:'8000',city:'Zürich',country:'CH'}),PINGEN_CLIENT_ID:'fixture',PINGEN_CLIENT_SECRET:'fixture',PINGEN_ORGANISATION_ID:'fixture',PINGEN_ENVIRONMENT:'production',PINGEN_POSTAL_ENABLED:'true',RESEND_API_KEY:'fixture'};
      Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>env[name]}}});
      const login=(id:string)=>{user=id;setTestUser({id});};login('club-owner');
      const correction={confirmed:true,reason:'Rechnung im Test korrigieren'};
      const make=async(issued=false)=>{
        const booking=randomUUID();
        await db.query(`INSERT INTO event_sponsorship_bookings(id,tenant_id,event_id,reference,sponsor_name,address,postal_code,city,contact_name,contact_email,payment_mode,amount_cents,fee_basis_points)
          VALUES($1,$2,$3,$4,'Testsponsor AG','Testweg 1','3186','Düdingen','Test','test@example.invalid','invoice',40000,250)`,[booking,tenant,event,`MB-2026-${randomUUID().slice(0,8).toUpperCase()}`]);
        const draft=(await call(tenant,'/invoices',{sourceKey:`event:${booking}`},201)).invoice;
        return issued?(await call(tenant,`/invoices/${draft.id}/issue`,{detailsConfirmed:true})).invoice:draft;
      };
      const state=async(id:string)=>(await call(tenant)).invoices.find((row:{id:string})=>row.id===id);
      const original=async(id:string)=>{
        const response=await handler(request(tenant,`/invoices/${id}/pdf`),{requestId:'correction-pdf'} as never);
        assert.equal(response.status,200);return {bytes:new Uint8Array(await response.arrayBuffer()),filename:response.headers.get('Content-Disposition')};
      };
      await t.test('owners may delete drafts, with origin, account, role and tenant checks',async()=>{
        const draft=await make();const path=`/invoices/${draft.id}/cancel`;
        login('reader');await call(tenant,path,correction,403);login('club-owner');
        await call(tenantB,path,correction,403);
        login('operator');await call(tenantB,path,correction,404);login('club-owner');
        for(const headers of [{Origin:'https://evil.invalid'},{'X-Sponsor-Account':'other-user'}]){
          const response=await handler(request(tenant,path,correction,headers),{requestId:'auth'} as never);assert.ok([403,409].includes(response.status));
        }
        await call(tenant,path,{...correction,confirmed:false},422);
        await call(tenant,path,{...correction,reason:'x'},422);
        assert.equal((await state(draft.id)).status,'draft');
        const deleted=(await call(tenant,path,correction)).invoice;
        assert.equal(deleted.status,'cancelled');assert.equal(deleted.cancelled_by,'club-owner');assert.ok(deleted.cancelled_at);
        await call(tenant,path,correction);
        assert.equal((await db.query("SELECT id FROM audit_events WHERE action='billing.invoice_cancelled' AND object_id=$1",[draft.id])).rows.length,1);
        assert.ok((await call(tenant)).sources.some((row:{sourceKey:string})=>row.sourceKey===draft.source_key));
        const fresh=(await call(tenant,'/invoices',{sourceKey:draft.source_key},201)).invoice;
        assert.notEqual(fresh.id,draft.id);
        assert.equal((await call(tenant,'/invoices',{sourceKey:draft.source_key},201)).invoice.id,fresh.id);
        assert.equal((await call(tenant,`/invoices/${draft.id}/recreate`,correction,409)).error,'billing_period_overlap');
      });
      await t.test('recreation is atomic, idempotent and creates new QR details while archiving the original PDF',async()=>{
        const invoice=await make(true),before=await original(invoice.id);
        await assert.rejects(db.query("UPDATE billing_invoices SET status='cancelled',cancelled_at=now(),cancelled_by='x',cancellation_reason='Wrong amount',contribution_cents=1 WHERE id=$1",[invoice.id]),/immutable/);
        await db.query("UPDATE event_sponsorship_bookings SET city='Bern',postal_code='3000' WHERE id=$1",[invoice.source_id]);
        const path=`/invoices/${invoice.id}/recreate`;
        const next=(await call(tenant,path,{...correction,sourceKey:invoice.source_key,contributionCents:1})).invoice;
        assert.notEqual(next.id,invoice.id);assert.equal(next.replacement_for,invoice.id);assert.equal(next.status,'draft');assert.equal(next.invoice_number,null);
        assert.equal(next.recipient.city,'Bern');assert.equal(next.contribution_cents,40000);assert.equal(next.platform_fee_cents,1000);
        assert.equal((await call(tenant,path,correction)).invoice.id,next.id);
        assert.equal((await state(invoice.id)).replacementId,next.id);
        const archived=await original(invoice.id);assert.deepEqual(archived.bytes,before.bytes);assert.match(archived.filename!,/Storniert_RE-/);
        const old=await state(invoice.id);assert.equal(old.status,'cancelled');assert.equal(old.qr_reference,invoice.qr_reference);assert.equal(old.invoice_number,invoice.invoice_number);assert.equal(old.sourceAvailable,false);
        await assert.rejects(db.query("UPDATE billing_invoices SET status='issued' WHERE id=$1",[invoice.id]),/immutable/);
        await assert.rejects(db.query("DELETE FROM billing_invoices WHERE id=$1",[invoice.id]),/immutable/);
        await assert.rejects(db.query("DELETE FROM billing_invoice_documents WHERE invoice_id=$1",[invoice.id]),/immutable/);
        await call(tenant,`/invoices/${invoice.id}/issue`,{detailsConfirmed:true},409);
        const issued=(await call(tenant,`/invoices/${next.id}/issue`,{detailsConfirmed:true})).invoice;
        assert.notEqual(issued.invoice_number,invoice.invoice_number);assert.notEqual(issued.qr_reference,invoice.qr_reference);
        assert.equal((await PDFDocument.load((await original(next.id)).bytes)).getPageCount(),1);
        assert.equal((await db.query("SELECT id FROM billing_invoices WHERE tenant_id=$1 AND source_key=$2 AND status<>'cancelled'",[tenant,invoice.source_key])).rows.length,1);
        assert.equal((await call(tenant,path,correction)).invoice.id,next.id);
      });
      await t.test('missing sources leave the original untouched; cancelled drafts can be regenerated',async()=>{
        const invoice=await make(true);
        await db.query("UPDATE event_sponsorship_bookings SET status='cancelled' WHERE id=$1",[invoice.source_id]);
        await call(tenant,`/invoices/${invoice.id}/recreate`,correction,409);
        assert.equal((await state(invoice.id)).status,'issued');
        const draft=await make();await call(tenant,`/invoices/${draft.id}/cancel`,correction);
        const fresh=(await call(tenant,`/invoices/${draft.id}/recreate`,correction)).invoice;
        assert.equal(fresh.replacement_for,draft.id);assert.equal(fresh.status,'draft');
        await call(tenant,`/invoices/${fresh.id}/cancel`,correction);
        assert.equal((await call(tenant,`/invoices/${draft.id}/recreate`,correction)).invoice.id,fresh.id);
        const third=(await call(tenant,`/invoices/${fresh.id}/recreate`,correction)).invoice;
        assert.notEqual(third.id,fresh.id);assert.equal(third.replacement_for,fresh.id);
      });
      await t.test('payments block both actions; reversed erroneous payments remain as evidence',async()=>{
        const invoice=await make(true);login('operator');
        const receipt=(await call(tenant,`/invoices/${invoice.id}/receipts`,{idempotencyKey:randomUUID(),amountCents:100,receivedOn:swissToday(),bankReference:randomUUID(),bankEvidenceConfirmed:true},201)).id;
        for(const action of ['cancel','recreate'])assert.equal((await call(tenant,`/invoices/${invoice.id}/${action}`,correction,409)).error,'billing_cancellation_has_receipts');
        assert.equal((await state(invoice.id)).status,'issued');
        await call(tenant,`/receipts/${receipt}/reverse`,{reason:'Falsche Zuordnung im Test'});
        await call(tenant,`/invoices/${invoice.id}/cancel`,correction);
        assert.ok((await db.query("SELECT reversed_at FROM billing_receipts WHERE id=$1",[receipt])).rows[0].reversed_at);
        await call(tenant,`/invoices/${invoice.id}/receipts`,{idempotencyKey:randomUUID(),amountCents:100,receivedOn:swissToday(),bankReference:randomUUID(),bankEvidenceConfirmed:true},409);
        login('club-owner');
      });
      await t.test('in-flight mail blocks correction and uncertain delivery requires explicit acknowledgement',async()=>{
        const invoice=await make(true);
        await db.query(`INSERT INTO billing_email_dispatches(tenant_id,invoice_id,recipient_email,pdf_sha256,payload,status,created_by)
          SELECT tenant_id,invoice_id,'test@example.invalid',sha256,'{}','sending','fixture' FROM billing_invoice_documents WHERE invoice_id=$1`,[invoice.id]);
        const path=`/invoices/${invoice.id}/recreate`;
        assert.equal((await call(tenant,path,{...correction,deliveryAcknowledged:true},409)).error,'billing_cancellation_sending');
        await db.query("UPDATE billing_email_dispatches SET status='needs_review' WHERE invoice_id=$1",[invoice.id]);
        assert.equal((await call(tenant,path,correction,409)).error,'billing_cancellation_delivery_confirmation');
        const fresh=(await call(tenant,path,{...correction,deliveryAcknowledged:true})).invoice;
        const mail=await db.query("SELECT invoice_id,status,pdf_sha256,payload FROM billing_email_dispatches WHERE invoice_id=ANY($1::uuid[])",[[invoice.id,fresh.id]]);
        assert.equal(mail.rows.length,1);assert.equal(mail.rows[0].invoice_id,invoice.id);assert.equal(mail.rows[0].status,'needs_review');
        await assert.rejects(sendInvoiceEmail({actor:'club-owner',tenantId:tenant},invoice.id,'test@example.invalid','production'),/invoice_email_not_issued/);
        await assert.rejects(preparePostal({actor:'club-owner',tenantId:tenant},invoice.id,'production'),/pingen_invoice_not_issued/);
      });
      await t.test('Pingen preparation cannot send after cancellation; sent costs remain on the old invoice',async()=>{
        const invoice=await make(true),job=randomUUID(),token=randomUUID();
        await db.query(`INSERT INTO billing_postal_dispatches(id,tenant_id,invoice_id,environment,organisation_id,status,file_name,pdf_sha256,page_count,paper_types,quoted_cents,quote_token,quoted_at,provider_letter_id,created_by)
          SELECT $2,tenant_id,invoice_id,'production','fixture','ready','fixture.pdf',sha256,1,'["qr"]',150,$3,now(),'fixture-letter','fixture' FROM billing_invoice_documents WHERE invoice_id=$1`,[invoice.id,job,token]);
        await call(tenant,`/invoices/${invoice.id}/cancel`,correction);
        await assert.rejects(sendPostal({actor:'club-owner',tenantId:tenant},job,{quoteToken:token,quotedCents:150,costsAccepted:true},'production'),/pingen_invoice_not_issued/);
        const sent=await make(true),sentJob=randomUUID();
        await db.query(`INSERT INTO billing_postal_dispatches(id,tenant_id,invoice_id,environment,organisation_id,status,file_name,pdf_sha256,page_count,paper_types,send_started_at,cost_confirmed,created_by)
          SELECT $2,tenant_id,invoice_id,'production','fixture','sending','fixture-sent.pdf',sha256,1,'["qr"]',now(),true,'fixture' FROM billing_invoice_documents WHERE invoice_id=$1`,[sent.id,sentJob]);
        assert.equal((await call(tenant,`/invoices/${sent.id}/cancel`,{...correction,deliveryAcknowledged:true},409)).error,'billing_cancellation_sending');
        await db.query("UPDATE billing_postal_dispatches SET status='sent' WHERE id=$1",[sentJob]);
        await db.query("INSERT INTO billing_postal_costs(tenant_id,dispatch_id,amount_cents,booked_on,provider_total_cents,provider_updated_at) VALUES($1,$2,150,current_date,150,now())",[tenant,sentJob]);
        assert.equal((await call(tenant,`/invoices/${sent.id}/recreate`,correction,409)).error,'billing_cancellation_delivery_confirmation');
        const next=(await call(tenant,`/invoices/${sent.id}/recreate`,{...correction,deliveryAcknowledged:true})).invoice;
        const data=await call(tenant);assert.equal(data.postalCosts.find((row:{dispatch_id:string})=>row.dispatch_id===sentJob).amount_cents,150);
        assert.equal(data.dispatches.some((row:{invoice_id:string})=>row.invoice_id===next.id),false);
        assert.equal((await db.query("SELECT invoice_id FROM billing_postal_dispatches WHERE id=$1",[sentJob])).rows[0].invoice_id,sent.id);
      });
    });
  }finally{await db.close();}
});
