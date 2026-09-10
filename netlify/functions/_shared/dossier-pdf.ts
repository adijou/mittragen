import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type DossierRight = {
  name: string;
  description: string | null;
  quantity: number;
  scheduleText: string | null;
  channel: string | null;
  location: string | null;
};

export type DossierPdfData = {
  organizationName: string;
  generatedAt: string;
  profile: {
    headline: string;
    seasonLabel: string | null;
    introduction: string;
    clubPortrait: string;
    sponsorshipImpact: string;
    audience: string | null;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    website: string | null;
  };
  packages: Array<{
    name: string;
    description: string | null;
    priceCents: number;
    durationMonths: number;
    paymentPlan: string;
    rights: DossierRight[];
  }>;
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 52;
const NAVY = rgb(11 / 255, 33 / 255, 68 / 255);
const BLUE = rgb(25 / 255, 103 / 255, 255 / 255);
const GOLD = rgb(233 / 255, 180 / 255, 76 / 255);
const LIGHT_BLUE = rgb(237 / 255, 244 / 255, 255 / 255);
const LIGHT_NEUTRAL = rgb(247 / 255, 249 / 255, 252 / 255);
const LINE = rgb(220 / 255, 227 / 255, 236 / 255);
const MUTED = rgb(67 / 255, 83 / 255, 107 / 255);
const WHITE = rgb(1, 1, 1);

const paymentLabels: Record<string, string> = {
  annual: "jährlich",
  semiannual: "halbjährlich",
  quarterly: "quartalsweise",
  custom: "individuell",
};

function safeText(value: string) {
  return value
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ");
}

function splitLongWord(word: string, font: PDFFont, size: number, width: number) {
  const fragments: string[] = [];
  let fragment = "";
  for (const character of word) {
    const next = fragment + character;
    if (fragment && font.widthOfTextAtSize(next, size) > width) {
      fragments.push(fragment);
      fragment = character;
    } else fragment = next;
  }
  if (fragment) fragments.push(fragment);
  return fragments;
}

function linesFor(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of safeText(value).split(/\n/)) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const originalWord of paragraph.trim().split(/\s+/)) {
      const words = font.widthOfTextAtSize(originalWord, size) > width
        ? splitLongWord(originalWord, font, size, width)
        : [originalWord];
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          if (line) lines.push(line);
          line = word;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function formatChf(cents: number) {
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fitLine(value: string, font: PDFFont, size: number, width: number) {
  let result = safeText(value);
  if (font.widthOfTextAtSize(result, size) <= width) return result;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) result = result.slice(0, -1);
  return `${result.trimEnd()}...`;
}

export async function createDossierPdf(data: DossierPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = new Date(data.generatedAt);
  if (!Number.isNaN(generatedAt.valueOf())) {
    pdf.setCreationDate(generatedAt);
    pdf.setModificationDate(generatedAt);
  }
  pdf.setTitle(`Sponsoringdossier ${data.organizationName}`);
  pdf.setAuthor(data.organizationName);
  pdf.setCreator("Mittragen");
  pdf.setProducer("Mittragen");

  const pages: PDFPage[] = [];
  const cover = pdf.addPage([A4.width, A4.height]);
  pages.push(cover);
  cover.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: NAVY });
  cover.drawRectangle({ x: 0, y: A4.height - 10, width: A4.width, height: 10, color: BLUE });
  cover.drawRectangle({ x: MARGIN, y: A4.height - 156, width: 56, height: 5, color: GOLD });
  cover.drawText("SPONSORINGDOSSIER", { x: MARGIN, y: A4.height - 96, size: 10, font: bold, color: GOLD });
  cover.drawText(fitLine(data.organizationName, bold, 15, A4.width - MARGIN * 2), { x: MARGIN, y: A4.height - 126, size: 15, font: bold, color: WHITE });
  const headlineLines = linesFor(data.profile.headline, bold, 31, A4.width - MARGIN * 2).slice(0, 4);
  let coverY = A4.height - 230;
  for (const line of headlineLines) {
    cover.drawText(line, { x: MARGIN, y: coverY, size: 31, font: bold, color: WHITE });
    coverY -= 39;
  }
  coverY -= 18;
  const introLines = linesFor(data.profile.introduction, regular, 12.5, A4.width - MARGIN * 2).slice(0, 9);
  for (const line of introLines) {
    if (line) cover.drawText(line, { x: MARGIN, y: coverY, size: 12.5, font: regular, color: LIGHT_BLUE });
    coverY -= 18;
  }
  if (data.profile.seasonLabel) cover.drawText(fitLine(data.profile.seasonLabel, bold, 10, 300), { x: MARGIN, y: 82, size: 10, font: bold, color: GOLD });
  cover.drawText("erstellt mit Mittragen", { x: MARGIN, y: 56, size: 8, font: regular, color: LIGHT_BLUE });

  let page: PDFPage = cover;
  let y = 0;
  const header = (target: PDFPage) => {
    target.drawRectangle({ x: 0, y: A4.height - 7, width: A4.width, height: 7, color: BLUE });
    target.drawText(fitLine(data.organizationName, bold, 10.5, 330), { x: MARGIN, y: A4.height - 45, size: 10.5, font: bold, color: NAVY });
    target.drawText("Sponsoringdossier", { x: A4.width - MARGIN - regular.widthOfTextAtSize("Sponsoringdossier", 8), y: A4.height - 44, size: 8, font: regular, color: MUTED });
    target.drawLine({ start: { x: MARGIN, y: A4.height - 66 }, end: { x: A4.width - MARGIN, y: A4.height - 66 }, thickness: 0.7, color: LINE });
  };
  const addPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    header(page);
    y = A4.height - 102;
  };
  const ensure = (height: number) => { if (y - height < 64) addPage(); };
  const paragraph = (value: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; width?: number; indent?: number; after?: number; lineHeight?: number } = {}) => {
    const size = options.size ?? 10;
    const font = options.font ?? regular;
    const indent = options.indent ?? 0;
    const width = options.width ?? A4.width - MARGIN * 2 - indent;
    const lineHeight = options.lineHeight ?? size * 1.45;
    const lines = linesFor(value, font, size, width);
    ensure(lines.length * lineHeight + (options.after ?? 0));
    for (const line of lines) {
      if (line) page.drawText(line, { x: MARGIN + indent, y, size, font, color: options.color ?? NAVY });
      y -= lineHeight;
    }
    y -= options.after ?? 0;
  };
  const sectionTitle = (eyebrow: string, title: string) => {
    ensure(66);
    page.drawText(eyebrow.toUpperCase(), { x: MARGIN, y, size: 7.5, font: bold, color: BLUE });
    y -= 25;
    paragraph(title, { size: 21, font: bold, after: 16, lineHeight: 25 });
  };

  addPage();
  sectionTitle("Der Klub", "Wofür wir stehen");
  paragraph(data.profile.clubPortrait, { size: 10.5, after: 22 });
  page.drawRectangle({ x: MARGIN, y: y - 8, width: A4.width - MARGIN * 2, height: 2, color: GOLD });
  y -= 35;
  sectionTitle("Die Partnerschaft", "Was Sponsoring bewirkt");
  paragraph(data.profile.sponsorshipImpact, { size: 10.5, after: 22 });
  if (data.profile.audience) {
    ensure(90);
    page.drawRectangle({ x: MARGIN, y: y - 66, width: A4.width - MARGIN * 2, height: 76, color: LIGHT_BLUE, borderColor: LINE, borderWidth: 0.5 });
    page.drawText("REICHWEITE UND UMFELD", { x: MARGIN + 14, y: y - 10, size: 7.5, font: bold, color: BLUE });
    const audienceLines = linesFor(data.profile.audience, regular, 9.2, A4.width - MARGIN * 2 - 28).slice(0, 4);
    audienceLines.forEach((line, index) => page.drawText(line, { x: MARGIN + 14, y: y - 28 - index * 12, size: 9.2, font: regular, color: NAVY }));
    y -= 94;
  }

  for (let packageIndex = 0; packageIndex < data.packages.length; packageIndex += 1) {
    const item = data.packages[packageIndex];
    addPage();
    page.drawText(`PAKET ${packageIndex + 1} VON ${data.packages.length}`, { x: MARGIN, y, size: 7.5, font: bold, color: BLUE });
    y -= 32;
    paragraph(item.name, { size: 25, font: bold, after: 7, lineHeight: 30 });
    page.drawText(formatChf(item.priceCents), { x: MARGIN, y, size: 15, font: bold, color: BLUE });
    const terms = `${item.durationMonths} Monate | ${paymentLabels[item.paymentPlan] ?? "individuell"}`;
    page.drawText(terms, { x: A4.width - MARGIN - regular.widthOfTextAtSize(terms, 8.5), y: y + 2, size: 8.5, font: regular, color: MUTED });
    y -= 35;
    if (item.description) paragraph(item.description, { size: 10, color: MUTED, after: 22 });
    paragraph("Enthaltene Leistungen", { size: 12, font: bold, after: 10 });
    if (!item.rights.length) paragraph("Die konkreten Leistungen werden gemeinsam festgelegt.", { color: MUTED });
    for (const right of item.rights) {
      const detail = [right.quantity > 1 ? `${right.quantity}x` : null, right.channel, right.location, right.scheduleText].filter(Boolean).join(" | ");
      const nameLines = linesFor(right.name, bold, 9.8, A4.width - MARGIN * 2 - 20);
      const detailLines = detail ? linesFor(detail, regular, 8.2, A4.width - MARGIN * 2 - 20) : [];
      const descriptionLines = right.description ? linesFor(right.description, regular, 8.5, A4.width - MARGIN * 2 - 20) : [];
      ensure(nameLines.length * 13 + detailLines.length * 11 + descriptionLines.length * 12 + 20);
      page.drawCircle({ x: MARGIN + 4, y: y + 3, size: 2.5, color: GOLD });
      paragraph(right.name, { font: bold, size: 9.8, indent: 17, after: detail || right.description ? 2 : 8, lineHeight: 13 });
      if (detail) paragraph(detail, { size: 8.2, color: BLUE, indent: 17, after: right.description ? 2 : 8, lineHeight: 11 });
      if (right.description) paragraph(right.description, { size: 8.5, color: MUTED, indent: 17, after: 8, lineHeight: 12 });
    }
  }

  ensure(168);
  y -= 16;
  page.drawRectangle({ x: MARGIN, y: y - 124, width: A4.width - MARGIN * 2, height: 136, color: NAVY });
  page.drawText("INTERESSE AN EINER PARTNERSCHAFT?", { x: MARGIN + 18, y: y - 18, size: 8, font: bold, color: GOLD });
  page.drawText(fitLine(data.profile.contactName, bold, 15, A4.width - MARGIN * 2 - 36), { x: MARGIN + 18, y: y - 47, size: 15, font: bold, color: WHITE });
  page.drawText(fitLine(data.profile.contactEmail, regular, 9.5, A4.width - MARGIN * 2 - 36), { x: MARGIN + 18, y: y - 70, size: 9.5, font: regular, color: LIGHT_BLUE });
  if (data.profile.contactPhone) page.drawText(fitLine(data.profile.contactPhone, regular, 9.5, 210), { x: MARGIN + 18, y: y - 89, size: 9.5, font: regular, color: LIGHT_BLUE });
  if (data.profile.website) page.drawText(fitLine(data.profile.website, regular, 9.5, 280), { x: MARGIN + 18, y: y - 108, size: 9.5, font: regular, color: LIGHT_BLUE });

  pages.forEach((target, index) => {
    if (index === 0) return;
    target.drawLine({ start: { x: MARGIN, y: 40 }, end: { x: A4.width - MARGIN, y: 40 }, thickness: 0.6, color: LINE });
    target.drawText("erstellt mit Mittragen", { x: MARGIN, y: 24, size: 7, font: regular, color: MUTED });
    const pageNumber = `Seite ${index + 1} von ${pages.length}`;
    target.drawText(pageNumber, { x: A4.width - MARGIN - regular.widthOfTextAtSize(pageNumber, 7), y: 24, size: 7, font: regular, color: MUTED });
  });

  return pdf.save({ useObjectStreams: false });
}
