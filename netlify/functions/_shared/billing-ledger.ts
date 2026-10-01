import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./database.ts";
import { splitReceipt } from "../../../shared/billing.ts";
import { billingSources, type InvoiceParty, type InvoiceSource } from "./billing-sources.ts";
import type { QrCreditor } from "./swiss-qr.ts";
import { allocatePostalCosts, availablePostalCosts, requireConfirmedPostalCosts, requireFreshPayoutCosts } from "./postal-costs.ts";
import { swissToday } from "../../../shared/billing.ts";
import { availableFeeCharges, requireFreshFeeCharges } from "./fee-settlements.ts";

export class BillingError extends Error {
  status: number;
  constructor(code: string, status = 409) { super(code); this.status = status; }
}
export type InvoiceRow = {
  id: string; source_type: string; source_id: string; source_key: string; reference: string; description: string;
  recipient: InvoiceParty; issuer: InvoiceParty; contribution_cents: number; platform_fee_cents: number;
  fee_basis_points: number; collection_notice: string; status: "draft" | "issued" | "cancelled"; created_at: string;
  invoice_number?: string | null; qr_reference?: string | null; payment_creditor?: QrCreditor | null;
  issued_on?: string | null; issued_by?: string | null;
  period_start?: string | Date | null; period_end?: string | Date | null;
};

export const lockBilling = (client: DatabaseClient, tenantId: string) => client.query(
  "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`billing:${tenantId}`]);

async function audit(client: DatabaseClient, tenantId: string, actor: string, action: string, id: string, metadata: object = {}) {
  await client.query(`INSERT INTO audit_events (tenant_id,actor_user_id,action,object_type,object_id,metadata)
    VALUES ($1,$2,$3,'billing',$4,$5::jsonb)`, [tenantId, actor, action, id, JSON.stringify(metadata)]);
}

export async function draftInvoice(client: DatabaseClient, tenantId: string, actor: string, sourceKey: string, refresh = false) {
  if (refresh) {
    const existing = await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND source_key=$2", [tenantId, sourceKey]);
    if (!existing.rows[0]) throw new BillingError("not_found",404);
    return refreshInvoice(client,tenantId,actor,existing.rows[0].id);
  }
  const { sources } = await billingSources(client, tenantId);
  const source = sources.find((item) => item.sourceKey === sourceKey);
  if (!source) throw new BillingError("billing_source_unavailable");
  const existing = await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND source_key=$2", [tenantId, sourceKey]);
  if (existing.rows[0]) return existing.rows[0];
  // Earlier open-ended periods stay valid for existing documents; do not back-bill imported history.
  if (!source.canCreateDraft) throw new BillingError("billing_source_unavailable");
  if (source.periodStart && source.periodEnd) {
    const familyPrefix = source.sourceKey.split(":").slice(0,2).join(":") + ":%";
    const overlap = await client.query("SELECT id FROM billing_invoices WHERE tenant_id=$1 AND source_key LIKE $2 AND period_start <= $4::date AND period_end >= $3::date",[tenantId,familyPrefix,source.periodStart,source.periodEnd]);
    if (overlap.rows.length) throw new BillingError("billing_period_overlap");
  }
  const id = randomUUID();
  const reference = `ENT-${new Date().getUTCFullYear()}-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const result = await client.query<InvoiceRow>(`INSERT INTO billing_invoices
    (id,tenant_id,source_type,source_id,source_key,reference,description,recipient,issuer,contribution_cents,
     fee_basis_points,platform_fee_cents,collection_notice,created_by,period_start,period_end)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
  [id,tenantId,source.sourceType,source.sourceId,source.sourceKey,reference,source.description,JSON.stringify(source.recipient),
    JSON.stringify(source.issuer),source.contributionCents,source.feeBasisPoints,source.platformFeeCents,source.collectionNotice,actor,source.periodStart ?? null,source.periodEnd ?? null]);
  await audit(client, tenantId, actor, "billing.draft_created", id, { sourceKey });
  return result.rows[0];
}

