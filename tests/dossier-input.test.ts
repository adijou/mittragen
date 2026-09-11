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
};
const completeContact = { contactName: "Adrian Muster", contactEmail: "sponsoring@example.ch" };

test("dossier profile accepts complete club content", () => {
  const parsed = parseDossierProfile(completeProfile);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(dossierMissingFields(parsed.value, completeContact), []);
});

test("dossier profile reports missing required editorial fields", () => {
  const parsed = parseDossierProfile({ ...completeProfile, clubPortrait: "" });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(dossierMissingFields(parsed.value, { ...completeContact, contactEmail: null }), ["clubPortrait", "contactEmail"]);
});

test("dossier profile only accepts editorial content", () => {
  assert.deepEqual(parseDossierProfile({ ...completeProfile, audience: 5 }), { ok: false, error: "invalid_audience" });
});
