import type { DatabaseClient } from "./database.ts";
import { billingSources } from "./billing-sources.ts";
import { BillingError, insertInvoiceDraft, invoiceRefreshSources, type InvoiceRow } from "./billing-ledger.ts";

type Correction = { reason:string; deliveryAcknowledged:boolean; sourceKey?:string };

async function loadInvoice(client:DatabaseClient,tenantId:string,id:string) {
  const invoice=(await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenantId,id])).rows[0];
  if(!invoice)throw new BillingError("not_found",404);
  return invoice;
}

/** Must run in a transaction with the tenant billing lock, shared by payment and dispatch reservations. */
export async function cancelInvoice(client:DatabaseClient,tenantId:string,actor:string,id:string,input:Correction) {
  const invoice=await loadInvoice(client,tenantId,id);
  if(invoice.status==='cancelled')return invoice;
  const receipts=await client.query("SELECT id FROM billing_receipts WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL LIMIT 1",[tenantId,id]);
  if(receipts.rows.length)throw new BillingError("billing_cancellation_has_receipts");
  const fees=await client.query("SELECT id FROM billing_fee_settlements WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL LIMIT 1",[tenantId,id]);
  if(fees.rows.length)throw new BillingError("billing_fee_already_settled");
  const email=await client.query<{status:string;last_attempt_at:string}>("SELECT status,last_attempt_at FROM billing_email_dispatches WHERE tenant_id=$1 AND invoice_id=$2",[tenantId,id]);
  const postal=await client.query<{status:string;updated_at:string;send_started_at:string|null;submitted_at:string|null}>("SELECT status,updated_at,send_started_at,submitted_at FROM billing_postal_dispatches WHERE tenant_id=$1 AND invoice_id=$2",[tenantId,id]);
  const recent=(value:string)=>Date.now()-new Date(value).getTime()<120000;
  if(email.rows.some(row=>row.status==='sending'&&recent(row.last_attempt_at)) || postal.rows.some(row=>row.status==='sending'&&recent(row.updated_at)))throw new BillingError("billing_cancellation_sending");
  const deliveryStarted=email.rows.length>0||postal.rows.some(row=>row.send_started_at||row.submitted_at||['submitted','sent','delivered','undeliverable'].includes(row.status));
  if(deliveryStarted&&!input.deliveryAcknowledged)throw new BillingError("billing_cancellation_delivery_confirmation");
  const cancelled=(await client.query<InvoiceRow>(`UPDATE billing_invoices SET status='cancelled',cancelled_at=now(),cancelled_by=$3,cancellation_reason=$4
    WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,id,actor,input.reason])).rows[0];
  await client.query(`INSERT INTO audit_events(tenant_id,actor_user_id,action,object_type,object_id,metadata)
    VALUES($1,$2,'billing.invoice_cancelled','billing',$3,$4::jsonb)`,[tenantId,actor,id,JSON.stringify({reason:input.reason,previousStatus:invoice.status,deliveryStarted,deliveryAcknowledged:input.deliveryAcknowledged})]);
  return cancelled;
}

/** Cancellation and fresh snapshot commit together. Retries return the same successor. */
export async function recreateInvoice(client:DatabaseClient,tenantId:string,actor:string,id:string,input:Correction) {
  const invoice=await loadInvoice(client,tenantId,id);
  const previous=(await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND replacement_for=$2",[tenantId,id])).rows[0];
  if(previous){
    if(input.sourceKey&&input.sourceKey!==previous.source_key)throw new BillingError("billing_idempotency_conflict");
    return previous;
  }
  const candidates=invoiceRefreshSources(invoice,(await billingSources(client,tenantId)).sources);
  const source=input.sourceKey?candidates.find(row=>row.sourceKey===input.sourceKey)
    :candidates.find(row=>row.sourceKey===invoice.source_key)??(candidates.length===1?candidates[0]:undefined);
  if(!source)throw new BillingError(!input.sourceKey&&candidates.length>1?"billing_refresh_selection_required":"billing_source_unavailable");
  const existing=await client.query(`SELECT id FROM billing_invoices WHERE tenant_id=$1 AND id<>$2 AND status<>'cancelled'
    AND (source_key=$3 OR (source_key LIKE $4 AND period_start <= $6::date AND period_end >= $5::date))`,
    [tenantId,id,source.sourceKey,source.sourceKey.split(':').slice(0,2).join(':')+':%',source.periodStart??null,source.periodEnd??null]);
  if(existing.rows.length)throw new BillingError("billing_period_overlap");
  await cancelInvoice(client,tenantId,actor,id,input);
  // An existing historical period may be replaced, but this does not offer new historical back-billing.
  return insertInvoiceDraft(client,tenantId,actor,source,id);
}
