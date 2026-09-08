import assert from "node:assert/strict";
import test from "node:test";
import { ownerMembershipParams, parseTenantUpdate } from "../netlify/functions/_shared/tenant-input.ts";

test("owner membership supplies exactly the four SQL parameters", () => {
  const values = ownerMembershipParams("tenant-id", { id: "user-id", email: "owner@example.ch", name: "Owner" });
  assert.deepEqual(values, ["tenant-id", "user-id", "owner@example.ch", "Owner"]);
});

test("organization settings validate name and type", () => {
  assert.deepEqual(parseTenantUpdate({ name: "  Neuer Klubname  ", kind: "club" }), {
    ok: true,
    value: { name: "Neuer Klubname", kind: "club" },
  });
  assert.deepEqual(parseTenantUpdate({ name: "X", kind: "club" }), { ok: false, error: "invalid_name" });
  assert.deepEqual(parseTenantUpdate({ name: "Organisation", kind: "company" }), { ok: false, error: "invalid_kind" });
});
