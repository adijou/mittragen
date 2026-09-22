import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { packageOverview } from "../../../src/sponsorPackageOverview.ts";
import { drawPlatformCredit } from "./pdf-platform-brand.ts";
import type { SponsorListExport } from "./sponsor-list-export.ts";

const WIDTH = 841.89, HEIGHT = 595.28, MARGIN = 30;
const NAVY = rgb(0.043, 0.129, 0.259), MUTED = rgb(0.31, 0.38, 0.48);
const WHITE = rgb(1, 1, 1), SOFT = rgb(0.95, 0.97, 0.99), LINE = rgb(0.83, 0.87, 0.92);
const money = (cents: number) => new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
let fontBytes: Promise<[Buffer, Buffer]> | undefined;

function safeText(text: string, font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text.replace(/\s+/g, " ").trim()).map(c => supported.has(c.codePointAt(0)!) ? c
    : Array.from(c.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")).map(letter => supported.has(letter.codePointAt(0)!) ? letter : "?").join("")).join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of safeText(text, font).split(" ")) {
    if (line && font.widthOfTextAtSize(`${line} ${word}`, size) <= width) { line += ` ${word}`; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const character of word) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function createSponsorListPdf(data: SponsorListExport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  fontBytes ??= Promise.all([readFile(resolve("assets/fonts/DejaVuSans-Latin.ttf")), readFile(resolve("assets/fonts/DejaVuSans-Latin-Bold.ttf"))]);
  const [regularBytes, boldBytes] = await fontBytes;
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  pdf.setTitle(`Sponsorenliste ${data.organizationName}`);
  pdf.setAuthor(data.organizationName); pdf.setCreator("mittragen.ch"); pdf.setCreationDate(new Date(data.generatedAt));
  const { columns, rows } = packageOverview(data.sponsors);
  const groups = Array.from({ length: Math.max(1, Math.ceil(columns.length / 9)) }, (_, i) => columns.slice(i * 9, i * 9 + 9));
  const date = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(data.generatedAt));
  const accentHex = /^#[0-9a-f]{6}$/i.test(data.brand?.accentColor ?? "") ? data.brand!.accentColor : "#1F6BFF";
  const accent = rgb(...[1, 3, 5].map(i => parseInt(accentHex.slice(i, i + 2), 16) / 255) as [number, number, number]);
  let logo: PDFImage | undefined;
  if (data.brand?.logo) {
    try { logo = data.brand.logo.contentType === "image/png" ? await pdf.embedPng(data.brand.logo.bytes) : await pdf.embedJpg(data.brand.logo.bytes); }
    catch { /* A missing logo must not prevent the data export. */ }
  }
  const draw = (page: PDFPage, text: string, x: number, y: number, size = 8.5, font = regular, color = NAVY) =>
    page.drawText(safeText(text, font), { x, y, size, font, color });
  const allTotal = rows.reduce((sum, row) => sum + row.totalCents, 0);

  groups.forEach((group, groupIndex) => {
    const totalWidth = 88;
    const sponsorWidth = group.length ? 174 : WIDTH - MARGIN * 2 - totalWidth;
    const widths = [sponsorWidth, ...group.map(() => (WIDTH - MARGIN * 2 - sponsorWidth - totalWidth) / group.length), totalWidth];
    const headers = ["Sponsor", ...group.map(c => c.name), "Total CHF/Jahr"];
    const headerLines = headers.map((text, i) => wrap(text.replace(/(Bronze|Silber|Gold)sponsor/g, "$1- sponsor"), bold, 7.5, widths[i] - 6));
    const headerHeight = Math.max(36, ...headerLines.map(lines => lines.length * 10 + 16));
    let page: PDFPage, y: number;
    const newPage = () => {
      page = pdf.addPage([WIDTH, HEIGHT]);
      page.drawRectangle({ x: 0, y: HEIGHT - 6, width: WIDTH, height: 6, color: accent });
      draw(page, "Sponsorenliste", MARGIN, HEIGHT - 39, 21, bold);
      wrap(data.organizationName, bold, 10, WIDTH - 170).forEach((line, i) => draw(page, line, MARGIN, HEIGHT - 58 - i * 12, 10, bold));
      if (logo) { const s = Math.min(72 / logo.width, 38 / logo.height); page.drawImage(logo, { x: WIDTH - MARGIN - logo.width * s, y: HEIGHT - 61, width: logo.width * s, height: logo.height * s }); }
      draw(page, `Stand ${date} · ${rows.length} Sponsoren · Jahreswerte in CHF${groups.length > 1 ? ` · Paketspalten ${groupIndex + 1}/${groups.length}` : ""}`, MARGIN, HEIGHT - 81, 8.5, regular, MUTED);
      draw(page, "Bestätigte Verträge inkl. Altbestand. 0.00 = kostenlos; - = keine Zuordnung.", MARGIN, HEIGHT - 97, 8, regular, MUTED);
      if (groups.length > 1) draw(page, "Das Total umfasst alle Pakete und wird je Spaltengruppe wiederholt.", MARGIN, HEIGHT - 111, 8, regular, MUTED);
      y = HEIGHT - (groups.length > 1 ? 124 : 112);
      page.drawRectangle({ x: MARGIN, y: y - headerHeight, width: widths.reduce((sum, w) => sum + w, 0), height: headerHeight, color: NAVY });
      let x = MARGIN;
      headerLines.forEach((lines, i) => {
        lines.forEach((line, l) => draw(page, line, x + 3, y - 14 - l * 10, 7.5, bold, WHITE));
        x += widths[i];
      });
      y -= headerHeight;
    };
    newPage();
    const tableRow = (name: string, amounts: string[], index: number, total = false) => {
      const names = wrap(name, total ? bold : regular, 8.5, widths[0] - 12);
      const height = Math.max(23, names.length * 11 + 12);
      if (y - height < 44) newPage();
      page.drawRectangle({ x: MARGIN, y: y - height, width: widths.reduce((sum, w) => sum + w, 0), height, color: total ? NAVY : index % 2 ? SOFT : WHITE });
      names.forEach((line, l) => draw(page, line, MARGIN + 6, y - 15 - l * 11, 8.5, total ? bold : regular, total ? WHITE : NAVY));
      let x = MARGIN + widths[0];
      amounts.forEach((amount, i) => {
        const font = total || i === amounts.length - 1 ? bold : regular;
        const text = safeText(amount, font);
        const size = Math.min(8.5, 8.5 * (widths[i + 1] - 10) / Math.max(1, font.widthOfTextAtSize(text, 8.5)));
        draw(page, text, x + widths[i + 1] - 6 - font.widthOfTextAtSize(text, size), y - 15, size, font, total ? WHITE : NAVY);
        x += widths[i + 1];
      });
      page.drawLine({ start: { x: MARGIN, y: y - height }, end: { x: MARGIN + widths.reduce((sum, w) => sum + w, 0), y: y - height }, thickness: 0.4, color: LINE });
      y -= height;
    };
    rows.forEach(({ sponsor, amounts, totalCents }, index) => tableRow(sponsor.legal_name,
      [...group.map(c => amounts.has(c.id) ? money(amounts.get(c.id)!) : "-"), money(totalCents)], index));
    tableRow("Gesamttotal", [...group.map(c => money(rows.reduce((sum, row) => sum + (row.amounts.get(c.id) ?? 0), 0))), money(allTotal)], rows.length, true);
  });
  pdf.getPages().forEach((page, index, pages) => {
    drawPlatformCredit(page, { x: MARGIN, y: 20, regular, bold });
    const label = `Seite ${index + 1} von ${pages.length}`;
    draw(page, label, WIDTH - MARGIN - regular.widthOfTextAtSize(label, 8), 20, 8, regular, MUTED);
  });
  return pdf.save();
}
