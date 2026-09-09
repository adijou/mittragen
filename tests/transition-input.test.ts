import assert from "node:assert/strict";
import test from "node:test";
import { parseCampaignInput, parseCampaignStatusInput, parseMappingInput, parseTransitionSponsorInput } from "../netlify/functions/_shared/transition-input.ts";

test("campaign inputs normalize their labels and validate calendar dates", () => {
  assert.deepEqual(parseCampaignInput({ name: "  Fusion 2027  ", targetPeriod: " Saison 2027/28 ", responseDeadline: "2026-09-30" }), {
    ok: true,
    value: { name: "Fusion 2027", targetPeriod: "Saison 2027/28", responseDeadline: "2026-09-30" },
  });
  assert.deepEqual(parseCampaignInput({ name: "Fusion", targetPeriod: "2027", responseDeadline: "2026-02-30" }), { ok: false, error: "invalid_response_deadline" });
});

test("mapping inputs require a package and a safe non-negative amount", () => {
  assert.deepEqual(parseMappingInput({ targetPackage: " Gold Plus ", targetValueCents: 500000 }), {
    ok: true,
    value: { targetPackage: "Gold Plus", targetValueCents: 500000 },
  });
  assert.deepEqual(parseMappingInput({ targetPackage: "Gold", targetValueCents: -1 }), { ok: false, error: "invalid_target_value" });
});

test("exceptions require a documented reason", () => {
  const valid = parseTransitionSponsorInput({ proposedPackage: "Silber", proposedValueCents: 250000, status: "exception", exceptionNote: "Doppelvertrag bis Saisonende" });
  assert.equal(valid.ok, true);
  assert.deepEqual(parseTransitionSponsorInput({ proposedPackage: "Silber", proposedValueCents: 250000, status: "exception", exceptionNote: "" }), { ok: false, error: "exception_note_required" });
  assert.deepEqual(parseTransitionSponsorInput({ proposedPackage: "Silber", proposedValueCents: 250000, status: "ready", exceptionNote: false }), { ok: false, error: "invalid_exception_note" });
});

test("campaigns can only enter administrative pre-send states", () => {
  assert.deepEqual(parseCampaignStatusInput({ status: "ready" }), { ok: true, value: { status: "ready" } });
  assert.deepEqual(parseCampaignStatusInput({ status: "active" }), { ok: false, error: "invalid_campaign_status" });
});
