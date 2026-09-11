import assert from "node:assert/strict";
import test from "node:test";

import { annualValueForPackage } from "../src/sponsorPackagePricing.ts";

const packages = [
  { id: "bronze", price_cents: 100_000 },
  { id: "silver", price_cents: 250_000 },
  { id: "custom", price_cents: 123_450 },
];

test("uses the selected package price as editable annual value", () => {
  assert.equal(annualValueForPackage("bronze", packages), "1000");
  assert.equal(annualValueForPackage("silver", packages), "2500");
  assert.equal(annualValueForPackage("custom", packages), "1234.5");
});

test("keeps the existing annual value when no package is selected", () => {
  assert.equal(annualValueForPackage("", packages), null);
  assert.equal(annualValueForPackage("missing", packages), null);
});
