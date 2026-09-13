import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseOnlinePackageSetting, parseSponsoringCheckout } from "../netlify/functions/_shared/sponsoring-checkout-input.ts";

const valid = {
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  packageVersionId: "223e4567-e89b-42d3-a456-426614174000",
  legalName: "Muster AG",
  street: "Hauptstrasse 1",
  postalCode: "3184",
  city: "Wünnewil",
  website: "https://muster.example",
  contactName: "Maria Muster",
  contactEmail: "KONTAKT@MUSTER.EXAMPLE",
  contactPhone: "+41 26 000 00 00",
  signerName: "Max Muster",
  signerEmail: "SIGNATUR@MUSTER.EXAMPLE",
  signerRole: "Geschäftsführer",
  contractTermsAccepted: true,
  authorityConfirmed: true,
  websiteTrap: "",
  startedAt: 1_000,
};

test("online package activation requires an explicit commercial approval", () => {
  assert.deepEqual(parseOnlinePackageSetting({ enabled: true, acknowledged: false }), { ok: false, error: "online_package_acknowledgement_required" });
  assert.deepEqual(parseOnlinePackageSetting({ enabled: true, acknowledged: true }), { ok: true, value: { enabled: true, acknowledged: true } });
  assert.deepEqual(parseOnlinePackageSetting({ enabled: false }), { ok: true, value: { enabled: false, acknowledged: false } });
});

test("public checkout normalizes identity data and requires both acknowledgements", () => {
  const result = parseSponsoringCheckout(valid, 2_000);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.contactEmail, "kontakt@muster.example");
    assert.equal(result.value.signerEmail, "signatur@muster.example");
  }
  assert.deepEqual(parseSponsoringCheckout({ ...valid, contractTermsAccepted: false }, 2_000), { ok: false, error: "checkout_contract_terms_required" });
  assert.deepEqual(parseSponsoringCheckout({ ...valid, authorityConfirmed: false }, 2_000), { ok: false, error: "checkout_authority_confirmation_required" });
});

test("public checkout uses the contact as signer unless another signer is selected", () => {
  const samePerson = parseSponsoringCheckout({
    ...valid,
    signerIsContact: true,
    signerName: "",
    signerEmail: "",
    signerRole: "",
  }, 2_000);
  assert.equal(samePerson.ok, true);
  if (samePerson.ok) {
    assert.equal(samePerson.value.signerName, "Maria Muster");
    assert.equal(samePerson.value.signerEmail, "kontakt@muster.example");
    assert.equal(samePerson.value.signerRole, "Vertretungsberechtigte Person");
    assert.equal(samePerson.value.signerIsContact, true);
  }

  const anotherPerson = parseSponsoringCheckout({ ...valid, signerIsContact: false }, 2_000);
  assert.equal(anotherPerson.ok, true);
  if (anotherPerson.ok) {
    assert.equal(anotherPerson.value.signerName, "Max Muster");
    assert.equal(anotherPerson.value.signerEmail, "signatur@muster.example");
    assert.equal(anotherPerson.value.signerIsContact, false);
  }
});

test("public checkout rejects bots, instant submissions and manipulated package identifiers", () => {
  assert.deepEqual(parseSponsoringCheckout({ ...valid, websiteTrap: "spam" }, 2_000), { ok: false, error: "sponsoring_checkout_rejected" });
  assert.deepEqual(parseSponsoringCheckout({ ...valid, startedAt: 1_500 }, 2_000), { ok: false, error: "sponsoring_checkout_rejected" });
  assert.deepEqual(parseSponsoringCheckout({ ...valid, packageVersionId: "bronze" }, 2_000), { ok: false, error: "invalid_package_version" });
});

test("direct checkout uses approved catalog values and the existing signing mechanisms", async () => {
  const source = await readFile(new URL("../netlify/functions/sponsoring-checkout-public.mts", import.meta.url), "utf8");
  assert.match(source, /sponsorship_package_online_settings online/);
  assert.match(source, /online\.is_enabled/);
  assert.match(source, /version\.price_cents/);
  assert.doesNotMatch(source, /annualValueCents: parsed\.value/);
  assert.match(source, /source\s*\) VALUES[\s\S]*'public_checkout'/);
  assert.match(source, /contractSnapshotHash/);
  assert.match(source, /ensureDirectReservation/);
  assert.match(source, /findIdentityUserByEmail/);
  assert.match(source, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(source, /createHash\("sha256"\)\.update\(rawToken\)/);
  assert.match(source, /sendContractSigningEmail/);
  assert.match(source, /checkout_rate_limited/);
});

test("admin and public UI expose approval, public link and online contract provenance", async () => {
  const packages = await readFile(new URL("../src/PackageManagement.tsx", import.meta.url), "utf8");
  const dossier = await readFile(new URL("../src/SponsoringDossier.tsx", import.meta.url), "utf8");
  const contracts = await readFile(new URL("../src/ContractManagement.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const checkout = await readFile(new URL("../src/SponsoringCheckoutPublic.tsx", import.meta.url), "utf8");
  assert.match(packages, /Online-Direktabschluss/);
  assert.match(packages, /Preis, Laufzeit und sämtliche Leistungen geprüft/);
  assert.match(dossier, /\/sponsoring\/\$\{data\.checkout\.publicKey\}/);
  assert.match(contracts, /Online-Direktabschluss/);
  assert.match(app, /\^\\\/sponsoring\\\//);
  assert.match(checkout, /Eine andere Person unterzeichnet den Vertrag/);
  assert.match(checkout, /Standardmässig erhält diese Kontaktperson den Vertrag/);
  assert.match(checkout, /signerIsContact: !differentSigner/);
  assert.doesNotMatch(checkout, /type="file"/);
});
