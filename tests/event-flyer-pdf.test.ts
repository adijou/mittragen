import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createEventFlyerPdf, type EventFlyerPdfData } from "../netlify/functions/_shared/event-flyer-pdf.ts";

const pixelLogo = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

function fixture(overrides: Partial<EventFlyerPdfData> = {}): EventFlyerPdfData {
  return {
    generatedAt: "2026-09-12T12:00:00Z",
    brand: { primaryColor: "#0B2144", accentColor: "#1967FF", logo: { bytes: pixelLogo, contentType: "image/png" } },
    organization: {
      name: "FC Sense Saane",
      contactName: "Sponsoring-Team FC Sense Saane",
      contactEmail: "sponsoring@fcboesingen.ch",
      contactPhone: null,
      website: "https://mittragen.ch",
    },
    event: {
      teamName: "1. Mannschaft",
      opponent: "FC Beispiel",
      competition: "Meisterschaft 2. Liga",
      venue: "Sportplatz Bösingen",
      startsAt: "2026-10-03T16:00:00Z",
      priceCents: 15_000,
    },
    booking: { sponsorName: "Regionale Beispielunternehmung AG", includeFnMention: true, amountCents: 18_000 },
    publicUrl: "https://mittragen.ch/matchball/0123456789abcdef0123456789abcdef0123",
    termsText: "Der Sponsor wird zum Spiel eingeladen. Der Matchball wird vom Verein geliefert und bleibt Eigentum des Vereins.",
    ...overrides,
  };
}

test("match sheet PDF uses organization branding and is exactly one A4 page", async () => {
  const bytes = await createEventFlyerPdf(fixture());
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  assert.equal(document.getTitle(), "Matchblatt 1. Mannschaft - FC Beispiel");
  assert.equal(document.getAuthor(), "FC Sense Saane");
  const page = document.getPage(0);
  assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
  assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
});

test("open event flyer can advertise the public registration link", async () => {
  const bytes = await createEventFlyerPdf(fixture({ booking: null }));
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
});
