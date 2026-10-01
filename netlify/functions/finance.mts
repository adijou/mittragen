import type { Config, Context } from "@netlify/functions";
import { verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession } from "./_shared/database.ts";
import { billingReadiness } from "./_shared/billing-config.ts";
import { billingSources } from "./_shared/billing-sources.ts";
import { BillingError, discardPayout, draftInvoice, invoiceRefreshSources, refreshInvoice, lockBilling, preparePayout, recordPayout, recordReceipt, reverseReceipt, settlePayout, sourceMatches, type InvoiceRow } from "./_shared/billing-ledger.ts";
import { closedMonth, isDate, swissToday } from "../../shared/billing.ts";
import { createInvoiceDraftPdf } from "./_shared/invoice-pdf.ts";
import { loadOrganizationPdfBrand } from "./_shared/organization-pdf-brand.ts";
import { pingenSamplePrice } from "./_shared/pingen.ts";
import { assumeFeeByClub, reverseFeeSettlement } from "./_shared/fee-settlements.ts";
import { cancelInvoice, recreateInvoice } from "./_shared/invoice-replacement.ts";
import { issueInvoice } from "./_shared/invoice-issuing.ts";

function operator(userId: string) {
  return (Netlify.env.get("BILLING_OPERATOR_USER_IDS") ?? "").split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}
const bankReference = (value: unknown): value is string => typeof value === "string" && value.trim().length >= 3 && value.trim().length <= 200;
const dateInPast = (value: unknown): value is string => isDate(value) && value >= "2020-01-01" && value <= swissToday();

