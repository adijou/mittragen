import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import type { OrganizationPdfBrand } from "./organization-pdf-brand.ts";

export type EventFlyerPdfData = {
  generatedAt: string;
  brand: OrganizationPdfBrand;
  organization: {
    name: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    website: string | null;
  };
  event: {
    teamName: string;
    opponent: string;
    competition: string | null;
    venue: string | null;
    startsAt: string;
    timeTbd?: boolean;
    priceCents: number;
  };
  booking: {
    sponsorName: string;
    includeFnMention: boolean;
    amountCents: number;
  } | null;
  publicUrl: string;
  termsText: string;
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
type ColorTuple = [number, number, number];

function tuple(value: string, fallback: string): ColorTuple {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as ColorTuple;
}

function luminance(color: ColorTuple) {
  const linear = color.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function mix(first: ColorTuple, second: ColorTuple, weight: number): ColorTuple {
  return first.map((channel, index) => channel * (1 - weight) + second[index] * weight) as ColorTuple;
}

function darken(color: ColorTuple) {
  let result = color;
  while (luminance(result) > 0.22) result = mix(result, [0, 0, 0], 0.18);
  return result;
}

function readableAccent(color: ColorTuple) {
  let result = color;
  while (luminance(result) > 0.48) result = mix(result, [0, 0, 0], 0.16);
  return result;
}

const color = (value: ColorTuple) => rgb(value[0], value[1], value[2]);
const safe = (value: string) => value.replace(/[\u2010-\u2015]/g, "-").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

function splitWord(word: string, font: PDFFont, size: number, width: number) {
  const parts: string[] = [];
  let current = "";
  for (const character of word) {
    const next = current + character;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      parts.push(current);
      current = character;
    } else current = next;
  }
  if (current) parts.push(current);
  return parts;
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const original of safe(text).split(/\s+/)) {
    const words = font.widthOfTextAtSize(original, size) > width ? splitWord(original, font, size, width) : [original];
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
  return lines;
}

function limitedLines(text: string, font: PDFFont, size: number, width: number, maximum: number) {
  const lines = wrap(text, font, size, width);
  if (lines.length <= maximum) return lines;
  const output = lines.slice(0, maximum);
  let last = output[maximum - 1];
  while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > width) last = last.slice(0, -1);
  output[maximum - 1] = `${last.trimEnd()}...`;
  return output;
}

function drawLines(page: ReturnType<PDFDocument["addPage"]>, lines: string[], options: {
  x: number; y: number; font: PDFFont; size: number; lineHeight: number; color: ReturnType<typeof rgb>;
}) {
  lines.forEach((line, index) => page.drawText(line, { x: options.x, y: options.y - index * options.lineHeight, font: options.font, size: options.size, color: options.color }));
}

function formatDate(value: string, timeTbd = false) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return { date: "Termin offen", time: "" };
  return {
    date: new Intl.DateTimeFormat("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(date),
    time: timeTbd ? "Anspielzeit noch offen" : `${new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" }).format(date)} Uhr`,
  };
}

function formatChf(cents: number) {
  return new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);
}

