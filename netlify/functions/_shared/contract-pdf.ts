import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { OrganizationPdfBrand } from "./organization-pdf-brand.ts";

type ContractRight = {
  name: string;
  description: string | null;
  quantity: number;
  scheduleText: string | null;
  channel: string | null;
  location: string | null;
};

export type ContractPdfData = {
  contractNumber: string;
  versionNumber: number;
  title: string;
  status: "draft" | "released" | "confirmed" | "void";
  createdAt: string;
  releasedAt: string | null;
  confirmedAt: string | null;
  confirmedEmail: string | null;
  snapshotHash: string | null;
  brand: OrganizationPdfBrand;
  organization: {
    legalName: string;
    street: string;
    postalCode: string;
    city: string;
    country: string;
    representativeName: string;
    representativeTitle: string;
    contactEmail: string;
  };
  sponsor: {
    legalName: string;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    contactName: string | null;
    contactEmail: string | null;
  };
  package: {
    name: string;
    description: string | null;
    priceCents: number;
    durationMonths: number;
    paymentPlan: string;
    paymentTerms: string | null;
    validFrom: string | null;
    validUntil: string | null;
    rights: ContractRight[];
  };
  terms: {
    renewalMode: "manual" | "annual_auto";
    noticeMonths: number | null;
    placeOfJurisdiction: string | null;
  };
  specialAgreements: string;
  signingAuthorityName?: string | null;
  signingAuthorityRole?: string | null;
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 54;
const CONTENT_WIDTH = A4.width - MARGIN * 2;
const CONTENT_BOTTOM = 62;
const LIGHT_NEUTRAL = rgb(247 / 255, 249 / 255, 252 / 255);
const MUTED = rgb(67 / 255, 83 / 255, 107 / 255);

type ColorTuple = [number, number, number];

function colorTuple(value: string, fallback: string): ColorTuple {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return [1, 3, 5].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255) as ColorTuple;
}

function luminance(color: ColorTuple) {
  const linear = color.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function mix(first: ColorTuple, second: ColorTuple, weight: number): ColorTuple {
  return first.map((channel, index) => channel * (1 - weight) + second[index] * weight) as ColorTuple;
}

function darkSurface(color: ColorTuple) {
  let result = color;
  while (luminance(result) > 0.22) result = mix(result, [0, 0, 0], 0.18);
  return result;
}

function accentOnWhite(color: ColorTuple) {
  let result = color;
  while (luminance(result) > 0.48) result = mix(result, [0, 0, 0], 0.16);
  return result;
}

function accentOnDark(color: ColorTuple) {
  let result = color;
  while (luminance(result) < 0.5) result = mix(result, [1, 1, 1], 0.18);
  return result;
}

const pdfColor = (value: ColorTuple) => rgb(value[0], value[1], value[2]);

const paymentLabels: Record<string, string> = {
  annual: "jährlich",
  semiannual: "halbjährlich",
  quarterly: "quartalsweise",
  custom: "individuell",
};

function swissDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.valueOf()) ? "-" : new Intl.DateTimeFormat("de-CH", { dateStyle: "long", timeZone: "Europe/Zurich" }).format(parsed);
}

