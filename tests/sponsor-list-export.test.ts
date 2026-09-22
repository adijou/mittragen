import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { createSponsorListXlsx, sponsorListExportResponse, type SponsorListExport } from "../netlify/functions/_shared/sponsor-list-export.ts";
import { createSponsorListPdf } from "../netlify/functions/_shared/sponsor-list-pdf.ts";

const sponsor = { id: "s1", legal_name: "Müller & Söhne", contact_name: "René Müller", contact_email: "rene@example.invalid",
  phone: "+41 79 000 00 00", street: "Dorfstrasse 2", postal_code: "0123", city: "Bösingen", website: null, status: "active" };
const free = { contract_id: "c1", contract_number: "C1", package_id: "board", package_name: "Werbetafel", annual_value_cents: 0 };
const data: SponsorListExport = {
  organizationName: "FC Bösingen", generatedAt: "2026-09-22T12:00:00Z",
  sponsors: [
    { ...sponsor, package_assignments: [free, free, { ...free, contract_id: "c2", package_id: "club", package_name: "Clubinfo", annual_value_cents: 30000 }] },
    { ...sponsor, id: "s2", legal_name: '=HYPERLINK("https://example.invalid")', package_assignments: [] },
  ],
};

test("XLSX round trip preserves text, free versus absent packages, formulas, filters and frozen panes", async () => {
  const bytes = await createSponsorListXlsx(data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(workbook.worksheets.map(s => s.name), ["Sponsorenpakete", "Kontaktdaten"]);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("A6").value, "Müller & Söhne");
  assert.equal(sheet.getCell("B6").value, 300);
  assert.equal(sheet.getCell("C6").value, 0);
  assert.equal(sheet.getCell("C7").value, null);
  assert.deepEqual(sheet.getCell("D6").value, { formula: "SUM(B6:C6)", result: 300 });
  assert.deepEqual(sheet.getCell("D8").value, { formula: "SUM(D6:D7)", result: 300 });
  assert.equal(sheet.getCell("A7").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("A7").value, data.sponsors[1].legal_name);
  assert.equal(sheet.autoFilter, "A5:D7");
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal((sheet.views[0] as ExcelJS.WorksheetViewFrozen).xSplit, 1);
  assert.equal((sheet.views[0] as ExcelJS.WorksheetViewFrozen).ySplit, 5);
  assert.equal(sheet.getCell("C6").numFmt, '#,##0.00;[Red]-#,##0.00;0.00');
  const contacts = workbook.worksheets[1];
  assert.equal(contacts.getCell("D6").value, sponsor.phone);
  assert.equal(contacts.getCell("F6").value, "0123");
  assert.equal(contacts.getCell("I6").value, "Aktiv");
});

test("empty and package-free exports remain valid documents", async () => {
  for (const sponsors of [[], [sponsor]]) {
    const empty = { ...data, sponsors };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await createSponsorListXlsx(empty)));
    assert.equal(workbook.worksheets[0].getCell(`B${sponsors.length + 6}`).result, 0);
    const pdf = await PDFDocument.load(await createSponsorListPdf(empty));
    assert.equal(pdf.getPageCount(), 1);
  }
});

test("PDF paginates long lists and additional package columns on landscape pages", async () => {
  const long = { ...data, sponsors: Array.from({ length: 71 }, (_, i) => ({ ...sponsor, id: `s${i}`, legal_name: `${i + 1} Müller, Götschmann + Ackermann Garage`,
    package_assignments: Array.from({ length: 12 }, (_, j) => ({ ...free, contract_id: `${i}-${j}`, package_id: `p${j}`, package_name: `Clubinfo – Paket ${j + 1}`, annual_value_cents: j * 12500 })) })) };
  const pdf = await PDFDocument.load(await createSponsorListPdf(long));
  assert.equal(pdf.getTitle(), "Sponsorenliste FC Bösingen");
  assert.ok(pdf.getPageCount() >= 6);
  for (const page of pdf.getPages()) { assert.ok(page.getWidth() > page.getHeight()); }
});

test("exports are genuine downloadable documents with private cache headers and safe filenames", async () => {
  for (const format of ["xlsx", "pdf", "csv"]) {
    const response = await sponsorListExportResponse(format, { ...data, organizationName: 'Verein "Test" / Bösingen' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Content-Disposition"), `attachment; filename="sponsoren-verein-test-bosingen-2026-09-22.${format}"`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (format === "xlsx") assert.equal(new TextDecoder().decode(bytes.slice(0, 2)), "PK");
    if (format === "pdf") assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "%PDF");
    if (format === "csv") assert.ok(new TextDecoder().decode(bytes).includes("Müller & Söhne"));
  }
});
