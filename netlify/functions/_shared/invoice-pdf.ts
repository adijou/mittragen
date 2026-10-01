import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import PDFKit from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import type { InvoiceRow } from "./billing-ledger.ts";
import type { OrganizationPdfBrand } from "./organization-pdf-brand.ts";
import { drawPlatformCredit } from "./pdf-platform-brand.ts";
import { formatBillingChf } from "../../../shared/billing.ts";
import { invoiceQrData } from "./swiss-qr.ts";

const mm = (value: number) => value * 72 / 25.4;
const WIDTH = mm(210), HEIGHT = mm(297), LEFT = mm(18), RIGHT = mm(192), CONTENT = RIGHT - LEFT;
type Color = [number, number, number];
function color(value: string, fallback: string): Color {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as Color;
}
const mixWhite = (value: Color, weight: number): Color => value.map(channel => channel * (1 - weight) + weight) as Color;
// Same readable primary/accent treatment as the contract document family.
function darken(value: Color, limit: number): Color {
  const luminance = (v: Color) => v.map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
  let result = value;
  while (luminance(result) > limit) result = result.map(c => c * 0.82) as Color;
  return result;
}

/** Swiss domestic postal addresses end with postcode/city; ISO codes belong only in the QR data. */
export function invoicePostalAddress(recipient: InvoiceRow["recipient"]) {
  return [recipient.name, recipient.street, `${recipient.postalCode} ${recipient.city}`,
    ...(recipient.country === "CH" ? [] : [recipient.country])].filter(line => line.trim());
}

