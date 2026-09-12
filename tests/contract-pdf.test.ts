import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createContractPdf, type ContractPdfData } from "../netlify/functions/_shared/contract-pdf.ts";

const pixelLogo = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

function fixture(overrides: Partial<ContractPdfData> = {}): ContractPdfData {
  return {
    contractNumber: "MT-2026-0042",
    versionNumber: 2,
    title: "Sponsoringvertrag Bronze",
    status: "confirmed",
    createdAt: "2026-09-12T08:00:00Z",
    releasedAt: "2026-09-12T09:00:00Z",
    confirmedAt: "2026-09-12T10:00:00Z",
    confirmedEmail: "kontakt@beispiel.ch",
    snapshotHash: "f".repeat(64),
    brand: {
      primaryColor: "#9F1D35",
      accentColor: "#F4C542",
      logo: { bytes: pixelLogo, contentType: "image/png" },
    },
    organization: {
      legalName: "FC Beispiel",
      street: "Sportplatzweg 1",
      postalCode: "1700",
      city: "Freiburg",
      country: "Schweiz",
      representativeName: "Alex Muster",
      representativeTitle: "Sponsoringverantwortliche Person",
      contactEmail: "sponsoring@fc-beispiel.ch",
    },
    sponsor: {
      legalName: "Beispielunternehmen AG",
      street: "Industriestrasse 25",
      postalCode: "3186",
      city: "Düdingen",
      contactName: "Sandra Beispiel",
      contactEmail: "kontakt@beispiel.ch",
    },
    package: {
      name: "Bronze",
      description: "Eine regionale Partnerschaft mit nachhaltiger Präsenz.",
      priceCents: 100_000,
      durationMonths: 36,
      paymentPlan: "annual",
      paymentTerms: "zahlbar innert 30 Tagen",
      validFrom: "2026-07-01",
      validUntil: "2029-06-30",
      rights: Array.from({ length: 6 }, (_, index) => ({
        name: `Sponsoring-Leistung ${index + 1}`,
        description: "Sichtbarkeit im Vereinsumfeld und auf ausgewählten Kommunikationsmitteln.",
        quantity: 1,
        scheduleText: "Saison 2026/27",
        channel: "Online und vor Ort",
        location: "Sportanlage",
      })),
    },
    terms: {
      renewalMode: "manual",
      noticeMonths: null,
      placeOfJurisdiction: "Freiburg",
    },
    specialAgreements: "Keine besonderen Vereinbarungen.",
    signingAuthorityName: "Sandra Beispiel",
    signingAuthorityRole: "Geschäftsführerin",
    ...overrides,
  };
}

test("contract PDF uses organization branding and remains valid A4", async () => {
  const bytes = await createContractPdf(fixture());
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getTitle(), "Sponsoringvertrag Bronze MT-2026-0042");
  assert.equal(document.getAuthor(), "FC Beispiel");
  assert.ok(document.getPageCount() >= 2);
  for (const page of document.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
  }
});

test("long addresses, rights and agreements flow over pages without renderer failure", async () => {
  const base = fixture();
  const bytes = await createContractPdf(fixture({
    title: "Langfristiger Sponsoringvertrag mit umfassender regionaler Zusammenarbeit und zusätzlichen Aktivierungen",
    sponsor: {
      ...base.sponsor,
      legalName: "Beispielunternehmen mit einer aussergewöhnlich langen offiziellen Firmenbezeichnung AG",
      street: "Sehr lange Industriestrasse mit ergänzendem Gebäudeteil 125",
      contactName: "Sandra Beispiel-Muster mit langem Funktionszusatz",
      contactEmail: "sponsoring-und-kommunikation@beispielunternehmen-mit-langem-namen.ch",
    },
    package: {
      ...base.package,
      rights: Array.from({ length: 18 }, (_, index) => ({
        name: `Ausführlich beschriebene Sponsoring-Leistung ${index + 1} mit regionaler Aktivierung`,
        description: "Die Leistung umfasst mehrere abgestimmte Präsenzen, Produktionsschritte und Terminfenster innerhalb der gesamten Vertragsdauer.",
        quantity: index % 3 + 1,
        scheduleText: "während der gesamten Saison und an ausgewählten Heimspielen",
        channel: "Online, Print und vor Ort",
        location: "Sportanlage und regionale Veranstaltungen",
      })),
    },
    specialAgreements: Array.from({ length: 45 }, (_, index) =>
      `Vereinbarung ${index + 1}: Umsetzung und Freigabe werden vor dem jeweiligen Termin gemeinsam abgestimmt.`
    ).join("\n"),
  }));
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 5);
  assert.ok(document.getPageCount() <= 14);
});

test("administratively recorded legacy contracts render with their separate evidence mode", async () => {
  const bytes = await createContractPdf(fixture({
    confirmationMode: "admin_legacy",
    confirmedAt: "2024-06-15T10:00:00Z",
    confirmationRecordedAt: "2026-09-12T14:00:00Z",
    confirmationNote: "Beidseitig unterzeichneter Papiervertrag liegt im Vereinsarchiv. Die Angaben wurden anhand des Originals geprüft.",
    confirmedEmail: "admin@fc-beispiel.ch",
  }));
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 2);
  assert.equal(document.getTitle(), "Sponsoringvertrag Bronze MT-2026-0042");
});