export async function createEventFlyerPdf(data: EventFlyerPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const primaryTuple = tuple(data.brand.primaryColor, "#0B2144");
  const accentTuple = tuple(data.brand.accentColor, "#1967FF");
  const PRIMARY = color(darken(primaryTuple));
  const ACCENT = color(readableAccent(accentTuple));
  const ACCENT_ON_DARK = color(luminance(accentTuple) < 0.48 ? mix(accentTuple, [1, 1, 1], 0.42) : accentTuple);
  const SOFT = color(mix(primaryTuple, [1, 1, 1], 0.92));
  const LINE = color(mix(primaryTuple, [1, 1, 1], 0.8));
  const WHITE = rgb(1, 1, 1);
  const MUTED = rgb(70 / 255, 82 / 255, 102 / 255);
  const page = pdf.addPage([A4.width, A4.height]);

  let logo: PDFImage | null = null;
  if (data.brand.logo) {
    try {
      logo = data.brand.logo.contentType === "image/png"
        ? await pdf.embedPng(data.brand.logo.bytes)
        : await pdf.embedJpg(data.brand.logo.bytes);
    } catch (error) {
      console.error("event_flyer_logo_embed_failed", { error });
    }
  }

  const generated = new Date(data.generatedAt);
  if (!Number.isNaN(generated.valueOf())) pdf.setCreationDate(generated);
  pdf.setTitle(`Matchblatt ${data.event.teamName} - ${data.event.opponent}`);
  pdf.setAuthor(data.organization.name);
  pdf.setCreator("Mittragen");
  pdf.setProducer("Mittragen");

  page.drawRectangle({ x: 0, y: A4.height - 9, width: A4.width, height: 9, color: ACCENT });
  if (logo) {
    const natural = logo.scale(1);
    const scale = Math.min(98 / natural.width, 48 / natural.height, 1);
    page.drawImage(logo, { x: MARGIN, y: 754, width: natural.width * scale, height: natural.height * scale });
  }
  const orgLines = limitedLines(data.organization.name, bold, 11, 250, 2);
  drawLines(page, orgLines, { x: A4.width - MARGIN - 250, y: 790, font: bold, size: 11, lineHeight: 14, color: PRIMARY });
  const contact = [data.organization.website, data.organization.contactEmail, data.organization.contactPhone].filter(Boolean).join(" · ");
  drawLines(page, limitedLines(contact, regular, 7.5, 250, 2), { x: A4.width - MARGIN - 250, y: 756, font: regular, size: 7.5, lineHeight: 10, color: MUTED });

  page.drawText("MATCHBALL-SPONSORING", { x: MARGIN, y: 713, font: bold, size: 9, color: ACCENT });
  page.drawText("HEIMSPIEL", { x: MARGIN, y: 672, font: bold, size: 31, color: PRIMARY });

  page.drawRectangle({ x: MARGIN, y: 487, width: A4.width - MARGIN * 2, height: 150, color: PRIMARY });
  drawLines(page, limitedLines(data.event.teamName, bold, 21, 405, 2), { x: MARGIN + 24, y: 598, font: bold, size: 21, lineHeight: 25, color: WHITE });
  page.drawText("gegen", { x: MARGIN + 24, y: 552, font: regular, size: 11, color: ACCENT_ON_DARK });
  drawLines(page, limitedLines(data.event.opponent, bold, 23, 405, 2), { x: MARGIN + 24, y: 521, font: bold, size: 23, lineHeight: 27, color: WHITE });

  const when = formatDate(data.event.startsAt, data.event.timeTbd);
  const cardY = 390;
  const gap = 12;
  const cardWidth = (A4.width - MARGIN * 2 - gap) / 2;
  const drawFact = (x: number, label: string, value: string, detail: string) => {
    page.drawRectangle({ x, y: cardY, width: cardWidth, height: 72, color: SOFT, borderColor: LINE, borderWidth: 0.6 });
    page.drawText(label, { x: x + 14, y: cardY + 51, font: bold, size: 7.2, color: ACCENT });
    drawLines(page, limitedLines(value, bold, 11, cardWidth - 28, 2), { x: x + 14, y: cardY + 33, font: bold, size: 11, lineHeight: 13, color: PRIMARY });
    if (detail) page.drawText(safe(detail), { x: x + 14, y: cardY + 10, font: regular, size: 7.8, color: MUTED });
  };
  drawFact(MARGIN, "ANPFIFF", when.date, when.time);
  drawFact(MARGIN + cardWidth + gap, "SPIELORT", data.event.venue || "Heimspiel", data.event.competition || "");

  if (data.booking) {
    page.drawText("DIESER MATCHBALL WIRD GESPENDET VON", { x: MARGIN, y: 346, font: bold, size: 8.2, color: ACCENT });
    drawLines(page, limitedLines(data.booking.sponsorName, bold, 25, A4.width - MARGIN * 2, 2), { x: MARGIN, y: 310, font: bold, size: 25, lineHeight: 29, color: PRIMARY });
    page.drawText("Herzlichen Dank für die Unterstützung unseres regionalen Fussballs.", { x: MARGIN, y: 245, font: regular, size: 10.5, color: MUTED });
    const note = `${formatChf(data.booking.amountCents)} Matchball-Sponsoring${data.booking.includeFnMention ? " inklusive Verdankung in den Freiburger Nachrichten" : ""}`;
    drawLines(page, limitedLines(note, regular, 8, A4.width - MARGIN * 2, 2), { x: MARGIN, y: 224, font: regular, size: 8, lineHeight: 11, color: MUTED });
  } else {
    page.drawText("MATCHBALLSPONSOR GESUCHT", { x: MARGIN, y: 346, font: bold, size: 8.2, color: ACCENT });
    page.drawText(`Unterstützen Sie dieses Spiel mit ${formatChf(data.event.priceCents)}.`, { x: MARGIN, y: 310, font: bold, size: 20, color: PRIMARY });
    page.drawText("Direkt anmelden unter:", { x: MARGIN, y: 276, font: regular, size: 9.2, color: MUTED });
    drawLines(page, limitedLines(data.publicUrl, bold, 10, A4.width - MARGIN * 2, 2), { x: MARGIN, y: 255, font: bold, size: 10, lineHeight: 13, color: ACCENT });
  }

  page.drawLine({ start: { x: MARGIN, y: 185 }, end: { x: A4.width - MARGIN, y: 185 }, color: LINE, thickness: 0.8 });
  page.drawText("GEMEINSAM FÜR DEN SPIELTAG", { x: MARGIN, y: 160, font: bold, size: 8, color: ACCENT });
  drawLines(page, limitedLines(data.termsText, regular, 8.4, A4.width - MARGIN * 2, 4), { x: MARGIN, y: 139, font: regular, size: 8.4, lineHeight: 11.5, color: MUTED });

  page.drawText("erstellt mit Mittragen", { x: MARGIN, y: 39, font: regular, size: 7, color: MUTED });
  const pageLabel = safe(data.organization.contactName || data.organization.name);
  page.drawText(pageLabel, { x: A4.width - MARGIN - regular.widthOfTextAtSize(pageLabel, 7), y: 39, font: regular, size: 7, color: MUTED });

  return pdf.save();
}
