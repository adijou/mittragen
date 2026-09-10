import assert from "node:assert/strict";
import test from "node:test";
import { dossierMissingFields, parseDossierProfile } from "../netlify/functions/_shared/dossier-input.ts";

const completeProfile = {
  headline: "Gemeinsam für den Nachwuchs",
  seasonLabel: "Saison 2026/27",
  introduction: "Wir schaffen regionale Perspektiven.",
  clubPortrait: "Der Klub verbindet Breiten- und Leistungsfussball.",
  sponsorshipImpact: "Partnerschaften finanzieren Ausbildung und Infrastruktur.",
  audience: "Familien, Aktive und Unternehmen aus der Region.",
  contactName: "Adrian Muster",
  contactEmail: "sponsoring@example.ch",
  contactPhone: "+41 79 000 00 00",
  website: "https://example.ch",
};

test("dossier profile accepts complete club content", () => {
  const parsed = parseDossierProfile(completeProfile);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(dossierMissingFields(parsed.value), []);
});

test("dossier profile reports missing required editorial fields", () => {
  const parsed = parseDossierProfile({ ...completeProfile, clubPortrait: "", contactEmail: null });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(dossierMissingFields(parsed.value), ["clubPortrait", "contactEmail"]);
});

test("dossier profile rejects invalid contact data", () => {
  assert.deepEqual(parseDossierProfile({ ...completeProfile, contactEmail: "wrong" }), { ok: false, error: "invalid_contactEmail" });
  assert.deepEqual(parseDossierProfile({ ...completeProfile, website: "javascript:alert(1)" }), { ok: false, error: "invalid_website" });
});
