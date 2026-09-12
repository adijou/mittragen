import assert from "node:assert/strict";
import test from "node:test";
import { buildSponsorInvitationEmail, sendSponsorInvitationEmail } from "../netlify/functions/_shared/resend-sponsor-invitation.ts";

const input = {
  email: "person@example.invalid",
  sponsorName: "Testsponsor",
  organizationName: "Testorganisation",
  campaignName: "Testkampagne",
  packageName: "Testpaket",
  sourceValueCents: 0,
  proposedValueCents: 0,
  responseDeadline: "2026-09-30",
  portalUrl: "https://example.invalid/portal",
};

test("sponsor invitation is branded and explains all four paths", () => {
  const email = buildSponsorInvitationEmail(input);
  assert.equal(email.subject, "Ihr Sponsoringvorschlag von Testorganisation");
  assert.match(email.text, /annehmen, eine Alternative wählen, Beratung anfragen oder ablehnen/i);
  assert.match(email.html, /mittragen<span[^>]*>\.ch<\/span>/i);
  assert.match(email.html, /Testsponsor/);
  assert.match(email.text, /verbindlich.*ausdrücklichen Bestätigung/i);
});

test("sponsor invitation uses Resend and returns its message id", async () => {
  let payload: Record<string, unknown> = {};
  const id = await sendSponsorInvitationEmail(input, {
    apiKey: "unit-test",
    from: "Product Test <sender@example.invalid>",
    fetcher: async (_url, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "test-message" });
    },
  });
  assert.equal(id, "test-message");
  assert.deepEqual(payload.to, ["person@example.invalid"]);
  assert.equal(payload.from, "Product Test <sender@example.invalid>");
});
