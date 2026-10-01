import { createHash, randomUUID } from "node:crypto";
import { withSession, type DatabaseClient } from "./database.ts";
import { BillingError, lockBilling, sourceMatches, type InvoiceRow } from "./billing-ledger.ts";
import { billingSources } from "./billing-sources.ts";
import { contractEmailConfig } from "./contract-delivery.ts";
import { formatBillingChf } from "../../../shared/billing.ts";

type Session = { actor:string; tenantId:string; email?:string };
type Dispatch = { id:string; invoice_id:string; recipient_email:string; status:string; provider_id:string|null; accepted_at:string|null;
  first_attempt_at:string; last_attempt_at:string; last_error:string|null; payload:Record<string,unknown> };
export const validInvoiceEmail = (value:unknown):value is string => typeof value==="string" && value.length<=254 && /^[^\s@<>,;]+@[a-z\d.-]+\.[a-z]{2,}$/i.test(value);
const escape = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const session = <T>(s:Session,operation:(client:DatabaseClient)=>Promise<T>) => withSession(s.actor,s.tenantId,async client=>{await lockBilling(client,s.tenantId);return operation(client);},s.email);
const audit = (client:DatabaseClient,s:Session,action:string,id:string,metadata:object={}) => client.query("INSERT INTO audit_events(tenant_id,actor_user_id,action,object_type,object_id,metadata) VALUES($1,$2,$3,'invoice_email',$4,$5::jsonb)",[s.tenantId,s.actor,action,id,JSON.stringify(metadata)]);
const publicDispatch = ({payload:_payload,...row}:Dispatch) => row;

export function buildInvoiceEmail(invoice:InvoiceRow,brand:{color?:string;logoUrl?:string}={}) {
  const subject=`Rechnung ${invoice.invoice_number} – ${invoice.issuer.name}`.replace(/[\r\n]/g,' ');
  const color=/^#[a-f0-9]{6}$/i.test(brand.color??'')?brand.color!:'#0B2142';
  const total=formatBillingChf(invoice.contribution_cents+invoice.platform_fee_cents);
  const fee=invoice.platform_fee_cents>0?'Die Plattformgebühr finanziert die Infrastruktur von mittragen.ch. Sie wird von den Sponsoren getragen und entlastet die Klubs.':'';
  const lines=[`Guten Tag ${invoice.recipient.name}`,`Im Anhang erhalten Sie die Rechnung ${invoice.invoice_number} von ${invoice.issuer.name}.`,invoice.description,`Rechnungsbetrag: ${total}`,fee,'Bitte verwenden Sie für die Zahlung den QR-Zahlteil auf der Rechnung. Es gelten die vereinbarten Zahlungskonditionen.',`Vielen Dank für Ihre Unterstützung.\n${invoice.issuer.name}`].filter(Boolean);
  const logo=brand.logoUrl?.startsWith('https://')?`<img src="${escape(brand.logoUrl)}" alt="${escape(invoice.issuer.name)}" style="max-width:120px;max-height:70px;margin-bottom:16px">`:'';
  const html=`<!doctype html><html lang="de"><body style="font-family:Arial,sans-serif;background:#f4f7fb;color:#17283e;padding:24px"><main style="max-width:600px;margin:auto;background:#fff;padding:28px;border-top:5px solid ${color}">${logo}<h1 style="color:${color};font-size:24px">${escape(invoice.issuer.name)}</h1>${lines.map(line=>`<p style="line-height:1.6">${escape(line).replaceAll('\n','<br>')}</p>`).join('')}<p style="color:#65758b;font-size:12px">Erstellt mit mittragen.ch</p></main></body></html>`;
  return {subject,html,text:lines.join('\n\n')};
}

