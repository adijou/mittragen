import assert from "node:assert/strict";
import test from "node:test";
import { findIdentityUserByEmail, type IdentityAdmin } from "../netlify/functions/_shared/identity-user-lookup.ts";

test("identity lookup matches an existing account without case sensitivity", async () => {
  const fakeAdmin = {
    listUsers: async () => [{ id: "identity-1", email: "Signer@Example.CH" }],
  } as unknown as IdentityAdmin;
  const user = await findIdentityUserByEmail("signer@example.ch", fakeAdmin);
  assert.equal(user?.id, "identity-1");
});

test("identity lookup reports a missing account", async () => {
  const fakeAdmin = { listUsers: async () => [] } as unknown as IdentityAdmin;
  assert.equal(await findIdentityUserByEmail("missing@example.ch", fakeAdmin), null);
});