const periodDate = (value: string | Date | null | undefined) => value instanceof Date ? value.toISOString().slice(0,10) : value?.slice(0,10) ?? null;

/** Only confirmed sources from the same contract family and overlapping period can replace a draft. */
export function invoiceRefreshSources(invoice: InvoiceRow, sources: InvoiceSource[]) {
  return sources.filter(source => source.sourceKey === invoice.source_key || (
    invoice.source_type === "contract" && source.sourceType === "contract"
    && source.sourceKey.split(":")[1] === invoice.source_key.split(":")[1]
    && invoice.period_start && invoice.period_end && source.periodStart && source.periodEnd
    && source.periodStart <= periodDate(invoice.period_end)! && source.periodEnd >= periodDate(invoice.period_start)!
  ));
}

/** Caller holds the tenant billing lock. Keep the invoice identity while replacing its draft snapshot. */
export async function refreshInvoice(client: DatabaseClient, tenantId: string, actor: string, invoiceId: string, sourceKey?: string) {
  const invoice=(await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenantId,invoiceId])).rows[0];
  if (!invoice) throw new BillingError("not_found",404);
  if (invoice.status !== "draft") throw new BillingError("billing_invoice_locked");
  const paid=await client.query("SELECT id FROM billing_receipts WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL LIMIT 1",[tenantId,invoice.id]);
  if (paid.rows.length) throw new BillingError("billing_invoice_already_received");
  const candidates=invoiceRefreshSources(invoice,(await billingSources(client,tenantId)).sources);
  const source=sourceKey ? candidates.find(row=>row.sourceKey===sourceKey)
    : candidates.find(row=>row.sourceKey===invoice.source_key) ?? (candidates.length===1 ? candidates[0] : undefined);
  if (!source) throw new BillingError(!sourceKey && candidates.length>1 ? "billing_refresh_selection_required" : "billing_source_unavailable");
  if (source.periodStart && source.periodEnd) {
    const familyPrefix=source.sourceKey.split(":").slice(0,2).join(":")+":%";
    const overlap=await client.query("SELECT id FROM billing_invoices WHERE tenant_id=$1 AND id<>$2 AND source_key LIKE $3 AND period_start <= $5::date AND period_end >= $4::date",[tenantId,invoice.id,familyPrefix,source.periodStart,source.periodEnd]);
    if (overlap.rows.length) throw new BillingError("billing_period_overlap");
  }
  const result=await client.query<InvoiceRow>(`UPDATE billing_invoices SET source_id=$3,description=$4,recipient=$5::jsonb,issuer=$6::jsonb,
    contribution_cents=$7,fee_basis_points=$8,platform_fee_cents=$9,collection_notice=$10,source_key=$11,period_start=$12,period_end=$13
    WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,invoice.id,source.sourceId,source.description,JSON.stringify(source.recipient),JSON.stringify(source.issuer),
    source.contributionCents,source.feeBasisPoints,source.platformFeeCents,source.collectionNotice,source.sourceKey,source.periodStart??null,source.periodEnd??null]);
  await audit(client,tenantId,actor,"billing.draft_refreshed",invoice.id,{sourceKey:source.sourceKey,previousSourceKey:invoice.source_key,previousSourceId:invoice.source_id,sourceId:source.sourceId});
  return result.rows[0];
}

export function sourceMatches(invoice: InvoiceRow, sources: InvoiceSource[]) {
  return invoice.status !== "cancelled" && sources.some((source) => source.sourceKey === invoice.source_key
    && source.sourceId === invoice.source_id && source.contributionCents === invoice.contribution_cents
    && source.platformFeeCents === invoice.platform_fee_cents && source.feeBasisPoints === invoice.fee_basis_points
    && (source.periodStart ?? null) === periodDate(invoice.period_start)
    && (source.periodEnd ?? null) === periodDate(invoice.period_end));
}

// Once issued, the frozen invoice remains payable even after the underlying agreement changes.
const canSettle = (invoice: InvoiceRow, sources: InvoiceSource[]) => invoice.status === "issued" || sourceMatches(invoice,sources);

export async function recordReceipt(client: DatabaseClient, tenantId: string, actor: string, invoiceId: string,
  input: { idempotencyKey: string; amountCents: number; receivedOn: string; bankReference: string }) {
  const previous = await client.query<{ id: string; invoice_id: string; amount_cents: number; received_on: string; bank_reference: string }>(
    "SELECT id,invoice_id,amount_cents,received_on::text,bank_reference FROM billing_receipts WHERE tenant_id=$1 AND idempotency_key=$2", [tenantId, input.idempotencyKey]);
  if (previous.rows[0]) {
    const prior = previous.rows[0];
    if (prior.invoice_id !== invoiceId || prior.amount_cents !== input.amountCents || prior.received_on !== input.receivedOn || prior.bank_reference !== input.bankReference) throw new BillingError("billing_idempotency_conflict");
    return prior.id;
  }
  const duplicate = await client.query("SELECT id FROM billing_receipts WHERE tenant_id=$1 AND bank_reference=$2 AND reversed_at IS NULL", [tenantId,input.bankReference]);
  if (duplicate.rows.length) throw new BillingError("billing_bank_reference_used");
  const rows = await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, invoiceId]);
  const invoice = rows.rows[0];
  if (!invoice || !canSettle(invoice, (await billingSources(client, tenantId)).sources)) throw new BillingError("billing_source_unavailable");
  const settled=await client.query("SELECT id FROM billing_fee_settlements WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL",[tenantId,invoiceId]);
  if(settled.rows.length)throw new BillingError("billing_fee_already_settled");
  const sum = await client.query<{ paid: string }>("SELECT COALESCE(sum(amount_cents),0)::text paid FROM billing_receipts WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL", [tenantId,invoiceId]);
  let allocation;
  try { allocation = splitReceipt(invoice.contribution_cents, invoice.platform_fee_cents, Number(sum.rows[0].paid), input.amountCents); }
  catch { throw new BillingError("billing_overpayment"); }
  const id = randomUUID();
  await client.query(`INSERT INTO billing_receipts (id,tenant_id,invoice_id,idempotency_key,bank_reference,received_on,amount_cents,club_cents,platform_cents,recorded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,tenantId,invoiceId,input.idempotencyKey,input.bankReference,input.receivedOn,input.amountCents,allocation.clubCents,allocation.platformCents,actor]);
  await audit(client,tenantId,actor,"billing.receipt_recorded",id,{ invoiceId, amountCents: input.amountCents, ...allocation });
  return id;
}

