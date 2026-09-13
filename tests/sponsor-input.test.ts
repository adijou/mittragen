import assert from "node:assert/strict";
import test from "node:test";
import { parseSponsorInput } from "../netlify/functions/_shared/sponsor-input.ts";

test("normalizes a valid sponsor", () => {
  const result = parseSponsorInput({
    legal_name: "  Beispiel AG  ",
    contact_email: "kontakt@beispiel.ch",
    website: "https://beispiel.ch",
    annual_value_cents: 250000,
  }, "create");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.legal_name, "Beispiel AG");
  assert.equal(result.value.status, "active");
  assert.equal(result.value.annual_value_cents, 250000);
});

test("rejects unsafe or malformed sponsor values", () => {
  assert.deepEqual(parseSponsorInput({ legal_name: "", annual_value_cents: -1 }, "create"), { ok: false, error: "invalid_legal_name" });
  assert.deepEqual(parseSponsorInput({ contact_email: "not-an-email" }, "update"), { ok: false, error: "invalid_contact_email" });
  assert.deepEqual(parseSponsorInput({ website: "javascript:alert(1)" }, "update"), { ok: false, error: "invalid_website" });
  assert.deepEqual(parseSponsorInput({ status: "deleted" }, "update"), { ok: false, error: "invalid_status" });
});

test("requires at least one actual update", () => {
  assert.deepEqual(parseSponsorInput({}, "update"), { ok: false, error: "no_changes" });
});

test("validates assigned package version ids", () => {
  const versionId = "123e4567-e89b-42d3-a456-426614174000";
  const parsed = parseSponsorInput({ assigned_package_version_id: versionId }, "update");
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.assigned_package_version_id, versionId);
  assert.deepEqual(parseSponsorInput({ assigned_package_version_id: "wrong" }, "update"), { ok: false, error: "invalid_assigned_package" });
});