/** Persist the exact payload before sending. A retry uses the same payload/key, only within Resend's retention window. */
export async function sendInvoiceEmail(s:Session,invoiceId:string,email:string,deployContext?:string) {
  if(deployContext!=="production")throw new BillingError("invoice_email_production_only",403);
  if(!validInvoiceEmail(email))throw new BillingError("invoice_email_invalid",422);
  let config;try{config=contractEmailConfig();}catch{throw new BillingError("invoice_email_not_configured",422);}
  const recipient=email.trim().toLowerCase();
  const reservation=await session(s,async client=>{
    const invoice=(await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND id=$2",[s.tenantId,invoiceId])).rows[0];
    if(!invoice)throw new BillingError("not_found",404);
    const prior=(await client.query<Dispatch>("SELECT * FROM billing_email_dispatches WHERE tenant_id=$1 AND invoice_id=$2",[s.tenantId,invoiceId])).rows[0];
    if(prior && prior.recipient_email!==recipient)throw new BillingError("invoice_email_recipient_locked");
    if(prior?.status==='accepted')return {row:prior,send:false};
    if(invoice.status!=="issued")throw new BillingError("invoice_email_not_issued");
    if(!sourceMatches(invoice,(await billingSources(client,s.tenantId)).sources))throw new BillingError("billing_source_unavailable");
    if((await client.query("SELECT id FROM billing_receipts WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL LIMIT 1",[s.tenantId,invoiceId])).rows.length)throw new BillingError("invoice_email_received");
    if(prior){
      if(Date.now()-new Date(prior.first_attempt_at).getTime()>=23*3600000)throw new BillingError("invoice_email_manual_review");
      if(prior.status==='sending'&&Date.now()-new Date(prior.last_attempt_at).getTime()<120000)throw new BillingError("invoice_email_processing");
      await client.query("UPDATE billing_email_dispatches SET status='sending',last_attempt_at=now(),last_error=NULL WHERE tenant_id=$1 AND id=$2",[s.tenantId,prior.id]);
      return {row:prior,send:true};
    }
    const doc=(await client.query<{pdf_bytes:Uint8Array;sha256:string}>("SELECT pdf_bytes,sha256 FROM billing_invoice_documents WHERE tenant_id=$1 AND invoice_id=$2",[s.tenantId,invoiceId])).rows[0];
    if(!doc||createHash('sha256').update(doc.pdf_bytes).digest('hex')!==doc.sha256)throw new BillingError("billing_document_missing");
    const settings=(await client.query<{brand_primary_color:string|null;contact_email:string|null;logo_blob_key:string|null;public_key:string|null}>(`SELECT settings.brand_primary_color,settings.contact_email,settings.logo_blob_key,checkout.public_key::text
      FROM tenant_contract_settings settings LEFT JOIN tenant_sponsoring_checkout_settings checkout ON checkout.tenant_id=settings.tenant_id WHERE settings.tenant_id=$1`,[s.tenantId])).rows[0];
    const logoUrl=settings?.logo_blob_key&&settings.public_key?`https://mittragen.ch/api/sponsoring-checkout/${encodeURIComponent(settings.public_key)}/logo`:undefined;
    const content=buildInvoiceEmail(invoice,{color:settings?.brand_primary_color??undefined,logoUrl});
    const replyTo=validInvoiceEmail(settings?.contact_email)?settings.contact_email:config.replyTo;
    const payload={from:config.from,to:[recipient],...content,...(replyTo?{reply_to:replyTo}:{}),attachments:[{filename:`${invoice.invoice_number}.pdf`,content:Buffer.from(doc.pdf_bytes).toString('base64')}]};
    const row=(await client.query<Dispatch>(`INSERT INTO billing_email_dispatches(id,tenant_id,invoice_id,recipient_email,pdf_sha256,payload,status,created_by)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,'sending',$7) RETURNING *`,[randomUUID(),s.tenantId,invoiceId,recipient,doc.sha256,JSON.stringify(payload),s.actor])).rows[0];
    await audit(client,s,"invoice_email.approved",row.id,{invoiceId,recipientEmail:recipient,pdfSha256:doc.sha256});
    return {row,send:true};
  });
  if(!reservation.send)return publicDispatch(reservation.row);
  const row=reservation.row;
  try{
    const response=await fetch("https://api.resend.com/emails",{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${config.apiKey}`,"Content-Type":"application/json","Idempotency-Key":`invoice-email/${row.id}`},body:JSON.stringify(row.payload)});
    if(!response.ok)throw new BillingError(response.status===429?"invoice_email_rate_limited":"invoice_email_provider_error",502);
    const data=await response.json() as {id?:unknown};
    if(typeof data.id!=="string"||!data.id)throw new BillingError("invoice_email_uncertain",502);
    return await session(s,async client=>{
      const saved=(await client.query<Dispatch>("UPDATE billing_email_dispatches SET status='accepted',provider_id=$3,accepted_at=now(),last_error=NULL WHERE tenant_id=$1 AND id=$2 RETURNING *",[s.tenantId,row.id,data.id])).rows[0];
      await audit(client,s,"invoice_email.accepted",row.id,{invoiceId,providerId:data.id});return publicDispatch(saved);
    });
  }catch(error){
    const code=error instanceof BillingError?error.message:"invoice_email_uncertain";
    await session(s,client=>client.query("UPDATE billing_email_dispatches SET status='needs_review',last_error=$3 WHERE tenant_id=$1 AND id=$2 AND status<>'accepted'",[s.tenantId,row.id,code]));
    throw new BillingError(code,502);
  }
}
