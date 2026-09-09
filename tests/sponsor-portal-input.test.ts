import assert from "node:assert/strict";
import test from "node:test";
import { parseSponsorDecision } from "../netlify/functions/_shared/sponsor-portal-input.ts";

const versionId = "123e4567-e89b-42d3-a456-426614174000";

test("binding sponsor choices require package and acknowledgement", () => {
  assert.deepEqual(parseSponsorDecision({ decision: "accept", packageVersionId: versionId, acknowledged: true }), {
    ok: true,
    value: { decision: "accept", packageVersionId: versionId, acknowledged: true },
  });
  assert.deepEqual(parseSponsorDecision({ decision: "accept", packageVersionId: versionId, acknowledged: false }), { ok: false, error: "binding_acknowledgement_required" });
  assert.deepEqual(parseSponsorDecision({ decision: "alternative", acknowledged: true }), { ok: false, error: "package_version_required" });
});

test("advice and decline are valid without a package selection", () => {
  assert.deepEqual(parseSponsorDecision({ decision: "advice" }), { ok: true, value: { decision: "advice", packageVersionId: null, acknowledged: false } });
  assert.deepEqual(parseSponsorDecision({ decision: "decline" }), { ok: true, value: { decision: "decline", packageVersionId: null, acknowledged: false } });
});