export async function reverseReceipt(client: DatabaseClient, tenantId: string, actor: string, receiptId: string, reason: string) {
  const receipt = await client.query<{ invoice_id: string; reversed_at: string | null }>("SELECT invoice_id,reversed_at FROM billing_receipts WHERE tenant_id=$1 AND id=$2", [tenantId,receiptId]);
  if (!receipt.rows[0]) throw new BillingError("billing_receipt_not_found",404);
  if (receipt.rows[0].reversed_at) return;
  const settled=await client.query("SELECT id FROM billing_fee_settlements WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL",[tenantId,receipt.rows[0].invoice_id]);
  if(settled.rows.length)throw new BillingError("billing_fee_already_settled");
  const latest = await client.query<{ id: string }>(`SELECT id FROM billing_receipts WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL ORDER BY recorded_at DESC,id DESC LIMIT 1`, [tenantId,receipt.rows[0].invoice_id]);
  const assigned = await client.query("SELECT receipt_id FROM billing_payout_items WHERE tenant_id=$1 AND receipt_id=$2", [tenantId,receiptId]);
  if (latest.rows[0]?.id !== receiptId || assigned.rows.length) throw new BillingError("billing_receipt_locked");
  await client.query("UPDATE billing_receipts SET reversed_at=now(),reversal_reason=$3 WHERE tenant_id=$1 AND id=$2", [tenantId,receiptId,reason]);
  await audit(client,tenantId,actor,"billing.receipt_reversed",receiptId,{ reason });
}

