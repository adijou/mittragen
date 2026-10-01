import assert from "node:assert/strict";
import test from "node:test";
import { feeCents, splitReceipt, parseChf, closedMonth, swissToday } from "../shared/billing.ts";
import { billingConfig, billingReadiness, newBillingTerms } from "../netlify/functions/_shared/billing-config.ts";
import { contractBillingIssues, contractInstallments } from "../netlify/functions/_shared/billing-sources.ts";
import type { ContractPdfData } from "../netlify/functions/_shared/contract-pdf.ts";
import { pingenSamplePrice } from "../netlify/functions/_shared/pingen.ts";
import { invoicePostalAddress } from "../netlify/functions/_shared/invoice-pdf.ts";
import { clubFeeSettlement } from "../netlify/functions/_shared/fee-settlements.ts";

test("club assumption collects the fee exactly once without inventing bank receipts",()=>{
  for(const contribution of [40000,100000,12345]){
    const fee=feeCents(contribution);
    for(const extra of [0,Math.floor(fee/2),fee-1]){
      const paid=contribution+extra;
      const received=splitReceipt(contribution,fee,0,paid);
      const settlement=clubFeeSettlement(contribution,fee,paid,received.platformCents);
      assert.equal(received.platformCents+settlement.clubChargeCents,fee);
      assert.equal(received.clubCents-settlement.clubChargeCents,paid-fee);
      assert.equal(paid+settlement.waivedCents,contribution+fee);
    }
  }
  assert.deepEqual(clubFeeSettlement(40000,1000,40000,976),{waivedCents:1000,feeCents:1000,receivedPlatformCents:976,clubChargeCents:24});
  for(const received of [39999,41000,41001])assert.throws(()=>clubFeeSettlement(40000,1000,received,976));
  assert.throws(()=>clubFeeSettlement(40000,0,40000,0));
});

test("Swiss domestic invoice addresses end with postcode and city, without a country line",()=>{
  const recipient={name:"Muster Sponsor AG",street:"Hauptstrasse 1",postalCode:"3186",city:"Düdingen",country:"CH"};
  assert.deepEqual(invoicePostalAddress(recipient),["Muster Sponsor AG","Hauptstrasse 1","3186 Düdingen"]);
  assert.equal(recipient.country,"CH"); // Country remains available to the Swiss QR payload.
});

