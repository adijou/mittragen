import ExcelJS from "exceljs";
import { packageOverview, sponsorPackageCsv, type SponsorOverviewRow } from "../../../src/sponsorPackageOverview.ts";
import type { OrganizationPdfBrand } from "./organization-pdf-brand.ts";
import { createSponsorListPdf } from "./sponsor-list-pdf.ts";

export type SponsorListExport = {
  sponsors: SponsorOverviewRow[];
  organizationName: string;
  generatedAt: string;
  brand?: OrganizationPdfBrand;
};

const NAVY = "FF0B2142";
const BLUE = "FF1F6BFF";
const WHITE = "FFFFFFFF";
const LIGHT = "FFF1F5FA";
const MONEY = '#,##0.00;[Red]-#,##0.00;0.00';
const statusLabels: Record<string, string> = {
  draft: "Entwurf", prepared: "Vorbereitet", review: "In Prüfung", opened: "Vorschlag geöffnet",
  question: "Rückfrage", approved: "Zugesagt", active: "Aktiv", inactive: "Inaktiv",
};

export function exportDate(value: string) {
  return new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export async function createSponsorListXlsx(data: SponsorListExport): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "mittragen.ch";
  workbook.created = new Date(data.generatedAt);
  workbook.modified = new Date(data.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  const { columns, rows } = packageOverview(data.sponsors);

  const setup = (name: string, headers: string[], widths: number[], note: string) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        printTitlesRow: "1:5", margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 } },
      headerFooter: { oddFooter: "&Lmittragen.ch&RSeite &P von &N" },
    });
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.getCell("A1").value = `${data.organizationName} – ${name}`;
    sheet.getCell("A1").font = { name: "Calibri", size: 20, bold: true, color: { argb: WHITE } };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    sheet.getCell("A1").alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(1).height = 42;
    sheet.mergeCells(2, 1, 2, headers.length);
    sheet.getCell("A2").value = `Stand ${exportDate(data.generatedAt)} · ${rows.length} Sponsoren · Beträge in CHF pro Jahr`;
    sheet.getCell("A2").font = { name: "Calibri", size: 11, color: { argb: NAVY } };
    sheet.getRow(2).height = 24;
    sheet.mergeCells(3, 1, 3, headers.length);
    sheet.getCell("A3").value = note;
    sheet.getCell("A3").font = { name: "Calibri", size: 10, color: { argb: "FF50617A" } };
    sheet.getCell("A3").alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(3).height = 32;
    const header = sheet.getRow(5);
    header.values = headers;
    header.height = 46;
    header.eachCell(cell => {
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
      cell.alignment = { wrapText: true, vertical: "middle" };
    });
    sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, rows.length + 5), column: headers.length } };
    return sheet;
  };
  const styleRow = (row: ExcelJS.Row, index: number, total = false) => {
    row.height = total ? 28 : 32;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: "Calibri", size: 11, bold: total, color: { argb: total ? WHITE : NAVY } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: total ? NAVY : index % 2 ? LIGHT : WHITE } };
      if (!total) row.height = Math.max(row.height, Math.ceil(cell.text.length / Math.max(8, (cell.worksheet.getColumn(cell.col).width ?? 18) * 0.85 - 2)) * 15 + 6);
    });
  };

  const matrix = setup("Sponsorenpakete", ["Sponsor", ...columns.map(c => c.name), "Total CHF/Jahr"],
    [42, ...columns.map(() => 18), 20],
    "Bestätigte Verträge inkl. Altbestand. 0.00 = kostenlos; leeres Paketfeld = keine Zuordnung. Entwürfe und aufgehobene Verträge sind nicht enthalten.");
  rows.forEach(({ sponsor, amounts, totalCents }, index) => {
    // Strings stay strings, including names that begin with =, +, - or @.
    const row = matrix.addRow([sponsor.legal_name, ...columns.map(c => amounts.has(c.id) ? amounts.get(c.id)! / 100 : null),
      { formula: columns.length ? `SUM(B${index + 6}:${matrix.getColumn(columns.length + 1).letter}${index + 6})` : "0", result: totalCents / 100 }]);
    styleRow(row, index);
    for (let column = 2; column <= columns.length + 2; column++) {
      row.getCell(column).numFmt = MONEY;
      row.getCell(column).alignment = { vertical: "middle", horizontal: "right" };
    }
  });
  const total = matrix.addRow(["Gesamttotal"]);
  for (let column = 2; column <= columns.length + 2; column++) {
    const letter = matrix.getColumn(column).letter;
    const cents = column === columns.length + 2 ? rows.reduce((s, r) => s + r.totalCents, 0)
      : rows.reduce((s, r) => s + (r.amounts.get(columns[column - 2].id) ?? 0), 0);
    total.getCell(column).value = { formula: rows.length ? `SUM(${letter}6:${letter}${rows.length + 5})` : "0", result: cents / 100 };
    total.getCell(column).numFmt = MONEY;
  }
  styleRow(total, 0, true);
  total.eachCell((cell, column) => { if (column > 1) cell.alignment = { horizontal: "right", vertical: "middle" }; });

  const contacts = setup("Kontaktdaten", ["Sponsor", "Kontaktperson", "E-Mail", "Telefon", "Strasse", "PLZ", "Ort", "Website", "Status"],
    [42, 28, 38, 23, 32, 12, 25, 38, 20], "Alle Sponsoren der gewählten Organisation, unabhängig von Such- und Logo-Filtern. Kontaktdaten zum Exportzeitpunkt.");
  rows.forEach(({ sponsor }, index) => {
    const row = contacts.addRow([sponsor.legal_name, sponsor.contact_name, sponsor.contact_email, sponsor.phone,
      sponsor.street, sponsor.postal_code, sponsor.city, sponsor.website, statusLabels[sponsor.status] ?? sponsor.status]);
    styleRow(row, index);
    // Preserve leading zeros and international phone prefixes.
    row.getCell(4).numFmt = "@";
    row.getCell(6).numFmt = "@";
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function sponsorListExportResponse(format: string, data: SponsorListExport): Promise<Response> {
  const contentType = format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : format === "pdf" ? "application/pdf" : "text/csv;charset=utf-8";
  const bytes = format === "xlsx" ? await createSponsorListXlsx(data)
    : format === "pdf" ? await createSponsorListPdf(data) : new TextEncoder().encode(sponsorPackageCsv(data.sponsors));
  const slug = data.organizationName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "verein";
  const filename = `sponsoren-${slug}-${data.generatedAt.slice(0, 10)}.${format}`;
  return new Response(new Uint8Array(bytes).buffer, { headers: {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
