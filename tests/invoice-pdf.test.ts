import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createInvoicePdf } from "../netlify/functions/_shared/invoice-pdf.ts";
import type { InvoiceRow } from "../netlify/functions/_shared/billing-ledger.ts";
import { qrReference } from "../netlify/functions/_shared/swiss-qr.ts";

// Fictional parties and the public SIX example account: never a live payment fixture.
const invoice: InvoiceRow = {
  id: "fixture", source_type: "event", source_id: "fixture", source_key: "event:fixture",
  reference: "ENT-2026-TEST", description: "Matchballsponsoring · FC Muster - FC Beispiel · 10. Oktober 2026",
  recipient: { name: "Muster Sponsor AG", street: "Hauptstrasse 1", postalCode: "3186", city: "Düdingen", country: "CH" },
  issuer: { name: "FC Muster", street: "Sportweg 10", postalCode: "3186", city: "Düdingen", country: "CH" },
  contribution_cents: 100000, platform_fee_cents: 2500, fee_basis_points: 250,
  collection_notice: "Der Sponsoringbeitrag steht FC Muster zu. Test Inkasso zieht den Rechnungsbetrag im Auftrag des Vereins ein. Der Vereinsanteil wird monatlich abgerechnet.",
  status: "issued", created_at: "2026-09-30", issued_on: "2026-09-30", invoice_number: "RE-2026-00000001",
  qr_reference: qrReference("1"),
  payment_creditor: { iban: "CH4431999123000889012", name: "Test Inkasso", street: "", houseNumber: "", postalCode: "8000", city: "Zürich", country: "CH" },
};
const brand = { primaryColor: "#0B2142", accentColor: "#1F6BFF" };

test("issued invoices and drafts stay on one A4 page across organization brands and long fields", async () => {
  const variants = [
    { name: "rechnung-muster-blau", invoice, brand },
    { name: "rechnung-muster-gruen", invoice: { ...invoice, issuer: { ...invoice.issuer, name: "Sportverein Muster" },
      collection_notice: invoice.collection_notice.replace("FC Muster", "Sportverein Muster") },
      brand: { primaryColor: "#164B3F", accentColor: "#E5B640" } },
    { name: "rechnung-entwurf", invoice: { ...invoice, status: "draft" as const }, brand },
    { name: "rechnung-lange-angaben", invoice: { ...invoice,
      issuer: { ...invoice.issuer, name: "Verein für Sport und gemeinsame Begegnungen in der Region" },
      recipient: { ...invoice.recipient, name: "Musterunternehmen für Haustechnik und Gebäudeservice Bern AG",
        street: "Strasse der gemeinsamen sportlichen Begegnungen 125" },
      description: "Jahressponsoring für die Nachwuchsförderung und die erste Mannschaft, Saison 2026/2027, mit Matchballpartnerschaft und Bandenwerbung" },
      brand: { primaryColor: "#FFFFCC", accentColor: "#FFFFEE", logo: { bytes: await readFile("public/brand/digital-bell-logo.png"), contentType: "image/png" as const } } },
  ];
  for (const variant of variants) {
    const bytes = await createInvoicePdf(variant.invoice, variant.brand);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1, variant.name);
    assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.276) < 0.01);
    assert.ok(Math.abs(pdf.getPage(0).getHeight() - 841.89) < 0.01);
    assert.equal(pdf.getAuthor(), variant.invoice.issuer.name);
    if (process.env.INVOICE_LAYOUT_FIXTURES) {
      await mkdir(process.env.INVOICE_LAYOUT_FIXTURES, { recursive: true });
      await writeFile(join(process.env.INVOICE_LAYOUT_FIXTURES, `${variant.name}.pdf`), bytes);
    }
  }
});

test("overflow and unsupported financial text fail explicitly instead of adding sheets or losing data", async () => {
  await assert.rejects(createInvoicePdf({ ...invoice, description: "Ausführliche Vertragsbeschreibung ".repeat(100) }, brand), /billing_invoice_layout_too_long/);
  await assert.rejects(createInvoicePdf({ ...invoice, recipient: { ...invoice.recipient, name: "Langer Empfänger ".repeat(30) } }, brand), /billing_qr_address_invalid|billing_address_too_long/);
  await assert.rejects(createInvoicePdf({ ...invoice, description: "Sponsoring 🏆" }, brand), /billing_pdf_character_unsupported/);
});
