import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("tenant audit events use a dedicated text parameter for object IDs", async () => {
  const source = await readFile(new URL("../netlify/functions/tenants.mts", import.meta.url), "utf8");
  const casts = source.match(/'tenant', \$3::text/g) ?? [];
  assert.equal(casts.length, 2);
});
