import assert from "node:assert/strict";
import test from "node:test";
import { deliverIdentityInvitation, IdentityInvitationError, postIdentityInvitation, postIdentityRecovery } from "../netlify/functions/_shared/identity-invitations.ts";

test("identity invitations use the server operator token and normalized endpoint", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const delivery = await postIdentityInvitation({ url: "https://mittragen.ch/.netlify/identity/", token: "operator-secret" }, "person@example.ch", async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return Response.json({ id: "invited-user" });
  });

  assert.equal(delivery, "sent");
  assert.equal(requestedUrl, "https://mittragen.ch/.netlify/identity/invite");
  assert.equal((requestedInit?.headers as Record<string, string>).Authorization, "Bearer operator-secret");
  assert.equal(requestedInit?.body, JSON.stringify({ email: "person@example.ch" }));
});

test("an existing Identity account remains a valid tenant invitation", async () => {
  const delivery = await postIdentityInvitation({ url: "https://mittragen.ch/.netlify/identity", token: "operator-secret" }, "person@example.ch", async () => Response.json({ msg: "A user with this email address has already been registered" }, { status: 422 }));
  assert.equal(delivery, "existing_user");
});

test("other Identity delivery errors are surfaced without exposing the operator token", async () => {
  await assert.rejects(
    postIdentityInvitation({ url: "https://mittragen.ch/.netlify/identity", token: "operator-secret" }, "person@example.ch", async () => Response.json({ msg: "mail provider unavailable" }, { status: 503 })),
    (error: unknown) => error instanceof IdentityInvitationError && error.status === 503,
  );
});

test("a new invite, verified existing account and unconfirmed existing account take distinct paths", async () => {
  const email = "person@example.invalid";
  for (const scenario of ["new", "verified", "unconfirmed"] as const) {
    const calls: string[] = [];
    const result = await deliverIdentityInvitation(email, {
      invite: async (recipient) => { assert.equal(recipient, email); calls.push("invite"); return scenario === "new" ? "sent" : "existing_user"; },
      findUser: async (recipient) => { assert.equal(recipient, email); calls.push("lookup"); return {
        id: "existing-user", email, ...(scenario === "verified" ? { confirmedAt: "2026-09-29T12:00:00Z" } : {}),
      }; },
      recover: async (recipient) => { assert.equal(recipient, email); calls.push("recovery"); },
    });
    assert.equal(result, scenario === "verified" ? "existing_user" : "sent");
    assert.deepEqual(calls, scenario === "new" ? ["invite"] : scenario === "verified" ? ["invite", "lookup"] : ["invite", "lookup", "recovery"]);
  }
});

test("failed or mismatched account lookup never sends a recovery email", async () => {
  for (const user of [null, { id: "other", email: "other@example.invalid" }]) {
    let recovered = false;
    await assert.rejects(deliverIdentityInvitation("person@example.invalid", {
      invite: async () => "existing_user", findUser: async () => user,
      recover: async () => { recovered = true; },
    }), /identity_user_lookup_failed/);
    assert.equal(recovered, false);
  }
});

test("recovery rejection remains a failed invitation, not a successful delivery", async () => {
  await assert.rejects(deliverIdentityInvitation("person@example.invalid", {
    invite: async () => "existing_user",
    findUser: async () => ({ id: "pending", email: "person@example.invalid" }),
    recover: async () => { throw new IdentityInvitationError("identity_recovery_failed", 429); },
  }), (error: unknown) => error instanceof IdentityInvitationError && error.status === 429);
});

test("recovery uses the configured Identity endpoint without exposing the operator token", async () => {
  await postIdentityRecovery({ url: "https://example.invalid/.netlify/identity/", token: "operator-secret" }, "person@example.invalid", async (url, init) => {
    assert.equal(String(url), "https://example.invalid/.netlify/identity/recover");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { email: "person@example.invalid" });
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json({});
  });
  await assert.rejects(postIdentityRecovery({ url: "https://example.invalid/.netlify/identity" }, "person@example.invalid", async () => new Response(null, { status: 503 })));
});
