import assert from "node:assert/strict";
import test from "node:test";
import { assignableRoles, parseInvitationInput, parseMembershipUpdate } from "../netlify/functions/_shared/team-input.ts";

test("team invitations normalize email addresses and accept every explicit role", () => {
  for (const role of assignableRoles) {
    assert.deepEqual(parseInvitationInput({ email: " Person@Example.CH ", role }), {
      ok: true,
      value: { email: "person@example.ch", role },
    });
  }
});

test("team invitation and role inputs reject invalid values", () => {
  assert.deepEqual(parseInvitationInput({ email: "not-an-email", role: "viewer" }), { ok: false, error: "invalid_email" });
  assert.deepEqual(parseInvitationInput({ email: "person@example.ch", role: "super_admin" }), { ok: false, error: "invalid_role" });
  assert.deepEqual(parseMembershipUpdate({ role: "super_admin" }), { ok: false, error: "invalid_role" });
});
