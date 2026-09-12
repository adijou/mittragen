import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createEventFlyerPdf, type EventFlyerPdfData } from "../netlify/functions/_shared/event-flyer-pdf.ts";

const data: EventFlyerPdfData = {
  generatedAt: "2026-09-12T12:00:00Z",
  brand: { primaryColor: "#16213E", accentColor: "#E9B949", logo: null },
  organization: { name: "Sportverein Muster", contactName: null, contactEmail: null, contactPhone: null, website: null },
  event: {
    teamName: "Heimteam",
    opponent: "Gastteam",
    competition: "Meisterschaft",
    venue: "Sportanlage Muster",
    startsAt: "2026-10-03T16:00:00Z",
    homeCoach: "Trainer Heim",
    opponentCoach: "Trainer Gast",
    refereeName: "Spielleitung Muster",
    matchInfoUrl: "https://example.test/matchcenter",
    speakerNote: "Beide Teams vor dem Anpfiff begrüssen.",
  },
  matchballSponsors: [
    { sponsorName: "Sponsor Eins AG", source: "direct", detail: "Direktbuchung" },
    { sponsorName: "Sponsor Zwei GmbH", source: "package", detail: "Bronze · Matchball" },
  ],
  partners: [
    { sponsorName: "Partner Gold AG", packageName: "Gold" },
    { sponsorName: "Partner Silber AG", packageName: "Silber" },
  ],
  publicUrl: "https://example.test/matchball/public-key",
};

test("match info renders multiple sponsors as one branded A4 page", async () => {
  const bytes = await createEventFlyerPdf(data);
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  assert.equal(document.getTitle(), "Matchinfo Heimteam - Gastteam");
  assert.equal(document.getAuthor(), "Sportverein Muster");
  const page = document.getPage(0);
  assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
  assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
});

test("match info remains one page without assigned sponsors", async () => {
  const bytes = await createEventFlyerPdf({ ...data, matchballSponsors: [] });
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
});
