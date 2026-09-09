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

export function parseContractCreate(body: unknown): Result<{ transitionSponsorId: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const transitionSponsorId = (body as Record<string, unknown>).transitionSponsorId;
  return typeof transitionSponsorId === "string" && isUuid(transitionSponsorId)
    ? { ok: true, value: { transitionSponsorId } }
    : { ok: false, error: "invalid_transition_sponsor" };
}

export function parseContractUpdate(body: unknown): Result<{ title: string; specialAgreements: string; signingMethod: SigningMethod }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const title = optionalText(record.title, 160);
  const specialAgreements = optionalText(record.specialAgreements, 5000);
  if (!title) return { ok: false, error: "invalid_contract_title" };
  if (!specialAgreements) return { ok: false, error: "invalid_special_agreements" };
  if (!["click", "advanced", "qualified"].includes(String(record.signingMethod))) return { ok: false, error: "invalid_signing_method" };
  return { ok: true, value: { title, specialAgreements, signingMethod: record.signingMethod as SigningMethod } };
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
