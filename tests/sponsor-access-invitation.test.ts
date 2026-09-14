import assert from "node:assert/strict";
import test from "node:test";
import { parseSponsorAccessInvitation } from "../netlify/functions/_shared/sponsor-access-invitations.ts";
import { buildSponsorSpaceInvitationEmail, sendSponsorSpaceInvitationEmail } from "../netlify/functions/_shared/resend-contract-email.ts";

test("direct sponsor invitation accepts one normalized recipient and no access or role overrides", () => {
  assert.deepEqual(parseSponsorAccessInvitation({ email: " Contact@Example.invalid " }), { ok: true, email: "contact@example.invalid" });
  for (const email of ["", "missing-at", "two@example.invalid; other@example.invalid", "bad\n@example.invalid", "a".repeat(321) + "@example.invalid", null]) {
    assert.equal(parseSponsorAccessInvitation({ email }).ok, false);
  }
  for (const field of ["tenant_id", "sponsor_id", "role", "identity_user_id", "accepted_at"]) {
    assert.equal(parseSponsorAccessInvitation({ email: "contact@example.invalid", [field]: "injected" }).ok, false);
  }
});

const invitation = {
  email: "contact@example.invalid", sponsorName: "Sponsor <Test>", organizationName: "Verein & Region",
  portalUrl: "https://example.invalid/sponsor", expiresAt: "2026-09-21T12:00:00Z",
};

test("direct sponsor email explains both account creation and existing login without assuming a signed contract", () => {
  const email = buildSponsorSpaceInvitationEmail(invitation);
  assert.match(email.html, /Sponsor &lt;Test&gt;/);
  assert.match(email.html, /Verein &amp; Region/);
  assert.match(email.html, /Konto erstellen/);
  assert.match(email.text, /Falls bereits ein Konto besteht/);
  assert.match(email.text, /contact@example.invalid/);
  assert.match(email.text, /keinen neuen Sponsoringvertrag/);
  assert.doesNotMatch(email.text, /Konto wurde.*verbunden/);
});

test("a sponsor invitation is sent to the reviewed address and only a provider receipt counts as successful", async () => {
  const config = { apiKey: "fake-test-key", from: "Test <sender@example.invalid>", replyTo: "club@example.invalid" };
  let payload: Record<string, unknown> = {};
  const result = await sendSponsorSpaceInvitationEmail(invitation, { ...config, fetcher: async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({ id: "fake-provider-receipt" });
  } });
  assert.equal(result, "fake-provider-receipt");
  assert.deepEqual(payload.to, [invitation.email]);
  assert.equal(payload.reply_to, config.replyTo);
  for (const response of [Response.json({ error: "unavailable" }, { status: 503 }), Response.json({})]) {
    await assert.rejects(sendSponsorSpaceInvitationEmail(invitation, { ...config, fetcher: async () => response }));
  }
});
