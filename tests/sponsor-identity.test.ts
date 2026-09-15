import assert from "node:assert/strict";
import test from "node:test";
import { verifySponsorIdentity } from "../netlify/functions/_shared/sponsor-identity.ts";

const claims = { id: "6e696c73-e3a2-435b-94e7-7b4e7a26d088", email: "sponsor@example.invalid" };
const confirmedAt = "2026-09-15T06:00:00Z";
const profile = { id: claims.id, email: claims.email, confirmed_at: confirmedAt };
const endpoint = "https://identity.example.invalid/.netlify/identity";

test("a verified sponsor is recovered from incomplete server JWT claims using their own session", async () => {
  let called = 0;
  const result = await verifySponsorIdentity(claims, "test-user-token", endpoint, async (url, init) => {
    called++;
    assert.equal(url, `${endpoint}/user`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-user-token");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return Response.json(profile);
  });
  assert.equal(called, 1);
  assert.deepEqual(result, { user: { ...claims, confirmedAt } });
});

test("an already complete verified Identity profile needs no further call", async () => {
  const user = { ...claims, confirmedAt };
  assert.deepEqual(await verifySponsorIdentity(user, undefined, undefined, async () => {
    throw new Error("must not request");
  }), { user });
});

test("actual unconfirmed accounts remain blocked despite a valid login token or editable metadata", async () => {
  for (const confirmed_at of [null, undefined, "", "invalid", false]) {
    assert.deepEqual(await verifySponsorIdentity(claims, "test-user-token", endpoint, async () => Response.json({
      ...profile, confirmed_at, user_metadata: { confirmed_at: confirmedAt, email_verified: true },
    })), { error: "verified_email_required", status: 422 });
  }
});

test("another identity or a stale email cannot acquire sponsor access", async () => {
  for (const different of [{ ...profile, id: "different-user" }, { ...profile, email: "other@example.invalid" }]) {
    assert.deepEqual(await verifySponsorIdentity(claims, "test-user-token", endpoint, async () => Response.json(different)),
      { error: "authentication_required", status: 401 });
  }
  assert.ok((await verifySponsorIdentity(claims, "test-user-token", endpoint,
    async () => Response.json({ ...profile, email: "Sponsor@Example.invalid" }))).user);
});

test("Identity outages and invalid sessions are distinct from unconfirmed email", async () => {
  for (const fetcher of [async () => Response.json({}, { status: 503 }), async () => Response.json(null),
    async () => { throw new Error("request timed out with a private provider message"); }]) {
    assert.deepEqual(await verifySponsorIdentity(claims, "test-user-token", endpoint, fetcher),
      { error: "identity_verification_unavailable", status: 503 });
  }
  for (const status of [401, 403]) {
    assert.deepEqual(await verifySponsorIdentity(claims, "test-user-token", endpoint, async () => Response.json({}, { status })),
      { error: "authentication_required", status: 401 });
  }
  assert.deepEqual(await verifySponsorIdentity(claims, undefined, endpoint), { error: "authentication_required", status: 401 });
  assert.deepEqual(await verifySponsorIdentity(claims, "test-user-token", undefined), { error: "identity_verification_unavailable", status: 503 });
});
