import assert from "node:assert/strict";
import test from "node:test";
import { buildContractSigningEmail, sendContractCopyEmail, sendContractSigningEmail } from "../netlify/functions/_shared/resend-contract-email.ts";

const input = {
  email: "signer@example.ch",
  signerName: "Max <Muster>",
  organizationName: "FC Sense Saane",
  sponsorName: "Helvetia",
  contractNumber: "MT-2026-0001",
  packageName: "Bronze",
  annualValueCents: 100000,
  confirmationUrl: "https://mittragen.ch/unterzeichnen?token=safe-token",
  deliveryMode: "one_time" as const,
  expiresAt: "2026-09-19T12:00:00.000Z",
};

test("one-time contract email explains expiry and escapes recipient content", () => {
  const email = buildContractSigningEmail(input);
  assert.match(email.subject, /MT-2026-0001/);
  assert.match(email.text, /Einmallink/i);
  assert.match(email.html, /Max &lt;Muster&gt;/);
  assert.doesNotMatch(email.html, /Max <Muster>/);
});

test("account contract email asks the identified user to sign in", () => {
  const email = buildContractSigningEmail({ ...input, deliveryMode: "account", confirmationUrl: "https://mittragen.ch/sponsor" });
  assert.match(email.text, /bestehenden Mittragen-Konto/i);
  assert.match(email.html, /Anmelden und bestätigen/);
});

test("contract delivery uses Resend and PDF copies carry an attachment", async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const config = {
    apiKey: "test-key",
    from: "Mittragen <noreply@news.mittragen.ch>",
    fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ id: `email-${payloads.length}` });
    },
  };
  assert.equal(await sendContractSigningEmail(input, config), "email-1");
  assert.equal(await sendContractCopyEmail({
    email: input.email, signerName: input.signerName, organizationName: input.organizationName,
    sponsorName: input.sponsorName, contractNumber: input.contractNumber, packageName: input.packageName,
    annualValueCents: input.annualValueCents, pdfBase64: "JVBERi0xLjQ=",
  }, config), "email-2");
  assert.deepEqual(payloads[0].to, [input.email]);
  assert.deepEqual(payloads[1].attachments, [{ filename: "Sponsoringvertrag_MT-2026-0001.pdf", content: "JVBERi0xLjQ=" }]);
});