/** One A4 sheet, with an unscaled 210 x 105 mm payment part at the bottom. */
export async function createInvoicePdf(invoice: InvoiceRow, brand: OrganizationPdfBrand) {
  const issued = invoice.status === "issued";
  const documentNumber = issued ? invoice.invoice_number! : invoice.reference;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(resolve("assets/fonts/LiberationSans-Regular.ttf")),
    readFile(resolve("assets/fonts/LiberationSans-Bold.ttf")),
  ]);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const supported = new Set(regular.getCharacterSet());
  const primary = color(brand.primaryColor, "#0B2142"), accent = color(brand.accentColor, "#1F6BFF");
  const ink = rgb(...darken(primary, 0.22)), highlight = rgb(...darken(accent, 0.48));
  const soft = rgb(...mixWhite(primary, 0.94)), lineColor = rgb(...mixWhite(primary, 0.82));
  const muted = rgb(67 / 255, 83 / 255, 107 / 255), black = rgb(0, 0, 0);
  const page = pdf.addPage([WIDTH, HEIGHT]);
  const clean = (value: string) => {
    const text = value.normalize("NFC").replace(/[\u2010-\u2015]/g, "-").replace(/\s/g, " ");
    if ([...text].some(character => !supported.has(character.codePointAt(0)!))) throw new Error("billing_pdf_character_unsupported");
    return text;
  };
  const wrap = (value: string, width: number, size: number, font: PDFFont = regular) => {
    const lines: string[] = []; let line = "";
    for (const word of clean(value).trim().split(/\s+/)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { lines.push(line); line = ""; }
      for (const character of (line ? " " : "") + word) {
        if (font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  // All coordinates below are baselines measured from the top of the page.
  const draw = (text: string, x: number, top: number, size = 9.5, strong = false, fill = ink) => {
    const font = strong ? bold : regular;
    page.drawText(clean(text), { x, y: HEIGHT - top, size, font, color: fill });
  };
  const rule = (top: number) => page.drawLine({ start: { x: LEFT, y: HEIGHT - top }, end: { x: RIGHT, y: HEIGHT - top }, thickness: 0.6, color: lineColor });
  const block = (lines: string[], x: number, top: number, size: number, strong = false, fill = ink) => {
    lines.forEach((text, index) => draw(text, x, top + index * size * 1.3, size, strong, fill));
  };
  const requireLines = (lines: string[], max: number, error = "billing_invoice_layout_too_long") => {
    if (lines.length > max) throw new Error(error);
    return lines;
  };
  pdf.setTitle(`${issued ? "Rechnung" : "Rechnungsentwurf"} ${documentNumber}`);
  pdf.setAuthor(invoice.issuer.name);
  pdf.setSubject(issued ? "Rechnung mit Schweizer QR-Zahlteil" : "Entwurf - keine Zahlungsaufforderung");

  if (issued) {
    if (!invoice.payment_creditor || !invoice.qr_reference || !invoice.invoice_number) throw new Error("billing_qr_data_invalid");
    const data = invoiceQrData({ creditor: invoice.payment_creditor, recipient: invoice.recipient,
      amountCents: invoice.contribution_cents + invoice.platform_fee_cents, qrReference: invoice.qr_reference, invoiceNumber: invoice.invoice_number });
    // SIX permits Liberation Sans. Validate every original field without replacing payment data.
    for (const party of [data.creditor, data.debtor!]) for (const value of Object.values(party)) clean(String(value));
    const qrDocument = new PDFKit({ size: "A4", margin: 0 });
    qrDocument.registerFont("Liberation Sans", regularBytes);
    qrDocument.registerFont("Liberation Sans-Bold", boldBytes);
    const chunks: Buffer[] = [];
    const qrBytes = new Promise<Buffer>((resolve, reject) => {
      qrDocument.on("data", (chunk: Buffer) => chunks.push(chunk));
      qrDocument.on("end", () => resolve(Buffer.concat(chunks))); qrDocument.on("error", reject);
    });
    new SwissQRBill(data, { language: "DE", scissors: true, outlines: true, fontName: "Liberation Sans" }).attachTo(qrDocument);
    qrDocument.end();
    // Draw on the existing invoice page at 1:1; preserve separator/scissors and QR quiet zones.
    const [paymentPage] = await pdf.embedPdf(await qrBytes);
    page.drawPage(paymentPage, { x: 0, y: 0, xScale: 1, yScale: 1 });
  }

  // Inset the family header line to respect Pingen's 5 mm print margins.
  page.drawRectangle({ x: LEFT, y: HEIGHT - mm(10), width: CONTENT, height: mm(2), color: highlight });
  let nameX = LEFT;
  if (brand.logo) {
    const logo = brand.logo.contentType === "image/png" ? await pdf.embedPng(brand.logo.bytes) : await pdf.embedJpg(brand.logo.bytes);
    const scale = Math.min(mm(23) / logo.width, mm(13) / logo.height, 1);
    page.drawImage(logo, { x: LEFT, y: HEIGHT - mm(29), width: logo.width * scale, height: logo.height * scale });
    nameX += logo.width * scale + mm(4);
  }
  block(requireLines(wrap(invoice.issuer.name, mm(143) - nameX, 11, bold), 2), nameX, mm(22), 11, true);
  drawPlatformCredit(page, { right: RIGHT, y: HEIGHT - mm(22), regular, bold });
  rule(mm(35));
  draw("RECHNUNGSSTELLER", LEFT, mm(45), 7, true, muted);
  const issuerLines = [invoice.issuer.name, invoice.issuer.street, `${invoice.issuer.postalCode} ${invoice.issuer.city}`]
    .filter(value => value.trim()).flatMap(value => wrap(value, mm(88), 9.5));
  block(requireLines(issuerLines, 7), LEFT, mm(51), 9.5);
  // Right postage zone x116/y40/w89.5/h47.5 mm stays empty except the recipient.
  // Wrap names/streets, but never split the postcode/city line or shrink below postal requirements.
  const addressLines = invoicePostalAddress(invoice.recipient).flatMap((value, index) =>
    index < 2 ? wrap(value, mm(85.5), 10) : [clean(value)]);
  if (addressLines.some(value => regular.widthOfTextAtSize(value, 10) > mm(85.5))) throw new Error("billing_address_too_long");
  block(requireLines(addressLines, 5, "billing_address_too_long"), mm(118), mm(60) + 10, 10, false, black);

  draw(issued ? "Rechnung" : "Rechnungsentwurf", LEFT, mm(100), 24, true);
  page.drawRectangle({ x: LEFT, y: HEIGHT - mm(114), width: CONTENT, height: mm(9), color: issued ? soft : rgb(1, 0.96, 0.84) });
  draw(issued ? `Rechnungsnummer  ${documentNumber}` : "ENTWURF - NOCH NICHT FREIGEGEBEN", LEFT + mm(3), mm(111), 8.5, true);
  if (issued) {
    const date = invoice.issued_on!.slice(0, 10).split("-").reverse().join(".");
    const label = `Datum  ${date}`;
    draw(label, RIGHT - mm(3) - regular.widthOfTextAtSize(label, 8.5), mm(111), 8.5);
  }

  const collection = invoice.collection_notice || "Die Zahlungskonditionen und die vereinbarte Abrechnung des bestehenden Sponsorings bleiben unverändert.";
  const notice = invoice.platform_fee_cents > 0
    ? `Die Plattformgebühr finanziert die Infrastruktur von mittragen.ch. Sie wird von den Sponsoren getragen und entlastet die Klubs. ${collection}`
    : collection;
  const instructions = issued
    ? "Bitte verwenden Sie den untenstehenden QR-Zahlteil. Es gelten die vereinbarten Zahlungskonditionen."
    : "Keine Zahlungsaufforderung. Die zahlbare QR-Rechnung entsteht erst bei der Freigabe. Steuerangaben und allfällige Mehrwertsteuer werden vor der Rechnungsfreigabe geprüft.";
  let bodySize = 10;
  const measure = (size: number) => {
    const description = wrap(invoice.description, CONTENT, size + 1, bold);
    const collection = wrap(notice, CONTENT, size);
    const payment = wrap(instructions, CONTENT, size);
    const height = description.length * (size + 1) * 1.3 + 8 + 70 + collection.length * size * 1.3 + 8 + payment.length * size * 1.3;
    return { description, collection, payment, height };
  };
  let layout = measure(bodySize);
  while (mm(121) + layout.height > mm(180) && bodySize > 9) { bodySize -= 0.5; layout = measure(bodySize); }
  // Fail before issuing instead of adding a chargeable sheet, clipping data or shrinking the QR part.
  if (mm(121) + layout.height > mm(180)) throw new Error("billing_invoice_layout_too_long");
  let top = mm(121);
  block(layout.description, LEFT, top, bodySize + 1, true);
  top += layout.description.length * (bodySize + 1) * 1.3 + 8;
  const amount = (label: string, cents: number, strong = false) => {
    const size = strong ? 11 : bodySize, font = strong ? bold : regular, value = formatBillingChf(cents);
    draw(label, LEFT + mm(3), top, size, strong);
    draw(value, RIGHT - mm(3) - font.widthOfTextAtSize(value, size), top, size, strong);
  };
  amount("Sponsoringbeitrag zugunsten des Vereins", invoice.contribution_cents); top += 20;
  amount(`Plattformgebühr (${invoice.fee_basis_points / 100} %)`, invoice.platform_fee_cents); top += 20;
  page.drawRectangle({ x: LEFT, y: HEIGHT - top - 7, width: CONTENT, height: 25, color: soft });
  amount("Gesamtbetrag", invoice.contribution_cents + invoice.platform_fee_cents, true); top += 30;
  block(layout.collection, LEFT, top, bodySize, false, muted); top += layout.collection.length * bodySize * 1.3 + 8;
  block(layout.payment, LEFT, top, bodySize, false, muted);
  // Footer is above, never inside, the reserved payment area (starts 192 mm from the top).
  rule(mm(183));
  draw(documentNumber, LEFT, mm(188), 7, false, muted);
  const pageLabel = "Seite 1 von 1";
  draw(pageLabel, RIGHT - regular.widthOfTextAtSize(pageLabel, 7), mm(188), 7, false, muted);
  return pdf.save();
}

export const createInvoiceDraftPdf = createInvoicePdf;
