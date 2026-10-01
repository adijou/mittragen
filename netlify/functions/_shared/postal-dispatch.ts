import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { withSession, type DatabaseClient } from "./database.ts";
import { BillingError, lockBilling, sourceMatches, type InvoiceRow } from "./billing-ledger.ts";
import { billingSources } from "./billing-sources.ts";
import { pingenClient, pingenConfig, requirePostalEnabled, requirePostalPreparation, type PingenConfig, type PingenLetter } from "./pingen-client.ts";
import { swissToday } from "../../../shared/billing.ts";

export type PostalDispatch={id:string;tenant_id:string;invoice_id:string;environment:"staging"|"production";organisation_id:string;
  status:string;provider_letter_id:string|null;provider_status:string|null;provider_updated_at:string|null;file_name:string;pdf_sha256:string;
  page_count:number;paper_types:string[];quoted_cents:number|null;quote_token:string|null;quoted_at:string|null;provider_address:string|null;
  approved_cents:number|null;send_key:string;create_started_at:string|null;send_started_at:string|null;submitted_at:string|null;
  cost_confirmed:boolean;last_error:string|null;updated_at:string;created_at:string};
type Session={actor:string;tenantId:string;email?:string};
const session=<T>(s:Session,fn:(client:DatabaseClient)=>Promise<T>)=>withSession(s.actor,s.tenantId,async client=>{await lockBilling(client,s.tenantId);return fn(client);},s.email);
const audit=(client:DatabaseClient,s:Session,action:string,id:string,metadata:object={})=>client.query(`INSERT INTO audit_events (tenant_id,actor_user_id,action,object_type,object_id,metadata) VALUES ($1,$2,$3,'postal_dispatch',$4,$5::jsonb)`,[s.tenantId,s.actor,action,id,JSON.stringify(metadata)]);
async function dispatch(client:DatabaseClient,tenantId:string,id:string) {
  const row=(await client.query<PostalDispatch>("SELECT * FROM billing_postal_dispatches WHERE tenant_id=$1 AND id=$2",[tenantId,id])).rows[0];
  if(!row)throw new BillingError("not_found",404);return row;
}
function sameAccount(row:PostalDispatch,config:PingenConfig) {
  if(row.environment!==config.environment||row.organisation_id!==config.organisationId)throw new BillingError("pingen_account_changed",409);
}
async function invoiceForPost(client:DatabaseClient,tenantId:string,invoiceId:string) {
  const row=(await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND id=$2",[tenantId,invoiceId])).rows[0];
  if(!row)throw new BillingError("not_found",404);
  if(row.status!=="issued")throw new BillingError("pingen_invoice_not_issued");
  if(!sourceMatches(row,(await billingSources(client,tenantId)).sources))throw new BillingError("billing_source_unavailable");
  const paid=await client.query("SELECT id FROM billing_receipts WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL LIMIT 1",[tenantId,invoiceId]);
  if(paid.rows.length)throw new BillingError("pingen_invoice_received");
  if(row.recipient.country!=="CH"||!row.recipient.street.trim()||!/^\d{4}$/.test(row.recipient.postalCode))throw new BillingError("pingen_address_invalid",422);
  return row;
}
const safeError=(error:unknown)=>error instanceof BillingError?error.message:"pingen_request_uncertain";
const dateValue=(value:string|null|undefined)=>value?new Date(value).getTime():NaN;
function validatedLetter(row:PostalDispatch,letter:PingenLetter) {
  const a=letter.attributes;
  if(letter.type!=="letters"||a.file_original_name!==row.file_name||a.file_pages!==row.page_count||a.country!=="CH"||a.address_position!=="right"
    ||!a.address?.trim())throw new BillingError("pingen_document_mismatch");
  if(JSON.stringify(a.paper_types)!==JSON.stringify(row.paper_types))throw new BillingError("pingen_paper_not_ready");
}

/** A committed local job precedes every remote create; uncertain creates are recovered by their unique filename. */
export async function preparePostal(s:Session,invoiceId:string,deployContext?:string) {
  const config=pingenConfig();requirePostalPreparation(config,deployContext);
  const reservation=await session(s,async client=>{
    await invoiceForPost(client,s.tenantId,invoiceId);
    const prior=(await client.query<PostalDispatch>("SELECT * FROM billing_postal_dispatches WHERE tenant_id=$1 AND invoice_id=$2 AND environment=$3",[s.tenantId,invoiceId,config.environment])).rows[0];
    if(prior){sameAccount(prior,config);if(prior.create_started_at||prior.provider_letter_id||prior.status==='preparing'&&Date.now()-dateValue(prior.updated_at)<120000)return {row:prior,bytes:null};}
    const doc=(await client.query<{pdf_bytes:Uint8Array;sha256:string}>("SELECT pdf_bytes,sha256 FROM billing_invoice_documents WHERE tenant_id=$1 AND invoice_id=$2",[s.tenantId,invoiceId])).rows[0];
    if(!doc||createHash('sha256').update(doc.pdf_bytes).digest('hex')!==doc.sha256)throw new BillingError("billing_document_missing");
    const pdf=await PDFDocument.load(doc.pdf_bytes);const count=pdf.getPageCount();
    if(count<1||count>100||pdf.getPages().some(p=>Math.abs(p.getWidth()-595.276)>1||Math.abs(p.getHeight()-841.89)>1))throw new BillingError("pingen_document_mismatch");
    if(prior){await client.query("UPDATE billing_postal_dispatches SET status='preparing',last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,prior.id]);return {row:prior,bytes:doc.pdf_bytes};}
    const id=randomUUID();const paper=Array.from({length:count},(_,i)=>i===count-1?'qr':'normal');
    const row=(await client.query<PostalDispatch>(`INSERT INTO billing_postal_dispatches(id,tenant_id,invoice_id,environment,organisation_id,file_name,pdf_sha256,page_count,paper_types,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,[id,s.tenantId,invoiceId,config.environment,config.organisationId,`mittragen-${id}.pdf`,doc.sha256,count,JSON.stringify(paper),s.actor])).rows[0];
    await audit(client,s,"postal.prepared",id,{invoiceId,environment:config.environment,costBearer:"club",pageCount:count});return {row,bytes:doc.pdf_bytes};
  });
  if(!reservation.bytes)return reservation.row;
  const row=reservation.row;
  try{
    const api=await pingenClient(config);const file=await api.upload(reservation.bytes);
    await session(s,client=>client.query("UPDATE billing_postal_dispatches SET create_started_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,row.id]));
    const letter=await api.create(file,row.file_name,`${row.id}:create`);
    return await session(s,async client=>{
      await client.query("UPDATE billing_postal_dispatches SET provider_letter_id=$3,provider_status=$4,status='validating',last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,row.id,letter.id,letter.attributes?.status??null]);
      await audit(client,s,"postal.uploaded",row.id,{letterId:letter.id});return dispatch(client,s.tenantId,row.id);
    });
  }catch(error){
    await session(s,client=>client.query("UPDATE billing_postal_dispatches SET status='needs_review',last_error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,row.id,safeError(error)]));
    throw new BillingError(safeError(error),502);
  }
}

/** Costs are the provider's booked total, never the pre-send estimate. Corrections append signed ledger entries. */
export async function applyPostalSnapshot(client:DatabaseClient,s:Session,id:string,letter:PingenLetter,totalCents:number|null,quote:number|null=null) {
  const row=await dispatch(client,s.tenantId,id),a=letter.attributes;
  if(row.provider_letter_id&&row.provider_letter_id!==letter.id)throw new BillingError("pingen_document_mismatch");
  const remoteTime=dateValue(a.updated_at);
  if(!Number.isFinite(remoteTime))throw new BillingError("pingen_response_invalid",502);
  if(Number.isFinite(dateValue(row.provider_updated_at))&&remoteTime<dateValue(row.provider_updated_at))return row;
  const submitted=Number.isFinite(dateValue(a.submitted_at));
  const finalStates=['sent','delivered','undeliverable','cancelled'];
  const status=finalStates.includes(a.status??'')?a.status!:submitted?'submitted':row.send_started_at?'needs_review':quote!==null?'ready':a.status==='validating'?'validating':'needs_review';
  if(totalCents!==null&&row.environment==='production'&&(submitted||row.send_started_at)){
    const prior=Number((await client.query<{total:string}>("SELECT COALESCE(sum(amount_cents),0)::text total FROM billing_postal_costs WHERE tenant_id=$1 AND dispatch_id=$2",[s.tenantId,id])).rows[0].total);
    const delta=totalCents-prior;
    if(delta!==0){
      // Book corrections on discovery. No already-closed month is rewritten.
      await client.query(`INSERT INTO billing_postal_costs(tenant_id,dispatch_id,amount_cents,booked_on,provider_total_cents,provider_updated_at)
        VALUES($1,$2,$3,$4,$5,$6)`,[s.tenantId,id,delta,swissToday(),totalCents,new Date(remoteTime).toISOString()]);
      await audit(client,s,"postal.cost_booked",id,{amountCents:delta,providerTotalCents:totalCents,letterId:letter.id});
    }
  }
  await client.query(`UPDATE billing_postal_dispatches SET provider_letter_id=$3,provider_status=$4,provider_updated_at=$5,provider_address=$6,status=$7,
    quoted_cents=COALESCE($8,quoted_cents),quote_token=CASE WHEN $8::integer IS NOT NULL THEN $9::uuid ELSE quote_token END,
    quoted_at=CASE WHEN $8::integer IS NOT NULL THEN now() ELSE quoted_at END,submitted_at=COALESCE($10,submitted_at),
    cost_confirmed=CASE WHEN $11::boolean THEN true ELSE cost_confirmed END,last_error=$12,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
    [s.tenantId,id,letter.id,a.status??null,new Date(remoteTime).toISOString(),a.address??null,status,quote,quote!==null?randomUUID():null,
      submitted?a.submitted_at:null,totalCents!==null,status==='needs_review'?'pingen_provider_review':null]);
  return dispatch(client,s.tenantId,id);
}

export async function syncPostal(s:Session,id:string) {
  const config=pingenConfig(),refreshToken=randomUUID();
  const row=await session(s,async client=>{
    const current=await dispatch(client,s.tenantId,id);sameAccount(current,config);
    const lease=await client.query(`UPDATE billing_postal_dispatches SET refresh_token=$3,refresh_started_at=now(),
      cost_confirmed=CASE WHEN send_started_at IS NOT NULL THEN false ELSE cost_confirmed END
      WHERE tenant_id=$1 AND id=$2 AND (refresh_started_at IS NULL OR refresh_started_at<now()-interval '2 minutes') RETURNING id`,[s.tenantId,id,refreshToken]);
    if(!lease.rows.length)throw new BillingError("pingen_processing",409);return current;
  });
  try{
  if(!row.provider_letter_id&&!row.create_started_at)throw new BillingError("pingen_prepare_again",409);
  if(!row.provider_letter_id&&Date.now()-dateValue(row.updated_at)<120000)throw new BillingError("pingen_processing",409);
  const api=await pingenClient(config);
  let letter=row.provider_letter_id?await api.details(row.provider_letter_id):await api.find(row.file_name);
  let quote:number|null=null,cost:number|null=null;
  const submitted=Number.isFinite(dateValue(letter.attributes.submitted_at));
  if(!submitted&&!row.send_started_at&&letter.attributes.status==='valid'){
    if(JSON.stringify(letter.attributes.paper_types)!==JSON.stringify(row.paper_types)){
      await api.paper(letter.id,row.paper_types,`${row.id}:paper`);letter=await api.details(letter.id);
    }
    if(letter.attributes.status==='valid'){
      validatedLetter(row,letter);quote=await api.quote(row.paper_types,randomUUID());
    }
  }
  if(submitted||row.send_started_at&&letter.attributes.status==='cancelled')cost=await api.costs(letter.id);
  return await session(s,async client=>{
    const held=await client.query("SELECT id FROM billing_postal_dispatches WHERE tenant_id=$1 AND id=$2 AND refresh_token=$3",[s.tenantId,id,refreshToken]);
    if(!held.rows.length)throw new BillingError("pingen_processing",409);
    return applyPostalSnapshot(client,s,id,letter,cost,quote);
  });
  }finally{
    await session(s,client=>client.query("UPDATE billing_postal_dispatches SET refresh_token=NULL,refresh_started_at=NULL WHERE tenant_id=$1 AND id=$2 AND refresh_token=$3",[s.tenantId,id,refreshToken]));
  }
}

export async function sendPostal(s:Session,id:string,input:{quoteToken:string;quotedCents:number;costsAccepted:boolean},deployContext?:string) {
  const config=pingenConfig();requirePostalEnabled(config,deployContext);
  const row=await session(s,async client=>{
    const row=await dispatch(client,s.tenantId,id);
    if(!row.send_started_at)await invoiceForPost(client,s.tenantId,row.invoice_id);
    return row;
  });sameAccount(row,config);
  if(row.send_started_at)return row; // Unknown outcomes are reconciled, never re-sent on a retry.
  if(row.status!=='ready'||!row.provider_letter_id||!input.costsAccepted||row.quote_token!==input.quoteToken||row.quoted_cents!==input.quotedCents
    ||Date.now()-dateValue(row.quoted_at)>900000)throw new BillingError("pingen_quote_expired");
  const api=await pingenClient(config);const letter=await api.details(row.provider_letter_id);validatedLetter(row,letter);
  if(letter.attributes.status!=='valid'||letter.attributes.submitted_at)throw new BillingError("pingen_provider_review");
  const price=await api.quote(row.paper_types,randomUUID());
  if(price!==row.quoted_cents){await session(s,client=>applyPostalSnapshot(client,s,id,letter,null,price));throw new BillingError("pingen_quote_changed");}
  const claimed=await session(s,async client=>{
    const current=await dispatch(client,s.tenantId,id);
    if(current.send_started_at)return false;
    if(current.status!=='ready'||current.quote_token!==input.quoteToken)throw new BillingError("pingen_quote_expired");
    await invoiceForPost(client,s.tenantId,current.invoice_id);
    await client.query(`UPDATE billing_postal_dispatches SET status='sending',send_started_at=now(),approved_at=now(),approved_by=$3,approved_cents=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2`,[s.tenantId,id,s.actor,price]);
    await audit(client,s,"postal.send_approved",id,{priceCents:price,costBearer:"club",environment:row.environment});return true;
  });
  if(!claimed)return session(s,client=>dispatch(client,s.tenantId,id));
  try{
    await api.send(row.provider_letter_id,row.send_key);
    await session(s,async client=>{await client.query("UPDATE billing_postal_dispatches SET status='submitted',last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id]);await audit(client,s,"postal.send_accepted",id);});
  }catch(error){
    await session(s,client=>client.query("UPDATE billing_postal_dispatches SET status='needs_review',last_error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",[s.tenantId,id,safeError(error)]));
  }
  return session(s,client=>dispatch(client,s.tenantId,id));
}
