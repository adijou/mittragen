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
  assert.match(contracts, /contract_identity_lookup_failed/);
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

test("legacy contracts can be closed by an authorized admin without email delivery", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const routeStart = contracts.indexOf("if (routes.adminConfirm.test(pathname)");
  const routeEnd = contracts.indexOf("if (routes.access.test(pathname)", routeStart);
  const adminFlow = contracts.slice(routeStart, routeEnd);

  assert.notEqual(routeStart, -1);
  assert.match(adminFlow, /hasPermission\(role, "packages:write"\)/);
  assert.match(adminFlow, /confirmation_mode = 'admin_legacy'/);
  assert.match(adminFlow, /event_type, actor_user_id, actor_email, evidence/);
  assert.match(adminFlow, /'admin_confirmed'/);
  assert.match(adminFlow, /status = 'revoked'/);
  assert.doesNotMatch(adminFlow, /sendContractSigningEmail/);
  assert.doesNotMatch(adminFlow, /emailConfig\(/);
});

test("legacy contracts can be created directly without the digital release and delivery flow", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const management = await readFile(new URL("../src/ContractManagement.tsx", import.meta.url), "utf8");
  const routeStart = contracts.indexOf("if (routes.legacyCreate.test(pathname)");
  const routeEnd = contracts.indexOf("if (routes.collection.test(pathname)", routeStart);
  const legacyCreateFlow = contracts.slice(routeStart, routeEnd);

  assert.notEqual(routeStart, -1);
  assert.match(legacyCreateFlow, /parseLegacyContractCreate/);
  assert.match(legacyCreateFlow, /hasPermission\(role, "packages:write"\)/);
  assert.match(legacyCreateFlow, /ensureDirectReservation/);
  assert.match(legacyCreateFlow, /'confirmed','click'/);
  assert.match(legacyCreateFlow, /'admin_legacy'/);
  assert.match(legacyCreateFlow, /contract\.admin_legacy_created/);
  assert.doesNotMatch(legacyCreateFlow, /sponsorComplete/);
  assert.doesNotMatch(legacyCreateFlow, /sendContractSigningEmail/);
  assert.doesNotMatch(legacyCreateFlow, /emailConfig\(/);
  assert.match(management, /Altvertrag für einen Sponsor erfassen/);
  assert.match(management, /\/api\/contracts\/\$\{tenantId\}\/legacy/);
  assert.match(management, /Es wird keine Bestätigungs- oder sonstige E-Mail versendet/);
});

test("every contract PDF path loads the current organization branding", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const publicSigning = await readFile(new URL("../netlify/functions/contract-signing.mts", import.meta.url), "utf8");
  assert.match(contracts, /loadOrganizationPdfBrand/);
  assert.match(contracts, /pdfData\(detail\.contract, brand\)/);
  assert.match(contracts, /pdfData\(contract, authorized\.brand\)/);
  assert.match(publicSigning, /pdfData\(contract, brand\)/);
});

test("draft contracts can update sponsor, package, negotiated value and document text", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const management = await readFile(new URL("../src/ContractManagement.tsx", import.meta.url), "utf8");
  const updateStart = contracts.indexOf('if (routes.detail.test(pathname) && request.method === "PATCH")');
  const updateEnd = contracts.indexOf("if (routes.revision.test(pathname)", updateStart);
  const updateFlow = contracts.slice(updateStart, updateEnd);

  assert.match(updateFlow, /buildSnapshots\(client, tenantId, parsed\.value, preservesExistingSelection\)/);
  assert.match(updateFlow, /sponsor_id = \$3/);
  assert.match(updateFlow, /package_version_id = \$4/);
  assert.match(updateFlow, /package_snapshot = \$11::jsonb/);
  assert.match(updateFlow, /WHERE tenant_id = \$1 AND id = \$2 AND status = 'draft'/);
  assert.match(management, /selectDraftPackage/);
  assert.match(management, /draftAnnualValue/);
});

test("released contracts use linked correction versions instead of in-place mutation", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const revisionStart = contracts.indexOf("if (routes.revision.test(pathname)");
  const revisionEnd = contracts.indexOf("if (routes.void.test(pathname)", revisionStart);
  const revisionFlow = contracts.slice(revisionStart, revisionEnd);
  const releaseStart = contracts.indexOf("if (routes.release.test(pathname)");
  const releaseEnd = contracts.indexOf("if (routes.send.test(pathname)", releaseStart);
  const releaseFlow = contracts.slice(releaseStart, releaseEnd);

  assert.match(revisionFlow, /parent_contract_id/);
  assert.match(revisionFlow, /existing\.contract\.version_number \+ 1/);
  assert.match(revisionFlow, /'contract\.revision_created'/);
  assert.doesNotMatch(revisionFlow, /sendContractSigningEmail/);
  assert.match(releaseFlow, /existing\.contract\.parent_contract_id/);
  assert.match(releaseFlow, /'contract\.replaced'/);
  assert.match(releaseFlow, /status = 'void'/);
});

test("draft deletion and released-contract voiding are separate audited operations", async () => {
  const contracts = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const management = await readFile(new URL("../src/ContractManagement.tsx", import.meta.url), "utf8");
  const removeStart = contracts.indexOf("if (routes.void.test(pathname)");
  const removeEnd = contracts.indexOf("if (routes.release.test(pathname)", removeStart);
  const removeFlow = contracts.slice(removeStart, removeEnd);

  assert.match(removeFlow, /contract\.status === "draft"/);
  assert.match(removeFlow, /DELETE FROM sponsorship_contract_events/);
  assert.match(removeFlow, /DELETE FROM sponsorship_contracts/);
  assert.match(removeFlow, /'contract\.draft_deleted'/);
  assert.match(removeFlow, /status = 'void', voided_at = now\(\)/);
  assert.match(removeFlow, /'contract\.voided'/);
  assert.match(removeFlow, /releaseReservationIfUnused/);
  assert.match(management, /Archivierte Verträge/);
  assert.match(management, /Entwurf endgültig löschen/);
  assert.match(management, /Vertrag nachvollziehbar aufheben/);
});
