import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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
const MARGIN = 51;
const NAVY = rgb(11 / 255, 33 / 255, 68 / 255);
const BLUE = rgb(25 / 255, 103 / 255, 255 / 255);
const GOLD = rgb(233 / 255, 180 / 255, 76 / 255);
const LIGHT_BLUE = rgb(237 / 255, 244 / 255, 255 / 255);
const LIGHT_NEUTRAL = rgb(247 / 255, 249 / 255, 252 / 255);
const LINE = rgb(220 / 255, 227 / 255, 236 / 255);
const MUTED = rgb(67 / 255, 83 / 255, 107 / 255);
const WHITE = rgb(1, 1, 1);

const paymentLabels: Record<string, string> = {
  annual: "Jährlich",
  semiannual: "Halbjährlich",
  quarterly: "Quartalsweise",
  custom: "Individuell",
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
  return value.replace(/\u2011|\u2013|\u2014/g, "-").replace(/\u00a0/g, " ").replace(/\t/g, " ");
}

function linesFor(text: string, font: PDFFont, size: number, width: number) {
  const paragraphs = safeText(text).split(/\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
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
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}…`, size) > width) shortened = shortened.slice(0, -1);
  return `${shortened.trimEnd()}…`;
}

export async function createContractPdf(data: ContractPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
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
  let y = A4.height - 105;

  const header = (target: PDFPage) => {
    target.drawRectangle({ x: 0, y: A4.height - 7, width: A4.width, height: 7, color: BLUE });
    const cx = MARGIN + 13;
    const cy = A4.height - 42;
    const nodes = [[0, 10], [9, 5], [9, -5], [0, -10], [-9, -5], [-9, 5]];
    for (let i = 0; i < nodes.length; i += 1) target.drawCircle({ x: cx + nodes[i][0], y: cy + nodes[i][1], size: 2.7, color: i % 2 ? GOLD : BLUE });
    target.drawCircle({ x: cx, y: cy, size: 4.1, color: NAVY });
    target.drawText(fitLine(data.organization.legalName, bold, 11, 260), { x: MARGIN + 33, y: A4.height - 47, size: 11, font: bold, color: NAVY });
    const platform = "erstellt mit Mittragen";
    target.drawText(platform, { x: A4.width - MARGIN - regular.widthOfTextAtSize(platform, 8), y: A4.height - 45, size: 8, font: regular, color: MUTED });
    target.drawLine({ start: { x: MARGIN, y: A4.height - 68 }, end: { x: A4.width - MARGIN, y: A4.height - 68 }, thickness: 0.8, color: LINE });
  };

  const addPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    header(page);
    y = A4.height - 96;
  };

  const ensure = (height: number) => { if (y - height < 58) addPage(); };
  const drawText = (text: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; lineHeight?: number; after?: number } = {}) => {
    const size = options.size ?? 9.4;
    const font = options.font ?? regular;
    const indent = options.indent ?? 0;
    const lineHeight = options.lineHeight ?? size * 1.42;
    const lines = linesFor(text, font, size, A4.width - MARGIN * 2 - indent);
    ensure(lines.length * lineHeight + (options.after ?? 0));
    for (const line of lines) {
      if (line) page.drawText(line, { x: MARGIN + indent, y, size, font, color: options.color ?? NAVY });
      y -= lineHeight;
    }
    y -= options.after ?? 0;
  };
  const section = (number: string, title: string) => {
    ensure(78);
    y -= 7;
    page.drawText(`${number}  ${title.toUpperCase()}`, { x: MARGIN, y, size: 10.5, font: bold, color: BLUE });
    y -= 20;
  };

  header(page);
  page.drawText(data.status === "draft" ? "VERTRAGSENTWURF" : data.title.toUpperCase(), { x: MARGIN, y, size: 10, font: bold, color: data.status === "draft" ? GOLD : BLUE });
  y -= 34;
  page.drawText(data.title, { x: MARGIN, y, size: 24, font: bold, color: NAVY });
  y -= 42;

  page.drawRectangle({ x: MARGIN, y: y - 72, width: A4.width - MARGIN * 2, height: 82, color: LIGHT_BLUE, borderColor: LINE, borderWidth: 0.5 });
  const metadata = [
    ["Vertragsnummer", data.contractNumber], ["Status", data.status === "draft" ? "Entwurf - noch nicht freigegeben" : data.status === "released" ? "Zur Bestätigung freigegeben" : data.status === "confirmed" ? "Bestätigt" : "Aufgehoben"],
    ["Paket", data.package.name], ["Beitrag", formatChf(data.package.priceCents)],
    ["Laufzeit", `${data.package.durationMonths} Monate`], ["Vertragsversion", String(data.versionNumber)],
  ];
  metadata.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN + 15 + column * 245;
    const rowY = y - 12 - row * 23;
    page.drawText(label.toUpperCase(), { x, y: rowY, size: 6.8, font: bold, color: MUTED });
    page.drawText(safeText(value), { x, y: rowY - 10, size: 9, font: bold, color: NAVY });
  });
  y -= 94;

  section("", "Vertragsparteien");
  const partyTop = y;
  const partyWidth = (A4.width - MARGIN * 2 - 12) / 2;
  const parties = [
    { label: "ORGANISATION", name: data.organization.legalName, lines: [data.organization.street, `${data.organization.postalCode} ${data.organization.city}`, data.organization.country, "", data.organization.representativeName, data.organization.representativeTitle, data.organization.contactEmail] },
    { label: "SPONSOR", name: data.sponsor.legalName, lines: [data.sponsor.street ?? "-", `${data.sponsor.postalCode ?? ""} ${data.sponsor.city ?? ""}`.trim() || "-", "", data.sponsor.contactName ?? "-", data.sponsor.contactEmail ?? "-"] },
  ];
  parties.forEach((party, index) => {
    const x = MARGIN + index * (partyWidth + 12);
    page.drawRectangle({ x, y: partyTop - 124, width: partyWidth, height: 132, color: LIGHT_NEUTRAL, borderColor: LINE, borderWidth: 0.5 });
    page.drawText(party.label, { x: x + 12, y: partyTop - 12, size: 7, font: bold, color: BLUE });
    const nameLines = linesFor(party.name, bold, 9.6, partyWidth - 24).slice(0, 2);
    nameLines.forEach((line, lineIndex) => page.drawText(lineIndex === 1 ? fitLine(line, bold, 9.6, partyWidth - 24) : line, { x: x + 12, y: partyTop - 29 - lineIndex * 12, size: 9.6, font: bold, color: NAVY }));
    let lineY = partyTop - 56;
    for (const line of party.lines) {
      if (line) page.drawText(fitLine(line, regular, 8.3, partyWidth - 24), { x: x + 12, y: lineY, size: 8.3, font: regular, color: MUTED });
      lineY -= 11;
    }
  });
  y = partyTop - 146;

  section("1", "Vertragsgegenstand");
  drawText(`Die Organisation und der Sponsor vereinbaren die Sponsoringpartnerschaft «${data.package.name}». Die Organisation erbringt die nachfolgend aufgeführten Leistungen während der vereinbarten Laufzeit. Der Sponsor leistet den ausgewiesenen Sponsoringbeitrag gemäss Zahlungsplan.`, { after: 5 });
  drawText("Paket, Preis, Laufzeit und Leistungen sind Bestandteil dieses Vertrags. Spätere Änderungen am allgemeinen Paketkatalog verändern diesen Vertrag nicht.", { after: 8 });

  section("2", "Vereinbarte Leistungen");
  if (data.package.description) drawText(data.package.description, { color: MUTED, after: 6 });
  for (const right of data.package.rights) {
    const details = [right.quantity > 1 ? `${right.quantity}x` : null, right.channel, right.location, right.scheduleText].filter(Boolean).join(" · ");
    ensure(38);
    page.drawCircle({ x: MARGIN + 4, y: y + 3, size: 2.5, color: GOLD });
    drawText(right.name, { font: bold, indent: 13, lineHeight: 12.8 });
    if (details) drawText(details, { color: MUTED, indent: 13, size: 8.2, lineHeight: 11.5 });
    if (right.description) drawText(right.description, { color: MUTED, indent: 13, size: 8.2, lineHeight: 11.5 });
    y -= 4;
  }

  section("3", "Zusammenarbeit und Mitwirkung");
  drawText("Die Organisation plant die konkrete Umsetzung innerhalb der beschriebenen Kanäle, Orte, Mengen und Termine. Der Sponsor liefert benötigte Logos, Inserate, Freigaben und Kontaktdaten rechtzeitig in geeigneter Qualität. Beide Parteien informieren sich frühzeitig über Umstände, welche die vereinbarte Leistungserbringung beeinflussen.", { after: 6 });

  const rightNames = data.package.rights.map((right) => `${right.name} ${right.channel ?? ""}`.toLocaleLowerCase("de-CH")).join(" ");
  if (/werbetafel|bande|werbefläche/.test(rightNames)) {
    drawText("Werbeflächen: Produktion und Montage werden durch die Organisation koordiniert. Standort, Format, Produktionskosten und Eigentum ergeben sich aus dem jeweiligen Leistungseintrag und den besonderen Vereinbarungen.", { after: 5 });
  }
  if (/tenü|trikot|textil|bekleidung/.test(rightNames)) {
    drawText("Tenü und Textilien: Beschaffung und Bedruckung werden durch die Organisation koordiniert. Platzierung, Team, Nutzungsdauer und Eigentum ergeben sich aus dem jeweiligen Leistungseintrag.", { after: 5 });
  }
  if (/matchball/.test(rightNames)) {
    drawText("Matchball: Das Sponsoring bezeichnet die kommunikative Präsenz am Spieltag. Es begründet nicht automatisch die Beschaffung eines neuen Balls, sofern dies nicht ausdrücklich vereinbart ist.", { after: 5 });
  }

  section("4", "Beitrag und Rechnungsstellung");
  drawText(`Der Sponsoringbeitrag beträgt ${formatChf(data.package.priceCents)}. Die Rechnungsstellung erfolgt ${paymentLabels[data.package.paymentPlan]?.toLocaleLowerCase("de-CH") ?? "gemäss individuellem Zahlungsplan"}${data.package.paymentTerms ? `; Zahlungsbedingungen: ${data.package.paymentTerms}` : ""}. Einmalige Produktions- oder Herstellungskosten werden nur geschuldet, wenn sie ausdrücklich in diesem Vertrag aufgeführt sind.`, { after: 6 });

  section("5", "Laufzeit und Fortsetzung");
  drawText(`Die Vertragsdauer beträgt ${data.package.durationMonths} Monate. Beginn: ${swissDate(data.package.validFrom)}. Ende: ${swissDate(data.package.validUntil)}.`, { after: 4 });
  drawText(data.terms.renewalMode === "annual_auto"
    ? `Ohne Kündigung bis ${data.terms.noticeMonths} Monate vor dem vereinbarten Ende verlängert sich der Vertrag jeweils um ein Jahr.`
    : "Der Vertrag verlängert sich nicht automatisch. Eine Fortsetzung wird von beiden Parteien neu vereinbart.", { after: 6 });

  section("6", "Marken und Inhalte");
  drawText("Der Sponsor bestätigt, dass er zur Bereitstellung der gelieferten Logos und Inhalte berechtigt ist. Die Organisation verwendet sie ausschliesslich zur Erfüllung der vereinbarten Sponsoringleistungen und während der vereinbarten Laufzeit. Weitergehende Nutzungen benötigen eine separate Vereinbarung.", { after: 6 });

  section("7", "Besondere Vereinbarungen");
  ensure(54);
  const specialLines = linesFor(data.specialAgreements, regular, 8.8, A4.width - MARGIN * 2 - 24);
  const specialHeight = Math.max(48, specialLines.length * 12 + 24);
  ensure(specialHeight + 5);
  page.drawRectangle({ x: MARGIN, y: y - specialHeight + 10, width: A4.width - MARGIN * 2, height: specialHeight, color: LIGHT_NEUTRAL, borderColor: LINE, borderWidth: 0.6 });
  y -= 8;
  for (const line of specialLines) { if (line) page.drawText(line, { x: MARGIN + 12, y, size: 8.8, font: regular, color: NAVY }); y -= 12; }
  y -= 12;

  section("8", "Bestätigung");
  drawText("Mit der ausdrücklichen Bestätigung erklären beide Parteien ihr Einverständnis mit dem dokumentierten Vertragsinhalt. Mittragen protokolliert Identität, E-Mail-Adresse, Zeitpunkt, Vertragsversion und Dokument-Fingerabdruck.", { after: 8 });
  if (data.status === "confirmed" && data.confirmedAt) {
    ensure(78);
    page.drawRectangle({ x: MARGIN, y: y - 60, width: A4.width - MARGIN * 2, height: 68, color: LIGHT_BLUE, borderColor: BLUE, borderWidth: 0.8 });
    page.drawText("ELEKTRONISCH BESTÄTIGT", { x: MARGIN + 13, y: y - 9, size: 7.2, font: bold, color: BLUE });
    page.drawText(safeText(`${data.signingAuthorityName ?? data.sponsor.contactName ?? "Sponsor"} · ${data.signingAuthorityRole ?? "vertretungsberechtigte Person"}`), { x: MARGIN + 13, y: y - 27, size: 9.2, font: bold, color: NAVY });
    page.drawText(safeText(`${data.confirmedEmail ?? "-"} · ${swissDate(data.confirmedAt)}`), { x: MARGIN + 13, y: y - 42, size: 8.2, font: regular, color: MUTED });
    page.drawText(`Dokument-Fingerabdruck: ${data.snapshotHash ?? "-"}`, { x: MARGIN + 13, y: y - 55, size: 6.8, font: regular, color: MUTED });
    y -= 78;
  } else {
    drawText(data.status === "draft" ? "Dieser Entwurf wurde noch nicht durch die Organisation freigegeben." : "Dieser Vertrag wartet auf die elektronische Bestätigung der vertretungsberechtigten Person des Sponsors.", { font: bold, color: data.status === "draft" ? GOLD : BLUE });
  }

  if (data.terms.placeOfJurisdiction) {
    y -= 8;
    drawText(`Vereinbarter Gerichtsstand: ${data.terms.placeOfJurisdiction}.`, { size: 8.5, color: MUTED });
  }

  pages.forEach((target, index) => {
    target.drawLine({ start: { x: MARGIN, y: 39 }, end: { x: A4.width - MARGIN, y: 39 }, thickness: 0.6, color: LINE });
    target.drawText(fitLine(`${data.organization.legalName} · ${data.contractNumber}`, regular, 7, 390), { x: MARGIN, y: 24, size: 7, font: regular, color: MUTED });
    const pageText = `Seite ${index + 1} von ${pages.length}`;
    target.drawText(pageText, { x: A4.width - MARGIN - regular.widthOfTextAtSize(pageText, 7), y: 24, size: 7, font: regular, color: MUTED });
  });

  return pdf.save({ useObjectStreams: false });
}