function formatChf(cents: number) {
  return new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

function safeText(value: string) {
  return value.replace(/[\u2010-\u2015]/g, "-").replace(/\u00a0/g, " ").replace(/\t/g, " ");
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

function linesFor(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of safeText(text).split(/\n/)) {
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

function fitLine(text: string, font: PDFFont, size: number, width: number) {
  const normalized = safeText(text);
  if (font.widthOfTextAtSize(normalized, size) <= width) return normalized;
  let shortened = normalized;
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}...`, size) > width) shortened = shortened.slice(0, -1);
  return `${shortened.trimEnd()}...`;
}

function statusLabel(status: ContractPdfData["status"]) {
  if (status === "draft") return "Entwurf - noch nicht freigegeben";
  if (status === "released") return "Zur Bestätigung freigegeben";
  if (status === "confirmed") return "Elektronisch bestätigt";
  return "Aufgehoben";
}

export async function createContractPdf(data: ContractPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const primary = colorTuple(data.brand.primaryColor, "#0B2144");
  const accent = colorTuple(data.brand.accentColor, "#1967FF");
  const INK = pdfColor(darkSurface(primary));
  const PRIMARY = pdfColor(accentOnWhite(primary));
  const ACCENT = pdfColor(accentOnWhite(accent));
  const ACCENT_ON_DARK = pdfColor(accentOnDark(accent));
  const SOFT_PRIMARY = pdfColor(mix(primary, [1, 1, 1], 0.9));
  const SOFT_ACCENT = pdfColor(mix(accent, [1, 1, 1], 0.91));
  const LINE = pdfColor(mix(primary, [1, 1, 1], 0.82));

  let logo: PDFImage | undefined;
  if (data.brand.logo) {
    try {
      logo = data.brand.logo.contentType === "image/png"
        ? await pdf.embedPng(data.brand.logo.bytes)
        : await pdf.embedJpg(data.brand.logo.bytes);
    } catch (error) {
      console.error("contract_pdf_logo_embed_failed", { contractNumber: data.contractNumber, error });
    }
  }

  const created = new Date(data.createdAt);
  if (!Number.isNaN(created.valueOf())) {
    pdf.setCreationDate(created);
    pdf.setModificationDate(new Date(data.confirmedAt ?? data.releasedAt ?? data.createdAt));
  }
  pdf.setTitle(`${data.title} ${data.contractNumber}`);
  pdf.setAuthor(data.organization.legalName);
  pdf.setCreator("Mittragen");
  pdf.setProducer("Mittragen");

  const pages: PDFPage[] = [];
  let page = pdf.addPage([A4.width, A4.height]);
  pages.push(page);
  let y = A4.height - 99;

  const header = (target: PDFPage) => {
    target.drawRectangle({ x: 0, y: A4.height - 7, width: A4.width, height: 7, color: ACCENT });
    let nameX = MARGIN;
    let nameWidth = 300;
    if (logo) {
      const natural = logo.scale(1);
      const scale = Math.min(64 / natural.width, 34 / natural.height, 1);
      const width = natural.width * scale;
      const height = natural.height * scale;
      target.drawImage(logo, { x: MARGIN, y: A4.height - 57 + (34 - height) / 2, width, height });
      nameX += width + 13;
      nameWidth -= width + 13;
    }
    target.drawText(fitLine(data.organization.legalName, bold, 11, Math.max(120, nameWidth)), {
      x: nameX, y: A4.height - 45, size: 11, font: bold, color: INK,
    });
    const platform = "erstellt mit Mittragen";
    target.drawText(platform, { x: A4.width - MARGIN - regular.widthOfTextAtSize(platform, 7.5), y: A4.height - 44, size: 7.5, font: regular, color: MUTED });
    target.drawLine({ start: { x: MARGIN, y: A4.height - 67 }, end: { x: A4.width - MARGIN, y: A4.height - 67 }, thickness: 0.7, color: ACCENT });
  };

  const addPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    header(page);
    y = A4.height - 91;
  };

  const ensure = (height: number) => { if (y - height < CONTENT_BOTTOM) addPage(); };
  const drawLines = (lines: string[], options: { x?: number; width?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; lineHeight?: number; after?: number } = {}) => {
    const x = options.x ?? MARGIN;
    const size = options.size ?? 9.2;
    const font = options.font ?? regular;
    const lineHeight = options.lineHeight ?? size * 1.42;
    if (lines.length) ensure(Math.min(lines.length, 3) * lineHeight + (options.after ?? 0));
    for (const line of lines) {
      ensure(lineHeight);
      if (line) page.drawText(line, { x, y, size, font, color: options.color ?? INK });
      y -= lineHeight;
    }
    y -= options.after ?? 0;
  };
  const drawText = (text: string, options: { x?: number; width?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; lineHeight?: number; after?: number } = {}) => {
    const x = options.x ?? MARGIN;
    const width = options.width ?? A4.width - MARGIN - x;
    const size = options.size ?? 9.2;
    const font = options.font ?? regular;
    drawLines(linesFor(text, font, size, width), { ...options, x, width, size, font });
  };
  const section = (number: string, title: string) => {
    ensure(82);
    y -= 6;
    const label = number ? `${number}  ${title}` : title;
    page.drawText(safeText(label.toUpperCase()), { x: MARGIN, y, size: 10.2, font: bold, color: PRIMARY });
    page.drawLine({ start: { x: MARGIN, y: y - 5 }, end: { x: MARGIN + 34, y: y - 5 }, thickness: 1.5, color: ACCENT });
    y -= 19;
  };
  const continuedSection = (number: string, title: string) => {
    page.drawText(safeText(`${number}  ${title.toUpperCase()} (FORTSETZUNG)`), { x: MARGIN, y, size: 8.2, font: bold, color: PRIMARY });
    page.drawLine({ start: { x: MARGIN, y: y - 5 }, end: { x: MARGIN + 34, y: y - 5 }, thickness: 1.2, color: ACCENT });
    y -= 19;
  };

  const drawPartyRow = (role: string, values: string[]) => {
    const roleWidth = 104;
    const valueX = MARGIN + roleWidth + 15;
    const valueWidth = CONTENT_WIDTH - roleWidth - 27;
    const lines = values.flatMap((value) => value ? linesFor(value, regular, 8.8, valueWidth) : []);
    const height = Math.max(38, lines.length * 12 + 18);
    ensure(height + 5);
    page.drawRectangle({ x: MARGIN, y: y - height + 7, width: CONTENT_WIDTH, height, color: LIGHT_NEUTRAL, borderColor: LINE, borderWidth: 0.45 });
    page.drawText(role.toUpperCase(), { x: MARGIN + 12, y: y - 9, size: 7.1, font: bold, color: PRIMARY });
    let rowY = y - 9;
    for (const line of lines) {
      page.drawText(line, { x: valueX, y: rowY, size: 8.8, font: regular, color: INK });
      rowY -= 12;
    }
    y -= height + 5;
  };

  const drawOverview = (items: Array<[string, string]>) => {
    const gap = 12;
    const columnWidth = (CONTENT_WIDTH - gap) / 2;
    const rows = Array.from({ length: Math.ceil(items.length / 2) }, (_, row) => items.slice(row * 2, row * 2 + 2));
    const rowHeights = rows.map((row) => Math.max(...row.map(([, value]) => linesFor(value, bold, 8.8, columnWidth - 24).length), 1) * 11 + 25);
    const height = rowHeights.reduce((sum, value) => sum + value, 0) + 8;
    ensure(height + 4);
    page.drawRectangle({ x: MARGIN, y: y - height + 7, width: CONTENT_WIDTH, height, color: SOFT_PRIMARY, borderColor: LINE, borderWidth: 0.5 });
    let rowTop = y - 8;
    rows.forEach((row, rowIndex) => {
      row.forEach(([label, value], column) => {
        const x = MARGIN + 12 + column * (columnWidth + gap);
        page.drawText(label.toUpperCase(), { x, y: rowTop, size: 6.7, font: bold, color: MUTED });
        linesFor(value, bold, 8.8, columnWidth - 24).forEach((line, index) => {
          page.drawText(line, { x, y: rowTop - 12 - index * 11, size: 8.8, font: bold, color: INK });
        });
      });
      rowTop -= rowHeights[rowIndex];
    });
    y -= height + 7;
  };

  const drawFlowingCallout = (text: string) => {
    const size = 8.8;
    const lineHeight = 12.2;
    const lines = linesFor(text, regular, size, CONTENT_WIDTH - 30);
    let offset = 0;
    while (offset < lines.length) {
      if (offset > 0) {
        addPage();
        continuedSection("7", "Besondere Vereinbarungen");
      } else if (y - 42 < CONTENT_BOTTOM) addPage();
      const available = y - CONTENT_BOTTOM;
      const capacity = Math.max(1, Math.floor((available - 24) / lineHeight));
      const chunk = lines.slice(offset, offset + capacity);
      const height = chunk.length * lineHeight + 22;
      const top = y;
      page.drawRectangle({ x: MARGIN, y: top - height + 7, width: CONTENT_WIDTH, height, color: LIGHT_NEUTRAL, borderColor: LINE, borderWidth: 0.5 });
      page.drawRectangle({ x: MARGIN, y: top - height + 7, width: 3, height, color: ACCENT });
      let lineY = top - 9;
      for (const line of chunk) {
        if (line) page.drawText(line, { x: MARGIN + 15, y: lineY, size, font: regular, color: INK });
        lineY -= lineHeight;
      }
      y -= height + 8;
      offset += chunk.length;
    }
  };

  const drawConfirmation = () => {
    const name = `${data.signingAuthorityName ?? data.sponsor.contactName ?? "Sponsor"} · ${data.signingAuthorityRole ?? "vertretungsberechtigte Person"}`;
    const detail = `${data.confirmedEmail ?? "-"} · ${swissDate(data.confirmedAt)}`;
    const fingerprint = `Dokument-Fingerabdruck: ${data.snapshotHash ?? "-"}`;
    const nameLines = linesFor(name, bold, 9.2, CONTENT_WIDTH - 28);
    const detailLines = linesFor(detail, regular, 8.2, CONTENT_WIDTH - 28);
    const fingerprintLines = linesFor(fingerprint, regular, 6.8, CONTENT_WIDTH - 28);
    const height = 28 + nameLines.length * 12 + detailLines.length * 11 + fingerprintLines.length * 9;
    ensure(height + 8);
    const top = y;
    page.drawRectangle({ x: MARGIN, y: top - height + 7, width: CONTENT_WIDTH, height, color: SOFT_ACCENT, borderColor: ACCENT, borderWidth: 0.8 });
    page.drawText("ELEKTRONISCH BESTÄTIGT", { x: MARGIN + 14, y: top - 10, size: 7.2, font: bold, color: ACCENT });
    let lineY = top - 28;
    for (const line of nameLines) { page.drawText(line, { x: MARGIN + 14, y: lineY, size: 9.2, font: bold, color: INK }); lineY -= 12; }
    for (const line of detailLines) { page.drawText(line, { x: MARGIN + 14, y: lineY, size: 8.2, font: regular, color: MUTED }); lineY -= 11; }
    for (const line of fingerprintLines) { page.drawText(line, { x: MARGIN + 14, y: lineY, size: 6.8, font: regular, color: MUTED }); lineY -= 9; }
    y -= height + 8;
  };

  header(page);
  page.drawText(data.status === "draft" ? "VERTRAGSENTWURF" : "SPONSORINGVERTRAG", {
    x: MARGIN, y, size: 8, font: bold, color: data.status === "draft" ? ACCENT_ON_DARK : ACCENT,
  });
  y -= 27;
  drawText(data.title, { size: 21, font: bold, color: INK, lineHeight: 24, after: 13 });

  const metaWidth = 205;
  const addressX = MARGIN + metaWidth + 26;
  const addressWidth = CONTENT_WIDTH - metaWidth - 26;
  const addressValues = [
    data.sponsor.legalName,
    data.sponsor.contactName,
    data.sponsor.street,
    `${data.sponsor.postalCode ?? ""} ${data.sponsor.city ?? ""}`.trim(),
    data.sponsor.contactEmail,
  ].filter((value): value is string => Boolean(value));
  const addressLines = addressValues.flatMap((value, index) => linesFor(value, index === 0 ? bold : regular, index === 0 ? 9.2 : 8.7, addressWidth - 24));
  const addressHeight = Math.max(99, addressLines.length * 12 + 35);
  const gridHeight = Math.max(addressHeight, 108);
  ensure(gridHeight + 8);
  const gridTop = y;
  const metadata: Array<[string, string]> = [
    ["Vertragsnummer", data.contractNumber],
    ["Datum", swissDate(data.createdAt)],
    ["Status", statusLabel(data.status)],
    ["Version", String(data.versionNumber)],
  ];
  let metaY = gridTop - 5;
  for (const [label, value] of metadata) {
    page.drawText(label.toUpperCase(), { x: MARGIN, y: metaY, size: 6.7, font: bold, color: MUTED });
    const valueLines = linesFor(value, bold, 8.7, metaWidth);
    valueLines.forEach((line, index) => page.drawText(line, { x: MARGIN, y: metaY - 11 - index * 11, size: 8.7, font: bold, color: INK }));
    metaY -= Math.max(24, valueLines.length * 11 + 13);
  }
  page.drawRectangle({ x: addressX, y: gridTop - addressHeight + 7, width: addressWidth, height: addressHeight, color: SOFT_PRIMARY });
  page.drawText("AUFTRAGGEBER", { x: addressX + 12, y: gridTop - 10, size: 6.8, font: bold, color: ACCENT });
  let addressY = gridTop - 30;
  addressValues.forEach((value, index) => {
    const font = index === 0 ? bold : regular;
    const size = index === 0 ? 9.2 : 8.7;
    for (const line of linesFor(value, font, size, addressWidth - 24)) {
      page.drawText(line, { x: addressX + 12, y: addressY, size, font, color: index === 0 ? INK : MUTED });
      addressY -= 12;
    }
  });
  y -= gridHeight + 9;

  section("", "Vertragsparteien");
  drawPartyRow("Organisation", [
    data.organization.legalName,
    `${data.organization.street}, ${data.organization.postalCode} ${data.organization.city}, ${data.organization.country}`,
    `${data.organization.representativeName}, ${data.organization.representativeTitle}`,
    data.organization.contactEmail,
  ]);
  drawPartyRow("Sponsor", [
    data.sponsor.legalName,
    [data.sponsor.street, `${data.sponsor.postalCode ?? ""} ${data.sponsor.city ?? ""}`.trim()].filter(Boolean).join(", "),
    [data.sponsor.contactName, data.sponsor.contactEmail].filter(Boolean).join(" · "),
  ]);

  section("1", "Vertragsgegenstand");
  drawText(`Die Organisation und der Sponsor vereinbaren die Sponsoringpartnerschaft «${data.package.name}». Die Organisation erbringt die nachfolgend aufgeführten Leistungen während der vereinbarten Laufzeit. Der Sponsor leistet den ausgewiesenen Sponsoringbeitrag gemäss Zahlungsplan.`, { after: 4 });
  drawText("Paket, Preis, Laufzeit und Leistungen sind Bestandteil dieses Vertrags. Spätere Änderungen am allgemeinen Paketkatalog verändern diesen Vertrag nicht.", { after: 6 });
  drawOverview([
    ["Paket", data.package.name],
    ["Beitrag", formatChf(data.package.priceCents)],
    ["Laufzeit", `${data.package.durationMonths} Monate`],
    ["Zahlungsplan", paymentLabels[data.package.paymentPlan] ?? "individuell"],
  ]);

  section("2", "Vereinbarte Leistungen");
  if (data.package.description) drawText(data.package.description, { color: MUTED, after: 6 });
  for (const right of data.package.rights) {
    const details = [right.quantity > 1 ? `${right.quantity}x` : null, right.channel, right.location, right.scheduleText].filter(Boolean).join(" · ");
    const nameLines = linesFor(right.name, bold, 9, CONTENT_WIDTH - 19);
    const detailLines = details ? linesFor(details, regular, 8, CONTENT_WIDTH - 19) : [];
    const descriptionLines = right.description ? linesFor(right.description, regular, 8, CONTENT_WIDTH - 19) : [];
    const itemHeight = nameLines.length * 12 + (detailLines.length + descriptionLines.length) * 10.8 + 8;
    const pageBeforeEnsure = page;
    if (itemHeight < A4.height - 180) ensure(itemHeight + 3);
    if (page !== pageBeforeEnsure) continuedSection("2", "Vereinbarte Leistungen");
    page.drawCircle({ x: MARGIN + 4, y: y + 3, size: 2.5, color: ACCENT_ON_DARK });
    drawLines(nameLines, { x: MARGIN + 15, width: CONTENT_WIDTH - 15, font: bold, size: 9, lineHeight: 12 });
    if (detailLines.length) drawLines(detailLines, { x: MARGIN + 15, width: CONTENT_WIDTH - 15, size: 8, color: MUTED, lineHeight: 10.8 });
    if (descriptionLines.length) drawLines(descriptionLines, { x: MARGIN + 15, width: CONTENT_WIDTH - 15, size: 8, color: MUTED, lineHeight: 10.8 });
    y -= 7;
  }

  section("3", "Zusammenarbeit und Mitwirkung");
  drawText("Die Organisation plant die konkrete Umsetzung innerhalb der beschriebenen Kanäle, Orte, Mengen und Termine. Der Sponsor liefert benötigte Logos, Inserate, Freigaben und Kontaktdaten rechtzeitig in geeigneter Qualität. Beide Parteien informieren sich frühzeitig über Umstände, welche die vereinbarte Leistungserbringung beeinflussen.", { after: 5 });

  const rightNames = data.package.rights.map((right) => `${right.name} ${right.channel ?? ""}`.toLocaleLowerCase("de-CH")).join(" ");
  if (/werbetafel|bande|werbefläche/.test(rightNames)) {
    drawText("Werbeflächen: Produktion und Montage werden durch die Organisation koordiniert. Standort, Format, Produktionskosten und Eigentum ergeben sich aus dem jeweiligen Leistungseintrag und den besonderen Vereinbarungen.", { after: 4 });
  }
  if (/tenü|trikot|textil|bekleidung/.test(rightNames)) {
    drawText("Tenü und Textilien: Beschaffung und Bedruckung werden durch die Organisation koordiniert. Platzierung, Team, Nutzungsdauer und Eigentum ergeben sich aus dem jeweiligen Leistungseintrag.", { after: 4 });
  }
  if (/matchball/.test(rightNames)) {
    drawText("Matchball: Das Sponsoring bezeichnet die kommunikative Präsenz am Spieltag. Es begründet nicht automatisch die Beschaffung eines neuen Balls, sofern dies nicht ausdrücklich vereinbart ist.", { after: 4 });
  }

  section("4", "Beitrag und Rechnungsstellung");
  drawText(`Der Sponsoringbeitrag beträgt ${formatChf(data.package.priceCents)}. Die Rechnungsstellung erfolgt ${paymentLabels[data.package.paymentPlan] ?? "gemäss individuellem Zahlungsplan"}${data.package.paymentTerms ? `; Zahlungsbedingungen: ${data.package.paymentTerms}` : ""}. Einmalige Produktions- oder Herstellungskosten werden nur geschuldet, wenn sie ausdrücklich in diesem Vertrag aufgeführt sind.`, { after: 5 });

  section("5", "Laufzeit und Fortsetzung");
  drawText(`Die Vertragsdauer beträgt ${data.package.durationMonths} Monate. Beginn: ${swissDate(data.package.validFrom)}. Ende: ${swissDate(data.package.validUntil)}.`, { after: 3 });
  drawText(data.terms.renewalMode === "annual_auto"
    ? `Ohne Kündigung bis ${data.terms.noticeMonths} Monate vor dem vereinbarten Ende verlängert sich der Vertrag jeweils um ein Jahr.`
    : "Der Vertrag verlängert sich nicht automatisch. Eine Fortsetzung wird von beiden Parteien neu vereinbart.", { after: 5 });

  section("6", "Marken und Inhalte");
  drawText("Der Sponsor bestätigt, dass er zur Bereitstellung der gelieferten Logos und Inhalte berechtigt ist. Die Organisation verwendet sie ausschliesslich zur Erfüllung der vereinbarten Sponsoringleistungen und während der vereinbarten Laufzeit. Weitergehende Nutzungen benötigen eine separate Vereinbarung.", { after: 5 });

  section("7", "Besondere Vereinbarungen");
  drawFlowingCallout(data.specialAgreements);

  section("8", "Bestätigung");
  drawText("Mit der ausdrücklichen Bestätigung erklären beide Parteien ihr Einverständnis mit dem dokumentierten Vertragsinhalt. Mittragen protokolliert Identität, E-Mail-Adresse, Zeitpunkt, Vertragsversion und Dokument-Fingerabdruck.", { after: 7 });
  if (data.status === "confirmed" && data.confirmedAt) {
    drawConfirmation();
  } else {
    drawText(data.status === "draft"
      ? "Dieser Entwurf wurde noch nicht durch die Organisation freigegeben."
      : "Dieser Vertrag wartet auf die elektronische Bestätigung der vertretungsberechtigten Person des Sponsors.", {
      font: bold, color: data.status === "draft" ? ACCENT_ON_DARK : ACCENT,
    });
  }

  if (data.terms.placeOfJurisdiction) {
    y -= 7;
    drawText(`Vereinbarter Gerichtsstand: ${data.terms.placeOfJurisdiction}.`, { size: 8.3, color: MUTED });
  }

  pages.forEach((target, index) => {
    target.drawLine({ start: { x: MARGIN, y: 41 }, end: { x: A4.width - MARGIN, y: 41 }, thickness: 0.65, color: ACCENT });
    target.drawText(fitLine(`${data.organization.legalName} · ${data.contractNumber}`, regular, 7, 385), { x: MARGIN, y: 25, size: 7, font: regular, color: MUTED });
    const pageText = `Seite ${index + 1} von ${pages.length}`;
    target.drawText(pageText, { x: A4.width - MARGIN - regular.widthOfTextAtSize(pageText, 7), y: 25, size: 7, font: regular, color: MUTED });
  });

  return pdf.save({ useObjectStreams: false });
}
