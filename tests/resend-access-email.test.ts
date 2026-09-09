import assert from "node:assert/strict";
import test from "node:test";
import { ResendDeliveryError, sendExistingUserAccessEmail } from "../netlify/functions/_shared/resend-access-email.ts";

test("existing Identity users receive a branded access email through Resend", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;

  const id = await sendExistingUserAccessEmail({
    email: "person@example.ch",
    organizationName: "FC A & FC <B>",
    roleLabel: "Sponsoringleistungen",
    loginUrl: "https://mittragen.ch/login",
  }, {
    apiKey: "resend-secret",
    from: "Mittragen <noreply@news.mittragen.ch>",
    replyTo: "support@mittragen.ch",
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return Response.json({ id: "email_123" });
    },
  });

  assert.equal(id, "email_123");
  assert.equal(requestedUrl, "https://api.resend.com/emails");
  assert.equal((requestedInit?.headers as Record<string, string>).Authorization, "Bearer resend-secret");

  const payload = JSON.parse(String(requestedInit?.body)) as Record<string, unknown>;
  assert.equal(payload.from, "Mittragen <noreply@news.mittragen.ch>");
  assert.deepEqual(payload.to, ["person@example.ch"]);
  assert.equal(payload.reply_to, "support@mittragen.ch");
  assert.match(String(payload.subject), /FC A & FC <B>/);
  assert.match(String(payload.html), /FC A &amp; FC &lt;B&gt;/);
  assert.doesNotMatch(String(payload.html), /resend-secret/);
  assert.match(String(payload.text), /https:\/\/mittragen\.ch\/login/);
});

test("Resend API errors are surfaced without including response content", async () => {
  await assert.rejects(
    sendExistingUserAccessEmail({
      email: "person@example.ch",
      organizationName: "FC Beispiel",
      roleLabel: "Finanzen",
      loginUrl: "https://mittragen.ch/login",
    }, {
      apiKey: "resend-secret",
      from: "Mittragen <noreply@news.mittragen.ch>",
      fetcher: async () => Response.json({ message: "sensitive provider response" }, { status: 403 }),
    }),
    (error: unknown) => error instanceof ResendDeliveryError && error.status === 403 && error.message === "resend_403",
  );
});
