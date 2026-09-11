import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isLogoUpload, parseBrandColors, parseOrganizationProfile } from "../netlify/functions/_shared/organization-profile-input.ts";

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

test("logo uploads are accepted by capability instead of runtime-specific File identity", () => {
  const crossRuntimeUpload = {
    size: 1024,
    arrayBuffer: async () => new ArrayBuffer(1024),
  };

  assert.equal(isLogoUpload(crossRuntimeUpload), true);
  assert.equal(isLogoUpload({ size: 1024 }), false);
  assert.equal(isLogoUpload({ size: -1, arrayBuffer: async () => new ArrayBuffer(0) }), false);
  assert.equal(isLogoUpload("logo.png"), false);
});

test("organization audit events keep UUID and text parameters separate", async () => {
  const source = await readFile(new URL("../netlify/functions/organization.mts", import.meta.url), "utf8");
  const tenantAuditIds = source.match(/'organization\.(?:profile|logo)_updated','tenant',\$3::text/g) ?? [];

  assert.equal(tenantAuditIds.length, 2);
  assert.doesNotMatch(source, /'organization\.(?:profile|logo)_updated','tenant',\$1::text/);
});
