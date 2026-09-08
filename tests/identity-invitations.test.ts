import assert from "node:assert/strict";
import test from "node:test";
import { IdentityInvitationError, postIdentityInvitation } from "../netlify/functions/_shared/identity-invitations.ts";

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
