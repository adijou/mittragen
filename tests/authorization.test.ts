import assert from "node:assert/strict";
import test from "node:test";
import { hasPermission, permissionsFor, type MembershipRole } from "../netlify/functions/_shared/permissions.ts";

test("only owners can manage tenants and memberships", () => {
  const roles: MembershipRole[] = ["owner", "sponsoring_admin", "finance", "fulfillment", "viewer"];
  for (const role of roles) {
    assert.equal(hasPermission(role, "tenant:manage"), role === "owner");
    assert.equal(hasPermission(role, "members:manage"), role === "owner");
  }
});

test("finance and fulfillment rights remain separated", () => {
  assert.equal(hasPermission("finance", "finance:write"), true);
  assert.equal(hasPermission("finance", "sponsors:write"), false);
  assert.equal(hasPermission("fulfillment", "fulfillment:write"), true);
  assert.equal(hasPermission("fulfillment", "finance:write"), false);
});

test("returned permission arrays cannot mutate the role matrix", () => {
  const ownerPermissions = permissionsFor("owner");
  ownerPermissions.length = 0;
  assert.equal(hasPermission("owner", "tenant:manage"), true);
});

