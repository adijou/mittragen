import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isDemoDataDeletionConfirmed,
  ownerMembershipParams,
  parseTenantCreate,
  parseTenantUpdate,
} from "../netlify/functions/_shared/tenant-input.ts";

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

test("new organizations are created without example data unless explicitly requested", () => {
  assert.deepEqual(parseTenantCreate({ name: "  FC Muster  ", slug: "FC-Muster", kind: "club" }), {
    ok: true,
    value: { name: "FC Muster", slug: "fc-muster", kind: "club", includeDemo: false },
  });
  assert.deepEqual(parseTenantCreate({ name: "Verein Muster", slug: "verein-muster", kind: "association", includeDemo: true }), {
    ok: true,
    value: { name: "Verein Muster", slug: "verein-muster", kind: "association", includeDemo: true },
  });
  assert.deepEqual(parseTenantCreate({ name: "Verein Muster", slug: "Ungültig!", kind: "association" }), { ok: false, error: "invalid_slug" });
});

test("example data deletion requires the exact current organization name", () => {
  assert.equal(isDemoDataDeletionConfirmed({ confirmation: "FC Sense Saane" }, "FC Sense Saane"), true);
  assert.equal(isDemoDataDeletionConfirmed({ confirmation: "FC Sense" }, "FC Sense Saane"), false);
  assert.equal(isDemoDataDeletionConfirmed(null, "FC Sense Saane"), false);
});

test("tenant audit events use a dedicated text parameter for object IDs", async () => {
  const source = await readFile(new URL("../netlify/functions/tenants.mts", import.meta.url), "utf8");
  const casts = source.match(/'tenant', \$3::text/g) ?? [];
  assert.equal(casts.length, 3);
});

test("example data cleanup is owner-only, scoped and refuses sponsors used by contracts", async () => {
  const source = await readFile(new URL("../netlify/functions/tenants.mts", import.meta.url), "utf8");
  assert.match(source, /hasPermission\(role, "tenant:manage"\)/);
  assert.match(source, /WHERE tenant_id = \$1 AND is_demo_data = true/);
  assert.match(source, /FROM sponsorship_contracts contract/);
  assert.match(source, /'demo_data\.deleted'/);
});
