import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("direct contracts preserve the negotiated value and reserve capacity only on release", async () => {
  const source = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const collectionStart = source.indexOf("if (routes.collection.test(pathname))");
  const releaseStart = source.indexOf("if (routes.release.test(pathname)");
  const createFlow = source.slice(collectionStart, releaseStart);
  const releaseFlow = source.slice(releaseStart);

  assert.match(source, /\$4::integer AS contract_value_cents/);
  assert.match(source, /priceCents: source\.contract_value_cents/);
  assert.match(createFlow, /parsed\.value\.mode === "transition" \? parsed\.value\.transitionSponsorId : null/);
  assert.doesNotMatch(createFlow, /ensureDirectReservation/);
  assert.match(releaseFlow, /source\.mode === "direct" && !await ensureDirectReservation/);
  assert.match(source, /package_capacity_exceeded/);
  assert.match(source, /package_exclusivity_conflict/);
});

test("sponsor editing no longer exposes package assignment fields", async () => {
  const source = await readFile(new URL("../src/SponsorDirectory.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, />Zugeordnetes Paket</);
  assert.doesNotMatch(source, />Jahreswert in CHF</);
  assert.match(source, /Paket und Jahreswert werden im Vertragscenter ausgewählt/);
});

test("contract confirmation automatically separates identified accounts from one-time links", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const publicSigning = await readFile(new URL("../netlify/functions/contract-signing.mts", import.meta.url), "utf8");
  assert.match(contracts, /findIdentityUserByEmail/);
  assert.match(contracts, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(contracts, /createHash\("sha256"\)\.update\(rawToken\)/);
  assert.match(contracts, /contract_signer_locked/);
  assert.match(contracts, /delivery_mode !== "account"/);
  assert.match(publicSigning, /delivery_mode !== "one_time"/);
  assert.match(publicSigning, /status = 'confirmed'/);
  assert.match(publicSigning, /confirmation_mode','one_time_link'/);
});

test("access creation and PDF delivery remain explicit admin follow-up actions", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  assert.match(contracts, /\/access\$/);
  assert.match(contracts, /sendIdentityInvitation/);
  assert.match(contracts, /\/email-copy\$/);
  assert.match(contracts, /sendContractCopyEmail/);
});

test("every contract PDF path loads the current organization branding", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const publicSigning = await readFile(new URL("../netlify/functions/contract-signing.mts", import.meta.url), "utf8");
  assert.match(contracts, /loadOrganizationPdfBrand/);
  assert.match(contracts, /pdfData\(detail\.contract, brand\)/);
  assert.match(contracts, /pdfData\(contract, authorized\.brand\)/);
  assert.match(publicSigning, /pdfData\(contract, brand\)/);
});
