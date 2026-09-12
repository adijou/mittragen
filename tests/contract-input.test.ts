import assert from "node:assert/strict";
import test from "node:test";
import {
  parseContractAcknowledgement,
  parseContractConfirmation,
  parseContractCreate,
  parseContractDispatch,
  parseContractRelease,
  parseContractSettings,
  parseContractUpdate,
} from "../netlify/functions/_shared/contract-input.ts";

const transitionSponsorId = "123e4567-e89b-42d3-a456-426614174000";
const sponsorId = "223e4567-e89b-42d3-a456-426614174000";
const packageVersionId = "323e4567-e89b-42d3-a456-426614174000";

test("contract settings accept a complete manual-renewal configuration", () => {
  const result = parseContractSettings({
    legalName: "FC Sense-Mitte",
    street: "Sportplatzweg 1",
    postalCode: "3184",
    city: "Wünnewil",
    country: "Schweiz",
    representativeName: "Maria Muster",
    representativeTitle: "Präsidentin",
    contactEmail: "sponsoring@example.ch",
    renewalMode: "manual",
    noticeMonths: null,
    placeOfJurisdiction: "Tafers",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.noticeMonths, null);
});

test("automatic renewal requires a valid notice period", () => {
  const result = parseContractSettings({ country: "Schweiz", renewalMode: "annual_auto", noticeMonths: null });
  assert.deepEqual(result, { ok: false, error: "notice_months_required" });
});

test("contract creation and draft updates reject malformed data", () => {
  assert.deepEqual(parseContractCreate({ transitionSponsorId }), { ok: true, value: { mode: "transition", transitionSponsorId } });
  assert.deepEqual(parseContractCreate({ transitionSponsorId: "wrong" }), { ok: false, error: "invalid_transition_sponsor" });
  assert.deepEqual(parseContractUpdate({ title: "", specialAgreements: "Keine.", signingMethod: "click" }), { ok: false, error: "invalid_contract_title" });
  assert.equal(parseContractUpdate({ title: "Sponsoringvertrag", specialAgreements: "Keine.", signingMethod: "click" }).ok, true);
});

test("contract creation accepts a direct sponsor and package selection", () => {
  assert.deepEqual(parseContractCreate({ sponsorId, packageVersionId, annualValueCents: 100_000 }), {
    ok: true,
    value: { mode: "direct", sponsorId, packageVersionId, annualValueCents: 100_000 },
  });
  assert.deepEqual(parseContractCreate({ sponsorId: "wrong", packageVersionId, annualValueCents: 100_000 }), { ok: false, error: "invalid_sponsor" });
  assert.deepEqual(parseContractCreate({ sponsorId, packageVersionId: "wrong", annualValueCents: 100_000 }), { ok: false, error: "invalid_package_version" });
  assert.deepEqual(parseContractCreate({ sponsorId, packageVersionId, annualValueCents: -1 }), { ok: false, error: "invalid_annual_value" });
  assert.deepEqual(parseContractCreate({ sponsorId, packageVersionId, annualValueCents: 1.5 }), { ok: false, error: "invalid_annual_value" });
});

test("release and sponsor confirmation require explicit acknowledgement", () => {
  assert.deepEqual(parseContractRelease({ legalReviewAcknowledged: false }), { ok: false, error: "legal_review_acknowledgement_required" });
  assert.equal(parseContractRelease({ legalReviewAcknowledged: true }).ok, true);
  assert.deepEqual(parseContractConfirmation({ signingAuthorityName: "Max Muster", signingAuthorityRole: "Geschäftsführer", acknowledged: false }), { ok: false, error: "contract_acknowledgement_required" });
  assert.equal(parseContractConfirmation({ signingAuthorityName: "Max Muster", signingAuthorityRole: "Geschäftsführer", acknowledged: true }).ok, true);
});

test("contract dispatch validates and normalizes the designated signer", () => {
  assert.deepEqual(parseContractDispatch({ signerEmail: " SIGNER@Example.CH ", signerName: "Max Muster", signerRole: "Geschäftsführer" }), {
    ok: true,
    value: { signerEmail: "signer@example.ch", signerName: "Max Muster", signerRole: "Geschäftsführer" },
  });
  assert.deepEqual(parseContractDispatch({ signerEmail: "wrong", signerName: "Max Muster", signerRole: "Geschäftsführer" }), { ok: false, error: "invalid_signer_email" });
  assert.deepEqual(parseContractDispatch({ signerEmail: "signer@example.ch", signerName: "", signerRole: "Geschäftsführer" }), { ok: false, error: "signer_name_required" });
});

test("account and one-time confirmation both require explicit acknowledgement", () => {
  assert.deepEqual(parseContractAcknowledgement({ acknowledged: false }), { ok: false, error: "contract_acknowledgement_required" });
  assert.deepEqual(parseContractAcknowledgement({ acknowledged: true }), { ok: true, value: { acknowledged: true } });
});
