import assert from "node:assert/strict";
import test from "node:test";
import { invoiceQrData, qrParty, qrReference, readQrCreditor } from "../netlify/functions/_shared/swiss-qr.ts";
import { billingReadiness } from "../netlify/functions/_shared/billing-config.ts";

const creditor={iban:"CH4431999123000889012",name:"Test Inkasso",street:"",houseNumber:"",postalCode:"8000",city:"Zürich",country:"CH"};
const env=(value:object)=>(name:string)=>name==="BILLING_QR_CREDITOR"?JSON.stringify(value):undefined;
test("QR account validation allows the structured SIX minimum and rejects ordinary or invalid IBANs",()=>{
  assert.deepEqual(readQrCreditor(env(creditor)),creditor);
  assert.equal(billingReadiness(env(creditor)).invoiceIssuingEnabled,true);
  assert.equal(billingReadiness(env(creditor)).postalSendingEnabled,false);
  for(const patch of [{iban:"CH4431999123000889013"},{iban:"CH9300762011623852957"},{name:""},{city:""},{postalCode:""},{city:"Zürich\nSPC"}])assert.equal(readQrCreditor(env({...creditor,...patch})),null);
  assert.equal(readQrCreditor(()=>"{"),null);
});
test("recursive modulo 10 matches the published SIX reference vector",()=>{
  assert.equal(qrReference("21000000000313947143000901".replace(/^0+/,"")),"210000000003139471430009017");
});
test("reference allocation and QR payload preserve cents and structured addresses",()=>{
  assert.notEqual(qrReference("1"),qrReference("2"));assert.equal(qrReference("1").length,27);
  assert.throws(()=>qrReference("0"));assert.throws(()=>qrReference("1.5"));
  assert.deepEqual(qrParty({...creditor,street:"Hauptstrasse 12a"}),{name:creditor.name,address:"Hauptstrasse",buildingNumber:"12a",zip:"8000",city:"Zürich",country:"CH"});
  const data=invoiceQrData({creditor,recipient:{...creditor,name:"Muster Sponsor"},amountCents:15375,qrReference:qrReference("1"),invoiceNumber:"RE-2026-00000001"});
  assert.equal(data.amount,153.75);assert.equal(data.currency,"CHF");assert.equal(data.creditor.account,creditor.iban);assert.equal(data.debtor?.address,"");
});
