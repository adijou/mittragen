import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { OrganizationPdfBrand } from "./organization-pdf-brand.ts";

export type EventFlyerPdfData = {
  generatedAt: string;
  brand: OrganizationPdfBrand;
  organization: { name: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; website: string | null };
  event: {
    teamName: string;
    opponent: string;
    competition: string | null;
    venue: string | null;
    startsAt: string;
    timeTbd?: boolean;
    homeCoach?: string | null;
    opponentCoach?: string | null;
    refereeName?: string | null;
    matchInfoUrl?: string | null;
    speakerNote?: string | null;
    priceCents?: number;
  };
  matchballSponsors?: Array<{ sponsorName: string; source: "direct" | "package"; detail: string }>;
  partners?: Array<{ sponsorName: string; packageName: string }>;
  booking?: { sponsorName: string; includeFnMention: boolean; amountCents: number } | null;
  termsText?: string;
  publicUrl: string;
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 42;
type ColorTuple = [number, number, number];

function tuple(value: string, fallback: string): ColorTuple {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as ColorTuple;
}

function luminance(value: ColorTuple) {
  const linear = value.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function mix(first: ColorTuple, second: ColorTuple, weight: number): ColorTuple {
  return first.map((channel, index) => channel * (1 - weight) + second[index] * weight) as ColorTuple;
}

function darken(value: ColorTuple) {
  let result = value;
  while (luminance(result) > 0.22) result = mix(result, [0, 0, 0], 0.18);
  return result;
}

function readableAccent(value: ColorTuple) {
  let result = value;
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
    if (current && font.widthOfTextAtSize(next, size) > width) { parts.push(current); current = character; }
    else current = next;
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
      else { if (line) lines.push(line); line = word; }
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

function drawLines(page: PDFPage, lines: string[], options: { x: number; y: number; font: PDFFont; size: number; lineHeight: number; color: ReturnType<typeof rgb> }) {
  lines.forEach((line, index) => page.drawText(line, { x: options.x, y: options.y - index * options.lineHeight, font: options.font, size: options.size, color: options.color }));
}

function matchTime(value: string, timeTbd = false) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return { weekday: "Termin offen", date: "", time: "" };
  return {
    weekday: new Intl.DateTimeFormat("de-CH", { weekday: "long", timeZone: "Europe/Zurich" }).format(date),
    date: new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(date),
    time: timeTbd ? "Anspielzeit offen" : `${new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" }).format(date)} Uhr`,
  };
}

function shortUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch { return value; }
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
  const SOFT = color(mix(primaryTuple, [1, 1, 1], 0.94));
  const LINE = color(mix(primaryTuple, [1, 1, 1], 0.82));
  const WHITE = rgb(1, 1, 1);
  const MUTED = rgb(69 / 255, 80 / 255, 99 / 255);
  const page = pdf.addPage([A4.width, A4.height]);

  let logo: PDFImage | null = null;
  if (data.brand.logo) {
    try { logo = data.brand.logo.contentType === "image/png" ? await pdf.embedPng(data.brand.logo.bytes) : await pdf.embedJpg(data.brand.logo.bytes); }
    catch (error) { console.error("event_flyer_logo_embed_failed", { error }); }
  }

  const generated = new Date(data.generatedAt);
  if (!Number.isNaN(generated.valueOf())) pdf.setCreationDate(generated);
  const legacyInput = data.matchballSponsors === undefined;
  const matchballSponsors = data.matchballSponsors ?? (data.booking ? [{ sponsorName: data.booking.sponsorName, source: "direct" as const, detail: "" }] : []);
  const partners = data.partners ?? [];
  pdf.setTitle(`${legacyInput ? "Matchblatt" : "Matchinfo"} ${data.event.teamName} - ${data.event.opponent}`);
  pdf.setAuthor(data.organization.name);
  pdf.setCreator("Mittragen");
  pdf.setProducer("Mittragen");

  page.drawRectangle({ x: 0, y: A4.height - 9, width: A4.width, height: 9, color: ACCENT });
  if (logo) {
    const natural = logo.scale(1);
    const scale = Math.min(100 / natural.width, 46 / natural.height, 1);
    page.drawImage(logo, { x: MARGIN, y: 765, width: natural.width * scale, height: natural.height * scale });
  }
  drawLines(page, limitedLines(data.organization.name, bold, 11, 250, 2), { x: A4.width - MARGIN - 250, y: 796, font: bold, size: 11, lineHeight: 14, color: PRIMARY });
  const contact = [data.organization.website, data.organization.contactEmail, data.organization.contactPhone].filter(Boolean).join(" · ");
  drawLines(page, limitedLines(contact, regular, 7.2, 250, 2), { x: A4.width - MARGIN - 250, y: 764, font: regular, size: 7.2, lineHeight: 9.5, color: MUTED });

  const when = matchTime(data.event.startsAt, data.event.timeTbd);
  page.drawText("MATCHINFO", { x: MARGIN, y: 721, font: bold, size: 31, color: PRIMARY });
  page.drawText(safe(data.event.competition || "Heimspiel"), { x: MARGIN, y: 701, font: bold, size: 8.5, color: ACCENT });
  page.drawText(`${safe(when.weekday)}, ${safe(when.date)} · ${safe(when.time)}`, { x: MARGIN, y: 684, font: regular, size: 9.5, color: MUTED });

  page.drawRectangle({ x: MARGIN, y: 558, width: A4.width - MARGIN * 2, height: 100, color: PRIMARY });
  drawLines(page, limitedLines(data.event.teamName, bold, 19, 430, 1), { x: MARGIN + 22, y: 626, font: bold, size: 19, lineHeight: 22, color: WHITE });
  page.drawText("gegen", { x: MARGIN + 22, y: 602, font: regular, size: 9, color: ACCENT_ON_DARK });
  drawLines(page, limitedLines(data.event.opponent, bold, 21, 430, 1), { x: MARGIN + 22, y: 577, font: bold, size: 21, lineHeight: 24, color: WHITE });

  const facts = [
    ["ANPFIFF", when.time || "offen"],
    ["SPIELORT", data.event.venue || "Heimspiel"],
    ["SCHIEDSRICHTER", data.event.refereeName || "noch offen"],
  ];
  const factGap = 9;
  const factWidth = (A4.width - MARGIN * 2 - factGap * 2) / 3;
  facts.forEach(([label, value], index) => {
    const x = MARGIN + index * (factWidth + factGap);
    page.drawRectangle({ x, y: 500, width: factWidth, height: 43, color: SOFT, borderColor: LINE, borderWidth: 0.5 });
    page.drawText(label, { x: x + 10, y: 527, font: bold, size: 6.5, color: ACCENT });
    drawLines(page, limitedLines(value, bold, 8.5, factWidth - 20, 2), { x: x + 10, y: 513, font: bold, size: 8.5, lineHeight: 10, color: PRIMARY });
  });

  page.drawText("TEAMS & SPIELLEITUNG", { x: MARGIN, y: 475, font: bold, size: 7.2, color: ACCENT });
  const teamWidth = (A4.width - MARGIN * 2 - 12) / 2;
  const drawTeam = (x: number, label: string, coach: string | null | undefined) => {
    page.drawText(safe(label), { x, y: 456, font: bold, size: 8.2, color: PRIMARY });
    page.drawText(`Trainer: ${safe(coach || "noch offen")}`, { x, y: 441, font: regular, size: 8.2, color: MUTED });
  };
  drawTeam(MARGIN, data.event.teamName, data.event.homeCoach);
  drawTeam(MARGIN + teamWidth + 12, data.event.opponent, data.event.opponentCoach);
  const infoText = data.event.matchInfoUrl ? `Offizielle Aufstellungen: ${shortUrl(data.event.matchInfoUrl)}` : "Offizielle Aufstellungen: Matchcenter / football.ch";
  drawLines(page, limitedLines(infoText, regular, 7.4, A4.width - MARGIN * 2, 2), { x: MARGIN, y: 420, font: regular, size: 7.4, lineHeight: 9.5, color: ACCENT });
  if (data.event.speakerNote) drawLines(page, limitedLines(`Speaker-Hinweis: ${data.event.speakerNote}`, regular, 7.4, A4.width - MARGIN * 2, 2), { x: MARGIN, y: 397, font: regular, size: 7.4, lineHeight: 9.5, color: MUTED });

  const sponsorTop = data.event.speakerNote ? 365 : 382;
  page.drawLine({ start: { x: MARGIN, y: sponsorTop + 13 }, end: { x: A4.width - MARGIN, y: sponsorTop + 13 }, color: LINE, thickness: 0.7 });
  page.drawText("MATCHBALLSPONSOREN", { x: MARGIN, y: sponsorTop, font: bold, size: 8, color: ACCENT });
  const sponsorNames = matchballSponsors.map((item) => safe(item.sponsorName));
  if (sponsorNames.length) {
    const columns = sponsorNames.length > 10 ? 3 : 2;
    const rows = Math.min(Math.ceil(sponsorNames.length / columns), 8);
    const width = (A4.width - MARGIN * 2 - (columns - 1) * 14) / columns;
    sponsorNames.slice(0, rows * columns).forEach((name, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      drawLines(page, limitedLines(name, bold, 8.5, width, 1), { x: MARGIN + column * (width + 14), y: sponsorTop - 22 - row * 16, font: bold, size: 8.5, lineHeight: 10, color: PRIMARY });
    });
  } else {
    page.drawText("Für dieses Spiel sind noch keine Matchballsponsoren eingetragen.", { x: MARGIN, y: sponsorTop - 23, font: regular, size: 8.3, color: MUTED });
    drawLines(page, limitedLines(`Anmeldung: ${shortUrl(data.publicUrl)}`, bold, 7.6, A4.width - MARGIN * 2, 2), { x: MARGIN, y: sponsorTop - 40, font: bold, size: 7.6, lineHeight: 9.5, color: ACCENT });
  }

  const partnerTop = 198;
  page.drawLine({ start: { x: MARGIN, y: partnerTop + 14 }, end: { x: A4.width - MARGIN, y: partnerTop + 14 }, color: LINE, thickness: 0.7 });
  page.drawText("VEREINSPARTNER", { x: MARGIN, y: partnerTop, font: bold, size: 8, color: ACCENT });
  const groups = ["Gold", "Silber"].map((level) => ({
    level,
    names: partners.filter((item) => item.packageName.toLocaleLowerCase("de-CH").includes(level.toLocaleLowerCase("de-CH"))).map((item) => safe(item.sponsorName)).slice(0, 7),
  }));
  groups.forEach((group, index) => {
    const x = MARGIN + index * (teamWidth + 12);
    page.drawText(`${group.level.toUpperCase()}SPONSOREN`, { x, y: partnerTop - 21, font: bold, size: 7, color: PRIMARY });
    if (!group.names.length) page.drawText("-", { x, y: partnerTop - 38, font: regular, size: 8, color: MUTED });
    group.names.forEach((name, row) => drawLines(page, limitedLines(name, regular, 7.5, teamWidth, 1), { x, y: partnerTop - 38 - row * 12, font: regular, size: 7.5, lineHeight: 9, color: MUTED }));
  });

  page.drawRectangle({ x: 0, y: 0, width: A4.width, height: 52, color: PRIMARY });
  page.drawText("Wir wünschen ein faires und spannendes Spiel.", { x: MARGIN, y: 29, font: bold, size: 9, color: WHITE });
  const footer = safe(data.organization.contactName || data.organization.name);
  page.drawText(footer, { x: A4.width - MARGIN - regular.widthOfTextAtSize(footer, 7), y: 29, font: regular, size: 7, color: ACCENT_ON_DARK });

  return pdf.save();
}
