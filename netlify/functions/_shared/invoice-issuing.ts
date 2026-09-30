import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { DatabaseClient } from "./database.ts";
import { BillingError, sourceMatches, type InvoiceRow } from "./billing-ledger.ts";
import { billingSources } from "./billing-sources.ts";
import { readQrCreditor, qrReference } from "./swiss-qr.ts";
import { swissToday } from "../../../shared/billing.ts";
import { createInvoicePdf } from "./invoice-pdf.ts";
import { loadOrganizationPdfBrand } from "./organization-pdf-brand.ts";

/** Caller holds the tenant billing lock and transaction. Nothing is sent to a sponsor here. */
export async function issueInvoice(client: DatabaseClient, tenantId: string, actor: string, invoiceId: string, requestId: string) {
  const result = await client.query<InvoiceRow>("SELECT * FROM billing_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenantId,invoiceId]);
  const invoice = result.rows[0];
  if (!invoice) throw new BillingError("not_found",404);
  if (invoice.status === "issued") return invoice;
  const sources = (await billingSources(client,tenantId)).sources;
  const source = sources.find(row => row.sourceKey === invoice.source_key);
  if (!source || !sourceMatches(invoice,sources)) throw new BillingError("billing_source_unavailable");
  // Require the reviewed draft to match the same locked source; never silently replace its contents.
  if (!isDeepStrictEqual(source.recipient,invoice.recipient) || !isDeepStrictEqual(source.issuer,invoice.issuer)
    || source.description !== invoice.description || source.collectionNotice !== invoice.collection_notice) {
    throw new BillingError("billing_draft_outdated");
  }
  const receipts = await client.query("SELECT id FROM billing_receipts WHERE tenant_id=$1 AND invoice_id=$2 AND reversed_at IS NULL LIMIT 1",[tenantId,invoiceId]);
  if (receipts.rows.length) throw new BillingError("billing_invoice_already_received");
  const creditor = readQrCreditor(name => Netlify.env.get(name));
  if (!creditor) throw new BillingError("billing_qr_not_configured",422);
  const sequence = (await client.query<{ number:string }>("SELECT nextval('billing_invoice_number_seq')::text number")).rows[0].number;
  const issuedOn = swissToday();
  const invoiceNumber = `RE-${issuedOn.slice(0,4)}-${sequence.padStart(8,"0")}`;
  const issued: InvoiceRow = { ...invoice, status:"issued", invoice_number:invoiceNumber, qr_reference:qrReference(sequence),
    payment_creditor:creditor, issued_on:issuedOn, issued_by:actor,
    collection_notice:`Der Sponsoringbeitrag steht ${invoice.issuer.name} zu. ${creditor.name} zieht den Rechnungsbetrag im Auftrag des Vereins ein. Der Vereinsanteil wird monatlich abgerechnet.` };
  const bytes = await createInvoicePdf(issued,await loadOrganizationPdfBrand(client,tenantId,requestId));
  const hash = createHash("sha256").update(bytes).digest("hex");
  await client.query(`INSERT INTO billing_invoice_documents (invoice_id,tenant_id,pdf_bytes,sha256) VALUES ($1,$2,$3,$4)`,[invoiceId,tenantId,Buffer.from(bytes),hash]);
  const saved = await client.query<InvoiceRow>(`UPDATE billing_invoices SET status='issued',invoice_number=$3,qr_reference=$4,payment_creditor=$5::jsonb,
    issued_on=$6,issued_by=$7,collection_notice=$8 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [tenantId,invoiceId,invoiceNumber,issued.qr_reference,JSON.stringify(creditor),issuedOn,actor,issued.collection_notice]);
  await client.query(`INSERT INTO audit_events (tenant_id,actor_user_id,action,object_type,object_id,metadata)
    VALUES ($1,$2,'billing.invoice_issued','billing',$3,$4::jsonb)`,[tenantId,actor,invoiceId,JSON.stringify({invoiceNumber,qrReference:issued.qr_reference,sha256:hash})]);
  return saved.rows[0];
}
