import assert from "node:assert/strict";
import test from "node:test";
import { parsePackageRightInput, parsePackageVersionInput, parseVersionCopyInput } from "../netlify/functions/_shared/package-input.ts";

const validVersion = {
  name: "Gold Plus",
  description: "Sichtbarkeit und Hospitality",
  priceCents: 750000,
  durationMonths: 12,
  paymentPlan: "annual",
  paymentTerms: "30 Tage netto",
  validFrom: "2027-07-01",
  validUntil: "2028-06-30",
  visibility: "public",
  capacity: 8,
  deviationApprovalRequired: true,
};

test("package versions preserve commercial and validity fields", () => {
  const parsed = parsePackageVersionInput(validVersion);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.priceCents, 750000);
  assert.deepEqual(parsePackageVersionInput({ ...validVersion, validUntil: "2027-06-30" }), { ok: false, error: "invalid_package_validity" });
});

test("package capacity can be unlimited but never zero", () => {
  const unlimited = parsePackageVersionInput({ ...validVersion, capacity: null });
  assert.equal(unlimited.ok, true);
  assert.deepEqual(parsePackageVersionInput({ ...validVersion, capacity: 0 }), { ok: false, error: "invalid_package_capacity" });
});

test("exclusive rights require a scoped inventory key", () => {
  const right = parsePackageRightInput({ name: "Bande Hauptplatz", description: null, quantity: 1, scheduleText: "Saison", channel: "Stadion", location: "Hauptplatz Nord", responsibleRole: "Sponsoringleistungen", exclusivityScope: "area", exclusivityKey: "hauptplatz-nord" });
  assert.equal(right.ok, true);
  assert.deepEqual(parsePackageRightInput({ name: "Branchenexklusivität", quantity: 1, exclusivityScope: "industry", exclusivityKey: "" }), { ok: false, error: "exclusivity_key_required" });
});

test("new versions must copy an existing version UUID", () => {
  assert.equal(parseVersionCopyInput({ sourceVersionId: "11111111-1111-4111-8111-111111111111" }).ok, true);
  assert.deepEqual(parseVersionCopyInput({ sourceVersionId: "latest" }), { ok: false, error: "invalid_source_version" });
});
