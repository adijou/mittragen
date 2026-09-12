import { isUuid } from "./database.ts";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type RenewalMode = "manual" | "annual_auto";
export type SigningMethod = "click" | "advanced" | "qualified";

function optionalText(value: unknown, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : undefined;
}

export function parseContractSettings(body: unknown): Result<{
  legalName: string | null; street: string | null; postalCode: string | null; city: string | null;
  country: string; representativeName: string | null; representativeTitle: string | null;
  contactEmail: string | null; renewalMode: RenewalMode; noticeMonths: number | null;
  placeOfJurisdiction: string | null;
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const legalName = optionalText(record.legalName, 160);
  const street = optionalText(record.street, 160);
  const postalCode = optionalText(record.postalCode, 20);
  const city = optionalText(record.city, 120);
  const country = optionalText(record.country, 120);
  const representativeName = optionalText(record.representativeName, 160);
  const representativeTitle = optionalText(record.representativeTitle, 120);
  const contactEmail = optionalText(record.contactEmail, 254);
  const placeOfJurisdiction = optionalText(record.placeOfJurisdiction, 160);
  for (const [key, value] of Object.entries({ legalName, street, postalCode, city, country, representativeName, representativeTitle, contactEmail, placeOfJurisdiction })) {
    if (value === undefined) return { ok: false, error: `invalid_${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}` };
  }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return { ok: false, error: "invalid_contact_email" };
  if (record.renewalMode !== "manual" && record.renewalMode !== "annual_auto") return { ok: false, error: "invalid_renewal_mode" };
  const noticeMonths = record.renewalMode === "annual_auto" && Number.isSafeInteger(record.noticeMonths) && Number(record.noticeMonths) >= 1 && Number(record.noticeMonths) <= 12
    ? Number(record.noticeMonths)
    : null;
  if (record.renewalMode === "annual_auto" && noticeMonths === null) return { ok: false, error: "notice_months_required" };
  return { ok: true, value: {
    legalName: legalName ?? null, street: street ?? null, postalCode: postalCode ?? null, city: city ?? null,
    country: country ?? "Schweiz", representativeName: representativeName ?? null,
    representativeTitle: representativeTitle ?? null, contactEmail: contactEmail ?? null,
    renewalMode: record.renewalMode, noticeMonths, placeOfJurisdiction: placeOfJurisdiction ?? null,
  } };
}

export type ContractCreateInput =
  | { mode: "transition"; transitionSponsorId: string }
  | { mode: "direct"; sponsorId: string; packageVersionId: string; annualValueCents: number };

export function parseContractCreate(body: unknown): Result<ContractCreateInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  if (record.transitionSponsorId !== undefined) {
    return typeof record.transitionSponsorId === "string" && isUuid(record.transitionSponsorId)
      ? { ok: true, value: { mode: "transition", transitionSponsorId: record.transitionSponsorId } }
      : { ok: false, error: "invalid_transition_sponsor" };
  }
  if (typeof record.sponsorId !== "string" || !isUuid(record.sponsorId)) return { ok: false, error: "invalid_sponsor" };
  if (typeof record.packageVersionId !== "string" || !isUuid(record.packageVersionId)) return { ok: false, error: "invalid_package_version" };
  if (!Number.isSafeInteger(record.annualValueCents) || Number(record.annualValueCents) < 0 || Number(record.annualValueCents) > 2_147_483_647) {
    return { ok: false, error: "invalid_annual_value" };
  }
  return {
    ok: true,
    value: {
      mode: "direct",
      sponsorId: record.sponsorId,
      packageVersionId: record.packageVersionId,
      annualValueCents: Number(record.annualValueCents),
    },
  };
}

export function parseContractUpdate(body: unknown): Result<Extract<ContractCreateInput, { mode: "direct" }> & {
  title: string;
  specialAgreements: string;
  signingMethod: SigningMethod;
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const selection = parseContractCreate(body);
  if (!selection.ok) return selection;
  if (selection.value.mode !== "direct") return { ok: false, error: "invalid_sponsor" };
  const title = optionalText(record.title, 160);
  const specialAgreements = optionalText(record.specialAgreements, 5000);
  if (!title) return { ok: false, error: "invalid_contract_title" };
  if (!specialAgreements) return { ok: false, error: "invalid_special_agreements" };
  if (!["click", "advanced", "qualified"].includes(String(record.signingMethod))) return { ok: false, error: "invalid_signing_method" };
  return { ok: true, value: { ...selection.value, title, specialAgreements, signingMethod: record.signingMethod as SigningMethod } };
}

