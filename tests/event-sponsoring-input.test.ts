import assert from "node:assert/strict";
import test from "node:test";
import { parseEventBooking, parseEventSponsoringSettings, parsePackageAllocation, parseSponsorshipEvent } from "../netlify/functions/_shared/event-sponsoring-input.ts";

const eventId = "4ec8f51e-4b2e-4b5e-a9c5-36f21f6842a1";

test("event settings preserve publication state and editorial content", () => {
  const result = parseEventSponsoringSettings({
    headline: "Matchball-Sponsoring 2026/27",
    seasonLabel: "Saison 2026/27",
    introduction: "Unterstützen Sie eines unserer Heimspiele.",
    termsText: "Der Sponsor wird zum Spiel eingeladen.",
    isPublished: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.isPublished, true);
});

test("event input accepts configurable prices and an ISO match date", () => {
  const result = parseSponsorshipEvent({
    teamName: "1. Mannschaft",
    opponent: "FC Beispiel",
    competition: "Meisterschaft",
    venue: "Sportplatz Bösingen",
    homeCoach: "Trainer Heimteam",
    opponentCoach: "Trainer Gastteam",
    refereeName: "Schiedsrichter Beispiel",
    matchInfoUrl: "https://matchcenter.aff-ffv.ch/default.aspx?tg=4189424",
    speakerNote: "Willkommen zum heutigen Meisterschaftsspiel.",
    startsAt: "2026-10-03T16:00:00.000Z",
    priceCents: 15_000,
    fnSupplementCents: 3_000,
    status: "published",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.priceCents, 15_000);
    assert.equal(result.value.refereeName, "Schiedsrichter Beispiel");
  }
});

test("package allocations require the exact sponsor, package and right", () => {
  const result = parsePackageAllocation({
    sponsorId: eventId,
    packageVersionId: "d331af7b-b943-4fdc-86f2-aa43969c8ff3",
    rightId: "4f78d9e2-23df-43a9-898f-4424ef43581b",
    note: "Mit Sponsor abgestimmt",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.note, "Mit Sponsor abgestimmt");
  assert.deepEqual(parsePackageAllocation({ sponsorId: eventId, packageVersionId: "wrong", rightId: eventId }), { ok: false, error: "invalid_package_version" });
});

test("public booking accepts third parties without account data or email confirmation", () => {
  const now = Date.now();
  const result = parseEventBooking({
    eventId,
    sponsorName: "Beispiel AG",
    address: "Hauptstrasse 1",
    postalCode: "3178",
    city: "Bösingen",
    contactName: "Mara Muster",
    contactEmail: "mara@example.ch",
    contactPhone: "+41 79 000 00 00",
    referredByMember: "Max Muster",
    includeFnMention: true,
    paymentMode: "invoice",
    termsAccepted: true,
    website: "",
    startedAt: now - 2_000,
  }, now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.contactEmail, "mara@example.ch");
    assert.equal(result.value.includeFnMention, true);
  }
});

test("public booking rejects honeypot submissions and missing acknowledgement", () => {
  const now = Date.now();
  const base = {
    eventId,
    sponsorName: "Beispiel AG",
    address: "Hauptstrasse 1",
    postalCode: "3178",
    city: "Bösingen",
    contactName: "Mara Muster",
    contactEmail: "mara@example.ch",
    includeFnMention: false,
    paymentMode: "cash",
    termsAccepted: true,
    startedAt: now - 2_000,
  };
  assert.deepEqual(parseEventBooking({ ...base, website: "spam.example" }, now), { ok: false, error: "event_booking_rejected" });
  assert.deepEqual(parseEventBooking({ ...base, website: "", termsAccepted: false }, now), { ok: false, error: "event_booking_terms_required" });
});