export default async (request: Request, context: Context) => {
  const match = new URL(request.url).pathname.match(/^\/api\/finance\/([0-9a-f-]+)(?:\/(invoices|receipts|payouts|fee-settlements|pingen-price)(?:\/([0-9a-f-]+)(?:\/(pdf|issue|refresh|cancel|recreate|receipts|assume-fee|reverse|paid|discard|settle))?)?)?$/i);
  if (!match || !isUuid(match[1]) || (match[3] && !isUuid(match[3]))) return json({ error: "not_found" },404);
  const [,tenantId,resource,id,action] = match;
  const read = request.method === "GET" && ((!resource && !id) || (resource === "invoices" && id && action === "pdf"));
  const write = request.method === "POST" && ((resource === "invoices" && ((!id && !action) || (id && (action === "receipts" || action === "issue" || action === "refresh" || action === "cancel" || action === "recreate" || action === "assume-fee"))))
    || ((resource === "receipts" || resource === "fee-settlements") && id && action === "reverse") || (resource === "pingen-price" && !id) || (resource === "payouts" && ((!id && !action) || (id && (action === "paid" || action === "discard" || action === "settle")))));
  if (!read && !write) return json({ error: "method_not_allowed" },405);
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  if (write) { try { verifyRequestOrigin(request); } catch { return json({ error: "invalid_request_origin" },403); } }
  const body = write ? await request.json().catch(() => null) : null;
  if (write && (!body || typeof body !== "object" || Array.isArray(body))) return json({ error: "invalid_billing_input" },422);
  try {
    const result = await withSession(user.id,tenantId,async (client) => {
      const roles = await client.query<{ role: MembershipRole }>("SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND identity_user_id=$2",[tenantId,user.id]);
      const role = roles.rows[0]?.role;
      if (!role || !hasPermission(role,write ? "finance:write" : "finance:read")) throw new BillingError("permission_denied",403);
      const canRecordBankMovements = operator(user.id) && hasPermission(role,"finance:write");
      if (write) {
        // Finance writers can issue their club's invoices; only the collection operator attests bank movements.
        if ((action && action !== "issue" && action !== "refresh" && action !== "cancel" && action !== "recreate" || resource === "payouts" || resource === "pingen-price") && !canRecordBankMovements) throw new BillingError("billing_operator_required",403);
        await lockBilling(client,tenantId);
      }
      if (resource === "pingen-price") return { pingenPrice: true as const };
      if (!resource) {
        const { sources,unresolved } = await billingSources(client,tenantId);
        const invoices = await client.query<InvoiceRow & { received_cents: string }>(`SELECT invoice.*,COALESCE((SELECT sum(amount_cents) FROM billing_receipts receipt
          WHERE receipt.tenant_id=invoice.tenant_id AND receipt.invoice_id=invoice.id AND receipt.reversed_at IS NULL),0)::text received_cents,
          COALESCE(booking.contact_email,contract.sponsor_snapshot->>'contactEmail','') AS recipient_email
          FROM billing_invoices invoice
          LEFT JOIN event_sponsorship_bookings booking ON invoice.source_type='event_booking' AND booking.tenant_id=invoice.tenant_id AND booking.id=invoice.source_id
          LEFT JOIN sponsorship_contracts contract ON invoice.source_type='contract' AND contract.tenant_id=invoice.tenant_id AND contract.id=invoice.source_id
          WHERE invoice.tenant_id=$1 ORDER BY invoice.created_at DESC`,[tenantId]);
        const receipts = await client.query(`SELECT receipt.*,item.payout_id FROM billing_receipts receipt LEFT JOIN billing_payout_items item
          ON item.tenant_id=receipt.tenant_id AND item.receipt_id=receipt.id WHERE receipt.tenant_id=$1 ORDER BY receipt.recorded_at DESC,receipt.id DESC`,[tenantId]);
        const payouts = await client.query("SELECT *,amount_cents::text FROM billing_payouts WHERE tenant_id=$1 ORDER BY through_month DESC",[tenantId]);
        const dispatches=await client.query("SELECT * FROM billing_postal_dispatches WHERE tenant_id=$1 ORDER BY created_at DESC",[tenantId]);
        const postalCosts=await client.query(`SELECT cost.*,dispatch.invoice_id,dispatch.provider_letter_id,
          (cost.amount_cents-COALESCE((SELECT sum(item.amount_cents) FROM billing_payout_postal_items item WHERE item.tenant_id=cost.tenant_id AND item.cost_id=cost.id),0))::text remaining_cents
          FROM billing_postal_costs cost JOIN billing_postal_dispatches dispatch ON dispatch.id=cost.dispatch_id AND dispatch.tenant_id=cost.tenant_id WHERE cost.tenant_id=$1 ORDER BY cost.created_at DESC`,[tenantId]);
        const postalItems=await client.query("SELECT * FROM billing_payout_postal_items WHERE tenant_id=$1",[tenantId]);
        const feeSettlements=await client.query<{invoice_id:string;reversed_at:string|null;waived_cents:number}>(`SELECT fee.*,(fee.club_charge_cents-COALESCE((SELECT sum(item.amount_cents) FROM billing_payout_fee_items item WHERE item.tenant_id=fee.tenant_id AND item.settlement_id=fee.id),0))::text remaining_cents FROM billing_fee_settlements fee WHERE fee.tenant_id=$1 ORDER BY fee.created_at DESC`,[tenantId]);
        const feeItems=await client.query("SELECT * FROM billing_payout_fee_items WHERE tenant_id=$1",[tenantId]);
        const emailDispatches=await client.query("SELECT id,invoice_id,recipient_email,status,provider_id,accepted_at,first_attempt_at,last_attempt_at,last_error FROM billing_email_dispatches WHERE tenant_id=$1 ORDER BY first_attempt_at DESC",[tenantId]);
        return json({ emailDispatches:emailDispatches.rows,feeSettlements:feeSettlements.rows,feeItems:feeItems.rows,dispatches:dispatches.rows,postalCosts:postalCosts.rows,postalItems:postalItems.rows,readiness:billingReadiness(), canWrite:hasPermission(role,"finance:write"),canRecordBankMovements,
          sources:sources.filter((source) => source.canCreateDraft && !invoices.rows.some((row) => row.status!=="cancelled" && row.source_key === source.sourceKey)),unresolved,
          invoices:invoices.rows.map((row) => ({...row,sourceAvailable:sourceMatches(row,sources),refreshSources:invoiceRefreshSources(row,sources),replacementId:invoices.rows.find(next=>next.replacement_for===row.id)?.id??null,fee_waived_cents:feeSettlements.rows.filter((fee)=>fee.invoice_id===row.id&&!fee.reversed_at).reduce((sum,fee)=>sum+fee.waived_cents,0)})),receipts:receipts.rows,payouts:payouts.rows });
      }
      if (read && id) {
        const invoice = await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND id=$2",[tenantId,id]);
        if (!invoice.rows[0]) throw new BillingError("not_found",404);
        if (invoice.rows[0].invoice_number) {
          const document = await client.query<{pdf_bytes:Buffer}>("SELECT pdf_bytes FROM billing_invoice_documents WHERE tenant_id=$1 AND invoice_id=$2",[tenantId,id]);
          if (!document.rows[0]) throw new BillingError("billing_document_missing",409);
          return {bytes:document.rows[0].pdf_bytes,filename:`${invoice.rows[0].status==="cancelled"?"Storniert_":""}${invoice.rows[0].invoice_number}`};
        }
        if (!sourceMatches(invoice.rows[0],(await billingSources(client,tenantId)).sources)) throw new BillingError("billing_source_unavailable");
        return { invoice:invoice.rows[0],brand:await loadOrganizationPdfBrand(client,tenantId,context.requestId) };
      }
      if (resource === "invoices" && !id) {
        if (typeof body.sourceKey !== "string" || body.sourceKey.length > 200) throw new BillingError("invalid_billing_input",422);
        return json({ invoice:await draftInvoice(client,tenantId,user.id,body.sourceKey,body.refresh === true) },201);
      }
      if (resource === "invoices" && (action === "cancel" || action === "recreate") && id) {
        if(body.confirmed!==true || typeof body.reason!=="string" || body.reason.trim().length<5 || body.reason.length>500
          || (body.sourceKey!==undefined && (typeof body.sourceKey!=="string" || body.sourceKey.length>200)))throw new BillingError("invalid_billing_input",422);
        const input={reason:body.reason.trim(),deliveryAcknowledged:body.deliveryAcknowledged===true,sourceKey:body.sourceKey};
        return json({invoice:await (action==="cancel"?cancelInvoice:recreateInvoice)(client,tenantId,user.id,id,input)});
      }
      if (resource === "invoices" && action === "refresh" && id) {
        if (body.sourceKey !== undefined && (typeof body.sourceKey !== "string" || body.sourceKey.length > 200)) throw new BillingError("invalid_billing_input",422);
        return json({invoice:await refreshInvoice(client,tenantId,user.id,id,body.sourceKey)});
      }
      if (resource === "invoices" && action === "issue" && id) {
        if (body.detailsConfirmed !== true) throw new BillingError("invalid_billing_input",422);
        return json({invoice:await issueInvoice(client,tenantId,user.id,id,context.requestId)});
      }
      if (resource === "invoices" && action === "assume-fee" && id) {
        if(body.confirmed!==true || typeof body.reason!=="string" || body.reason.trim().length<5 || body.reason.length>500) throw new BillingError("invalid_billing_input",422);
        return json({id:await assumeFeeByClub(client,tenantId,user.id,id,body.reason.trim())});
      }
      if(resource === "fee-settlements" && action === "reverse" && id) {
        if(typeof body.reason!=="string" || body.reason.trim().length<5 || body.reason.length>500) throw new BillingError("invalid_billing_input",422);
        await reverseFeeSettlement(client,tenantId,user.id,id,body.reason.trim());return json({reversed:true});
      }
      if (resource === "invoices" && action === "receipts" && id) {
        if (!isUuid(body.idempotencyKey) || !Number.isSafeInteger(body.amountCents) || body.amountCents <= 0 || !dateInPast(body.receivedOn)
          || !bankReference(body.bankReference) || body.bankEvidenceConfirmed !== true) throw new BillingError("invalid_billing_input",422);
        return json({ id:await recordReceipt(client,tenantId,user.id,id,{...body,bankReference:body.bankReference.trim()}) },201);
      }
      if (resource === "receipts" && action === "reverse" && id) {
        if (typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 500) throw new BillingError("invalid_billing_input",422);
        await reverseReceipt(client,tenantId,user.id,id,body.reason.trim()); return json({ reversed:true });
      }
      if (resource === "payouts" && !id) {
        if (!closedMonth(body.month)) throw new BillingError("billing_month_not_closed",422);
        return json({ id:await preparePayout(client,tenantId,user.id,body.month) },201);
      }
      if (resource === "payouts" && action === "discard" && id) {
        if (typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 500) throw new BillingError("invalid_billing_input",422);
        await discardPayout(client,tenantId,user.id,id,body.reason.trim()); return json({ discarded:true });
      }
      if (resource === "payouts" && action === "settle" && id) {
        if(body.confirmed!==true)throw new BillingError("invalid_billing_input",422);
        await settlePayout(client,tenantId,user.id,id);return json({settled:true});
      }
      if (resource === "payouts" && action === "paid" && id) {
        if (!dateInPast(body.paidOn) || !bankReference(body.bankReference) || body.bankEvidenceConfirmed !== true) throw new BillingError("invalid_billing_input",422);
        await recordPayout(client,tenantId,user.id,id,body.paidOn,body.bankReference.trim()); return json({ recorded:true });
      }
      throw new BillingError("not_found",404);
    },user.email ?? undefined);
    if (result instanceof Response) return result;
    if ("pingenPrice" in result) return json({ quote:await pingenSamplePrice() });
    const bytes = "bytes" in result ? result.bytes : await createInvoiceDraftPdf(result.invoice,result.brand);
    const filename = "filename" in result ? result.filename : result.invoice.reference;
    return new Response(bytes as BodyInit,{ headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${filename}.pdf"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"} });
  } catch (error) {
    if (error instanceof BillingError) return json({ error:error.message },error.status);
    if (error instanceof Error && ["billing_invoice_layout_too_long","billing_address_too_long","billing_pdf_character_unsupported","billing_qr_address_invalid","billing_qr_data_invalid"].includes(error.message)) return json({error:error.message},422);
    if ((error as {code?:string}).code === "23505") return json({error:"billing_duplicate_entry"},409);
    console.error("finance_request_failed",{ requestId:context.requestId,tenantId,error });
    return json({error:"finance_request_failed",requestId:context.requestId},500);
  }
};

export const config: Config = { path:["/api/finance/:tenantId","/api/finance/:tenantId/invoices","/api/finance/:tenantId/invoices/:id/pdf",
  "/api/finance/:tenantId/invoices/:id/cancel","/api/finance/:tenantId/invoices/:id/recreate",
  "/api/finance/:tenantId/invoices/:id/issue","/api/finance/:tenantId/invoices/:id/refresh","/api/finance/:tenantId/invoices/:id/receipts",
    "/api/finance/:tenantId/invoices/:id/assume-fee",
    "/api/finance/:tenantId/fee-settlements/:id/reverse","/api/finance/:tenantId/receipts/:id/reverse","/api/finance/:tenantId/payouts","/api/finance/:tenantId/payouts/:id/paid","/api/finance/:tenantId/pingen-price","/api/finance/:tenantId/payouts/:id/discard","/api/finance/:tenantId/payouts/:id/settle"] };
