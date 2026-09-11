import assert from "node:assert/strict";
import test from "node:test";
import { parseBrandColors, parseOrganizationProfile } from "../netlify/functions/_shared/organization-profile-input.ts";

const complete = {
  legalName: "FC Muster",
  street: "Sportweg 1",
  postalCode: "1700",
  city: "Freiburg",
  country: "Schweiz",
  representativeName: "Alex Muster",
  representativeTitle: "Präsidentin",
  contactName: "Sponsoring-Team",
  contactEmail: "sponsoring@example.ch",
  contactPhone: "+41 26 000 00 00",
  website: "https://example.ch",
  renewalMode: "manual",
  noticeMonths: null,
  placeOfJurisdiction: null,
  brandPrimaryColor: "#a01b35",
  brandAccentColor: "#f2c440",
};

test("organization profile combines dossier contact, contract data and branding", () => {
  const parsed = parseOrganizationProfile(complete);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.contactEmail, "sponsoring@example.ch");
    assert.equal(parsed.value.brandPrimaryColor, "#A01B35");
    assert.equal(parsed.value.brandAccentColor, "#F2C440");
  }
});

test("organization profile validates public URLs and brand colors", () => {
  assert.deepEqual(parseOrganizationProfile({ ...complete, website: "javascript:alert(1)" }), { ok: false, error: "invalid_website" });
  assert.deepEqual(parseBrandColors("#123456", "red"), { ok: false, error: "invalid_brand_colors" });
});