test("250 basis points are added on top and rounded only to cents",()=>{
  assert.equal(feeCents(100_000),2_500);assert.equal(feeCents(15_000),375);
  assert.equal(feeCents(19),0);assert.equal(feeCents(20),1);assert.equal(feeCents(100_000,0),0);
  for(const value of [-1,0.01,NaN,Infinity,100_000_001])assert.throws(()=>feeCents(value));
  assert.throws(()=>feeCents(100,999));
  assert.equal(parseChf("1.05"),105);assert.equal(parseChf("0,01"),1);
  for(const value of ["1e3","-1","1.005","1'000.00","Infinity",""])assert.equal(parseChf(value),null);
});
test("arbitrary partial receipts preserve the full club share without taking the fee twice",()=>{
  for(const base of [20,99,13333,100000]){
    const fee=feeCents(base);const total=base+fee;
    let paid=0,club=0,platform=0;
    while(paid<total){const amount=Math.min(137,total-paid);const share=splitReceipt(base,fee,paid,amount);paid+=amount;club+=share.clubCents;platform+=share.platformCents;}
    assert.equal(club,base);assert.equal(platform,fee);assert.equal(club+platform,total);
  }
  assert.deepEqual(splitReceipt(100000,2500,0,51250),{clubCents:50000,platformCents:1250});
  assert.throws(()=>splitReceipt(100000,2500,100000,2501));
});
test("billing activation needs an explicit switch and an identified operator; sending stays closed",()=>{
  assert.equal(billingConfig(()=>undefined).enabled,false);
  assert.equal(newBillingTerms(name=>name==="BILLING_ENABLED"?"true":undefined),undefined);
  const env=(name:string)=>({BILLING_ENABLED:"true",BILLING_OPERATOR_NAME:"Test Inkasso"}[name]);
  assert.equal(newBillingTerms(env)?.feeBasisPoints,250);
  assert.match(newBillingTerms(env)!.collectionNotice,/Test Inkasso/);
  assert.equal(billingReadiness(env).postalSendingEnabled,false);
  assert.equal(billingReadiness(env).invoiceIssuingEnabled,false);
  assert.equal(billingReadiness(env).interestBasisPoints,0);
});
test("Zurich month boundary and closed-month validation use Swiss dates",()=>{
  assert.equal(swissToday(new Date("2026-09-30T22:05:00Z")),"2026-10-01");
  assert.equal(closedMonth("2026-09","2026-10-01"),true);
  assert.equal(closedMonth("2026-10","2026-10-01"),false);
  assert.equal(closedMonth("2026-13","2027-01-01"),false);
});
test("contract schedules split the annual contribution, including odd cents and partial years",()=>{
  const item={priceCents:10001,paymentPlan:"quarterly",validFrom:"2026-07-01",validUntil:"2027-09-30",durationMonths:15} as ContractPdfData["package"];
  const rates=contractInstallments(item);
  assert.equal(rates.length,5);assert.equal(rates.reduce((sum,row)=>sum+row.contributionCents,0),12501);
  assert.deepEqual(rates[0],{start:"2026-07-01",end:"2026-09-30",contributionCents:2500});
  assert.equal(contractInstallments({...item,paymentPlan:"custom"}).length,0);
  assert.equal(contractInstallments({...item,validFrom:null}).length,0);
  assert.equal(contractInstallments({...item,validUntil:"2029-01-01"}).length,0);
});
test("contract review explains each missing input without producing a guessed schedule",()=>{
  const item={priceCents:100_000,paymentPlan:"annual",validFrom:"2026-07-01",validUntil:"2027-06-30",durationMonths:12} as ContractPdfData["package"];
  assert.deepEqual(contractBillingIssues(item),[]);
  const invalidCases=[
    [{paymentPlan:"custom"},/Individueller Zahlungsplan/],
    [{paymentPlan:"unknown"},/unterstützter Zahlungsplan/],
    [{validFrom:null},/Vertragsbeginn/],
    [{validUntil:"2027-02-30"},/Vertragsende/],
    [{durationMonths:0},/Vertragsdauer/],
    [{durationMonths:121},/Vertragsdauer/],
    [{durationMonths:1.5},/Vertragsdauer/],
    [{priceCents:0},/Jahresbeitrag/],
    [{priceCents:1.5},/Jahresbeitrag/],
    [{validUntil:"2027-07-01"},/Beginn 01\.07\.2026 und 12 Monate ergeben als Ende 30\.06\.2027; gespeichert ist 01\.07\.2027/],
  ] as const;
  for(const [changes,reason] of invalidCases){
    const invalid={...item,...changes};
    assert.match(contractBillingIssues(invalid).join(" "),reason);
    assert.deepEqual(contractInstallments(invalid),[]);
  }
  const incomplete={...item,paymentPlan:"custom",validFrom:null,validUntil:null};
  assert.equal(contractBillingIssues(incomplete).length,1);
  assert.deepEqual(contractInstallments(incomplete),[]);
  assert.deepEqual(contractInstallments(item),[{start:"2026-07-01",end:"2027-06-30",contributionCents:100_000}]);
});
test("open-ended contracts renew annually at their anniversary without an artificial end",()=>{
  const item={priceCents:10001,paymentPlan:"annual",validFrom:"2024-07-01",validUntil:null,durationMonths:12} as ContractPdfData["package"];
  assert.deepEqual(contractBillingIssues(item),[]);
  assert.deepEqual(contractInstallments(item,"2024-06-30"),[]);
  const before=contractInstallments(item,"2026-06-30");
  assert.equal(before.length,2);
  assert.deepEqual(before.at(-1),{start:"2025-07-01",end:"2026-06-30",contributionCents:10001});
  const after=contractInstallments(item,"2026-07-01");
  assert.deepEqual(after.slice(0,-1),before);
  assert.deepEqual(after.at(-1),{start:"2026-07-01",end:"2027-06-30",contributionCents:10001});
  assert.deepEqual(contractInstallments({...item,paymentPlan:"custom",validUntil:"",durationMonths:36},"2026-07-01"),after);
  assert.deepEqual(contractInstallments({...item,validFrom:null},"2026-07-01"),[]);
  assert.deepEqual(contractInstallments({...item,priceCents:0},"2026-07-01"),[]);
  assert.deepEqual(contractInstallments({...item,validUntil:"invalid"},"2026-07-01"),[]);
  assert.throws(()=>contractInstallments(item,"invalid"),/invalid_billing_date/);
});
test("annual periods stay contiguous across leap days and use Swiss renewal dates",()=>{
  const item={priceCents:100_000,paymentPlan:"annual",validFrom:"2024-02-29",validUntil:null,durationMonths:12} as ContractPdfData["package"];
  const periods=contractInstallments(item,"2028-02-29");
  assert.equal(periods.length,5);
  assert.deepEqual(periods[0],{start:"2024-02-29",end:"2025-02-27",contributionCents:100_000});
  assert.deepEqual(periods.at(-1),{start:"2028-02-29",end:"2029-02-27",contributionCents:100_000});
  for(let i=1;i<periods.length;i++)assert.equal(Date.parse(periods[i].start)-Date.parse(periods[i-1].end),86_400_000);
  const midnight={...item,validFrom:"2025-10-01"};
  assert.equal(contractInstallments(midnight,swissToday(new Date("2026-09-30T21:59:59Z"))).length,1);
  assert.equal(contractInstallments(midnight,swissToday(new Date("2026-09-30T22:00:00Z"))).length,2);
});
test("Pingen pricing defaults to sandbox and never uploads, creates, sends or exposes credentials",async()=>{
  const calls:Array<{url:string;init:RequestInit}>=[];
  const env=(name:string)=>({PINGEN_CLIENT_ID:"client-fixture",PINGEN_CLIENT_SECRET:"secret-fixture",PINGEN_ORGANISATION_ID:"organisation-fixture"}[name]);
  const fetcher=(async(url:string,init:RequestInit)=>{calls.push({url,init});return calls.length===1?Response.json({access_token:"token-fixture"}):Response.json({data:{attributes:{currency:"CHF",price:1.37}}});}) as typeof fetch;
  const quote=await pingenSamplePrice(env,fetcher);
  assert.equal(quote.price,1.37);assert.equal(quote.environment,"staging");assert.equal(calls.length,2);
  assert.equal(calls[0].url,"https://api-staging.pingen.com/auth/access-tokens");
  assert.match(calls[1].url,/\/price-calculator$/);assert.equal(calls[1].init.redirect,"error");
  const payload=JSON.parse(String(calls[1].init.body));
  assert.deepEqual(payload.data.attributes,{country:"CH",paper_types:["qr"],print_mode:"simplex",print_spectrum:"grayscale",delivery_product:"cheap"});
  assert.doesNotMatch(JSON.stringify(quote),/secret-fixture|token-fixture|client-fixture/);
  await assert.rejects(pingenSamplePrice(()=>undefined,fetcher),/pingen_not_configured/);
  assert.equal(calls.length,2);
  await assert.rejects(pingenSamplePrice(env,(async()=>Response.json({secret:"never return"},{status:401})) as typeof fetch),/pingen_auth_failed/);
});
