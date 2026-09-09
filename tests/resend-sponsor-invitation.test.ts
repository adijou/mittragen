import assert from "node:assert/strict";
import test from "node:test";
import { buildSponsorInvitationEmail, sendSponsorInvitationEmail } from "../netlify/functions/_shared/resend-sponsor-invitation.ts";

const input = {
  email: "kontakt@example.ch",
  sponsorName: "Muster & Partner AG",
  organizationName: "FC Alpenblick",
  campaignName: "Neue Saison",
  packageName: "Gold",
  sourceValueCents: 400000,
  proposedValueCents: 500000,
  responseDeadline: "2026-09-30",
  portalUrl: "https://mittragen.ch/sponsor",
};

test("sponsor invitation is branded and explains all four paths", () => {
  const email = buildSponsorInvitationEmail(input);
  assert.equal(email.subject, "Ihr Sponsoringvorschlag von FC Alpenblick");
  assert.match(email.text, /annehmen, eine Alternative wählen, Beratung anfragen oder ablehnen/i);
  assert.match(email.html, /MITTRAGEN/);
  assert.match(email.html, /Muster &amp; Partner AG/);
  assert.match(email.text, /verbindlich.*ausdrücklichen Bestätigung/i);
});

test("sponsor invitation uses Resend and returns its message id", async () => {
  let payload: Record<string, unknown> = {};
  const id = await sendSponsorInvitationEmail(input, {
    apiKey: "test-key",
    from: "Mittragen <noreply@news.mittragen.ch>",
    fetcher: async (_url, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "email-123" });
    },
  });
  assert.equal(id, "email-123");
  assert.deepEqual(payload.to, ["kontakt@example.ch"]);
  assert.equal(payload.from, "Mittragen <noreply@news.mittragen.ch>");
});
