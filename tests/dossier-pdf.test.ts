import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createDossierPdf } from "../netlify/functions/_shared/dossier-pdf.ts";

test("dossier PDF contains portrait, packages and contact pages", async () => {
  const bytes = await createDossierPdf({
    organizationName: "FC Muster",
    generatedAt: "2026-09-10T12:00:00Z",
    brand: {
      primaryColor: "#9F1D35",
      accentColor: "#F4C542",
      logo: {
        contentType: "image/png",
        bytes: Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")),
      },
    },
    profile: {
      headline: "Gemeinsam für starke Teams und regionale Perspektiven",
      seasonLabel: "Saison 2026/27",
      introduction: "Unser Klub verbindet Menschen in der Region.",
      clubPortrait: "Wir fördern Nachwuchs, Breitensport und ambitionierten Fussball auf nachhaltige Weise.",
      sponsorshipImpact: "Sponsoring ermöglicht Ausbildung, Infrastruktur und faire Bedingungen für alle Teams.",
      audience: "Mitglieder, Familien, Unternehmen und Besucherinnen und Besucher aus der Region.",
      contactName: "Alex Muster",
      contactEmail: "sponsoring@example.ch",
      contactPhone: "+41 79 000 00 00",
      website: "https://example.ch",
    },
    packages: ["Gold", "Silber"].map((name, index) => ({
      name,
      description: `Das ${name}-Paket bietet eine sichtbare und langfristige Partnerschaft.`,
      priceCents: (5000 - index * 2000) * 100,
      durationMonths: 12,
      paymentPlan: "annual",
      rights: Array.from({ length: 10 }, (_, rightIndex) => ({
        name: `Leistung ${rightIndex + 1}`,
        description: "Präsenz im Vereinsumfeld und auf ausgewählten Kommunikationsmitteln.",
        quantity: 1,
        scheduleText: "Saison 2026/27",
        channel: "Online und vor Ort",
        location: "Sportanlage",
      })),
    })),
  });
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getTitle(), "Sponsoringdossier FC Muster");
  assert.ok(document.getPageCount() >= 4);
});