export async function preparePayout(client: DatabaseClient, tenantId: string, actor: string, month: string) {
  const existing = await client.query<{ id: string }>("SELECT id FROM billing_payouts WHERE tenant_id=$1 AND through_month=$2", [tenantId,month]);
  if (existing.rows[0]) return existing.rows[0].id;
  await requireConfirmedPostalCosts(client,tenantId,month);
  const { sources } = await billingSources(client,tenantId);
  const invoices = await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1",[tenantId]);
  const allowedIds = invoices.rows.filter((row) => canSettle(row,sources)).map((row) => row.id);
  const receipts = await client.query<{ id: string; club_cents: number }>(`SELECT receipt.id,receipt.club_cents FROM billing_receipts receipt
    WHERE receipt.tenant_id=$1 AND receipt.reversed_at IS NULL AND receipt.club_cents>0
      AND receipt.received_on < ($2::date + interval '1 month') AND receipt.invoice_id=ANY($3::uuid[])
      AND NOT EXISTS (SELECT 1 FROM billing_payout_items item WHERE item.tenant_id=receipt.tenant_id AND item.receipt_id=receipt.id)
    ORDER BY receipt.received_on,receipt.id`,[tenantId,`${month}-01`,allowedIds]);
  const id = randomUUID();
  const gross = receipts.rows.reduce((sum,row) => sum + row.club_cents,0);
  const allocation = allocatePostalCosts(gross,await availablePostalCosts(client,tenantId,month));
  const fees = allocatePostalCosts(allocation.netCents,await availableFeeCharges(client,tenantId,month));
  if (!receipts.rows.length && !allocation.items.length && !fees.items.length) throw new BillingError("billing_nothing_to_pay");
  await client.query("INSERT INTO billing_payouts (id,tenant_id,through_month,amount_cents,created_by,gross_cents,postal_cents,fee_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",[id,tenantId,month,fees.netCents,actor,gross,allocation.postalCents,fees.postalCents]);
  for (const receipt of receipts.rows) await client.query("INSERT INTO billing_payout_items (tenant_id,payout_id,receipt_id,amount_cents) VALUES ($1,$2,$3,$4)",[tenantId,id,receipt.id,receipt.club_cents]);
  for (const item of allocation.items) await client.query("INSERT INTO billing_payout_postal_items (tenant_id,payout_id,cost_id,amount_cents) VALUES ($1,$2,$3,$4)",[tenantId,id,item.id,item.amountCents]);
  for (const item of fees.items) await client.query("INSERT INTO billing_payout_fee_items (tenant_id,payout_id,settlement_id,amount_cents) VALUES ($1,$2,$3,$4)",[tenantId,id,item.id,item.amountCents]);
  await audit(client,tenantId,actor,"billing.payout_prepared",id,{ throughMonth: month, amountCents:fees.netCents,grossCents:gross,postalCents:allocation.postalCents,feeCents:fees.postalCents,receiptCount:receipts.rows.length });
  return id;
}

async function requirePayoutSources(client:DatabaseClient,tenantId:string,payoutId:string) {
  const invoices = await client.query<InvoiceRow>(`SELECT DISTINCT invoice.* FROM billing_invoices invoice
    JOIN billing_receipts receipt ON receipt.invoice_id=invoice.id AND receipt.tenant_id=invoice.tenant_id
    JOIN billing_payout_items item ON item.receipt_id=receipt.id AND item.tenant_id=receipt.tenant_id
    WHERE item.tenant_id=$1 AND item.payout_id=$2`,[tenantId,payoutId]);
  const { sources } = await billingSources(client,tenantId);
  if (invoices.rows.some((row) => !canSettle(row,sources))) throw new BillingError("billing_source_unavailable");
}