function parseReason(body: unknown, error: string): Result<{ reason: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const reason = optionalText((body as Record<string, unknown>).reason, 600);
  return reason ? { ok: true, value: { reason } } : { ok: false, error };
}

export function parseContractCorrection(body: unknown) {
  return parseReason(body, "contract_correction_reason_required");
}

export function parseContractRemoval(body: unknown) {
  return parseReason(body, "contract_removal_reason_required");
}

export function parseContractRelease(body: unknown): Result<{ legalReviewAcknowledged: true }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  return (body as Record<string, unknown>).legalReviewAcknowledged === true
    ? { ok: true, value: { legalReviewAcknowledged: true } }
    : { ok: false, error: "legal_review_acknowledgement_required" };
}

export function parseContractConfirmation(body: unknown): Result<{ signingAuthorityName: string; signingAuthorityRole: string; acknowledged: true }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const signingAuthorityName = optionalText(record.signingAuthorityName, 160);
  const signingAuthorityRole = optionalText(record.signingAuthorityRole, 120);
  if (!signingAuthorityName) return { ok: false, error: "signing_authority_name_required" };
  if (!signingAuthorityRole) return { ok: false, error: "signing_authority_role_required" };
  if (record.acknowledged !== true) return { ok: false, error: "contract_acknowledgement_required" };
  return { ok: true, value: { signingAuthorityName, signingAuthorityRole, acknowledged: true } };
}

export function parseContractAdminConfirmation(body: unknown): Result<{
  signingAuthorityName: string;
  signingAuthorityRole: string;
  confirmedOn: string;
  evidenceNote: string;
  acknowledged: true;
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const signingAuthorityName = optionalText(record.signingAuthorityName, 160);
  const signingAuthorityRole = optionalText(record.signingAuthorityRole, 120) ?? "Vertretungsberechtigte Person";
  const confirmedOn = optionalText(record.confirmedOn, 10);
  const evidenceNote = optionalText(record.evidenceNote, 600);
  if (!signingAuthorityName) return { ok: false, error: "signing_authority_name_required" };
  if (!confirmedOn || !/^\d{4}-\d{2}-\d{2}$/.test(confirmedOn)) return { ok: false, error: "legacy_confirmation_date_required" };
  const parsedDate = new Date(`${confirmedOn}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== confirmedOn || Number(confirmedOn.slice(0, 4)) < 1900) {
    return { ok: false, error: "invalid_legacy_confirmation_date" };
  }
  if (!evidenceNote) return { ok: false, error: "legacy_confirmation_evidence_required" };
  if (record.acknowledged !== true) return { ok: false, error: "admin_contract_acknowledgement_required" };
  return { ok: true, value: { signingAuthorityName, signingAuthorityRole, confirmedOn, evidenceNote, acknowledged: true } };
}

export type LegacyContractCreateInput = Extract<ContractCreateInput, { mode: "direct" }> & {
  signingAuthorityName: string;
  signingAuthorityRole: string;
  confirmedOn: string;
  evidenceNote: string;
  acknowledged: true;
};

export function parseLegacyContractCreate(body: unknown): Result<LegacyContractCreateInput> {
  const selection = parseContractCreate(body);
  if (!selection.ok) return selection;
  if (selection.value.mode !== "direct") return { ok: false, error: "invalid_sponsor" };
  const confirmation = parseContractAdminConfirmation(body);
  if (!confirmation.ok) return confirmation;
  return { ok: true, value: { ...selection.value, ...confirmation.value } };
}

export function parseContractDispatch(body: unknown): Result<{ signerEmail: string; signerName: string; signerRole: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const signerEmail = optionalText(record.signerEmail, 320)?.toLowerCase();
  const signerName = optionalText(record.signerName, 160);
  const signerRole = optionalText(record.signerRole, 120) ?? "Vertretungsberechtigte Person";
  if (!signerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) return { ok: false, error: "invalid_signer_email" };
  if (!signerName) return { ok: false, error: "signer_name_required" };
  return { ok: true, value: { signerEmail, signerName, signerRole } };
}

export function parseContractAcknowledgement(body: unknown): Result<{ acknowledged: true }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  return (body as Record<string, unknown>).acknowledged === true
    ? { ok: true, value: { acknowledged: true } }
    : { ok: false, error: "contract_acknowledgement_required" };
}
