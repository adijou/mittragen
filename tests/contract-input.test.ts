import assert from "node:assert/strict";
import test from "node:test";
import {
  parseContractConfirmation,
  parseContractCreate,
  parseContractRelease,
  parseContractSettings,
  parseContractUpdate,
} from "../netlify/functions/_shared/contract-input.ts";

const transitionSponsorId = "123e4567-e89b-42d3-a456-426614174000";

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
  assert.deepEqual(parseContractCreate({ transitionSponsorId }), { ok: true, value: { transitionSponsorId } });
  assert.deepEqual(parseContractCreate({ transitionSponsorId: "wrong" }), { ok: false, error: "invalid_transition_sponsor" });
  assert.deepEqual(parseContractUpdate({ title: "", specialAgreements: "Keine.", signingMethod: "click" }), { ok: false, error: "invalid_contract_title" });
  assert.equal(parseContractUpdate({ title: "Sponsoringvertrag", specialAgreements: "Keine.", signingMethod: "click" }).ok, true);
});

test("release and sponsor confirmation require explicit acknowledgement", () => {
  assert.deepEqual(parseContractRelease({ legalReviewAcknowledged: false }), { ok: false, error: "legal_review_acknowledgement_required" });
  assert.equal(parseContractRelease({ legalReviewAcknowledged: true }).ok, true);
  assert.deepEqual(parseContractConfirmation({ signingAuthorityName: "Max Muster", signingAuthorityRole: "Geschäftsführer", acknowledged: false }), { ok: false, error: "contract_acknowledgement_required" });
  assert.equal(parseContractConfirmation({ signingAuthorityName: "Max Muster", signingAuthorityRole: "Geschäftsführer", acknowledged: true }).ok, true);
});