export async function recordPayout(client: DatabaseClient, tenantId: string, actor: string, payoutId: string, paidOn: string, bankReference: string) {
  const prior = await client.query<{ status: string; amount_cents:string; through_month: string; paid_on: string | null; bank_reference: string | null }>("SELECT status,amount_cents::text,through_month,paid_on::text,bank_reference FROM billing_payouts WHERE tenant_id=$1 AND id=$2",[tenantId,payoutId]);
  if (!prior.rows[0]) throw new BillingError("billing_payout_not_found",404);
  if (Number(prior.rows[0].amount_cents)===0) throw new BillingError("billing_payout_no_transfer",422);
  if (paidOn.slice(0,7) <= prior.rows[0].through_month) throw new BillingError("billing_payout_date_invalid",422);
  if (prior.rows[0].status === "paid") {
    if (prior.rows[0].paid_on !== paidOn || prior.rows[0].bank_reference !== bankReference) throw new BillingError("billing_payout_locked");
    return;
  }
  await requireFreshPayoutCosts(client,tenantId,payoutId);
  await requireFreshFeeCharges(client,tenantId,payoutId);
  await requirePayoutSources(client,tenantId,payoutId);
  await client.query("UPDATE billing_payouts SET status='paid',paid_on=$3,bank_reference=$4,recorded_by=$5 WHERE tenant_id=$1 AND id=$2",[tenantId,payoutId,paidOn,bankReference,actor]);
  await audit(client,tenantId,actor,"billing.payout_recorded",payoutId,{ paidOn, bankReference });
}

export async function settlePayout(client:DatabaseClient,tenantId:string,actor:string,payoutId:string) {
  const row=(await client.query<{status:string;amount_cents:string}>("SELECT status,amount_cents::text FROM billing_payouts WHERE tenant_id=$1 AND id=$2",[tenantId,payoutId])).rows[0];
  if(!row)throw new BillingError("billing_payout_not_found",404);
  if(row.status==='offset')return;
  if(row.status!=='prepared'||Number(row.amount_cents)!==0)throw new BillingError("billing_payout_locked");
  await requireFreshPayoutCosts(client,tenantId,payoutId);
  await requireFreshFeeCharges(client,tenantId,payoutId);
  await requirePayoutSources(client,tenantId,payoutId);
  await client.query("UPDATE billing_payouts SET status='offset',settled_on=$3,recorded_by=$4 WHERE tenant_id=$1 AND id=$2",[tenantId,payoutId,swissToday(),actor]);
  await audit(client,tenantId,actor,"billing.payout_offset",payoutId);
}

export async function discardPayout(client: DatabaseClient, tenantId: string, actor: string, payoutId: string, reason: string) {
  const payout = await client.query<{status:string;through_month:string;amount_cents:string}>("SELECT status,through_month,amount_cents::text FROM billing_payouts WHERE tenant_id=$1 AND id=$2",[tenantId,payoutId]);
  if (!payout.rows[0]) return;
  if (payout.rows[0].status !== "prepared") throw new BillingError("billing_payout_locked");
  const items = await client.query("SELECT receipt_id,amount_cents FROM billing_payout_items WHERE tenant_id=$1 AND payout_id=$2",[tenantId,payoutId]);
  const postalItems = await client.query("SELECT cost_id,amount_cents FROM billing_payout_postal_items WHERE tenant_id=$1 AND payout_id=$2",[tenantId,payoutId]);
  const feeItems = await client.query("SELECT settlement_id,amount_cents FROM billing_payout_fee_items WHERE tenant_id=$1 AND payout_id=$2",[tenantId,payoutId]);
  await audit(client,tenantId,actor,"billing.payout_preparation_discarded",payoutId,{...payout.rows[0],items:items.rows,postalItems:postalItems.rows,feeItems:feeItems.rows,reason});
  await client.query("DELETE FROM billing_payout_fee_items WHERE tenant_id=$1 AND payout_id=$2",[tenantId,payoutId]);
  await client.query("DELETE FROM billing_payout_postal_items WHERE tenant_id=$1 AND payout_id=$2",[tenantId,payoutId]);
  await client.query("DELETE FROM billing_payout_items WHERE tenant_id=$1 AND payout_id=$2",[tenantId,payoutId]);
  await client.query("DELETE FROM billing_payouts WHERE tenant_id=$1 AND id=$2",[tenantId,payoutId]);
}
