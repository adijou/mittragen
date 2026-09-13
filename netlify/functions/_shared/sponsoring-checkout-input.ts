import { isUuid } from "./database.ts";

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 1 && normalized.length <= maximum ? normalized : null;
}

function optionalText(value: unknown, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, maximum);
}

function email(value: unknown) {
  const normalized = requiredText(value, 320)?.toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function website(value: unknown) {
  const normalized = optionalText(value, 500);
  if (!normalized) return normalized;
  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function parseOnlinePackageSetting(input: unknown) {
  const record = recordOf(input);
  if (!record || typeof record.enabled !== "boolean") return { ok: false as const, error: "invalid_online_package_setting" };
  if (record.enabled && record.acknowledged !== true) return { ok: false as const, error: "online_package_acknowledgement_required" };
  return { ok: true as const, value: { enabled: record.enabled, acknowledged: record.enabled ? true as const : false as const } };
}

export function parseSponsoringCheckout(input: unknown, now = Date.now()) {
  const record = recordOf(input);
  if (!record) return { ok: false as const, error: "invalid_sponsoring_checkout" };
  if (typeof record.websiteTrap === "string" && record.websiteTrap.trim()) return { ok: false as const, error: "sponsoring_checkout_rejected" };
  if (typeof record.startedAt !== "number" || !Number.isFinite(record.startedAt) || now - record.startedAt < 750 || now - record.startedAt > 86_400_000) {
    return { ok: false as const, error: "sponsoring_checkout_rejected" };
  }
  if (!isUuid(String(record.idempotencyKey))) return { ok: false as const, error: "invalid_checkout_idempotency_key" };
  if (!isUuid(String(record.packageVersionId))) return { ok: false as const, error: "invalid_package_version" };

  const legalName = requiredText(record.legalName, 160);
  const street = requiredText(record.street, 200);
  const postalCode = requiredText(record.postalCode, 30);
  const city = requiredText(record.city, 120);
  const contactName = requiredText(record.contactName, 160);
  const contactEmail = email(record.contactEmail);
  const contactPhone = optionalText(record.contactPhone, 80);
  const sponsorWebsite = website(record.website);
  const signerName = requiredText(record.signerName, 160);
  const signerEmail = email(record.signerEmail);
  const signerRole = optionalText(record.signerRole, 120) ?? "Vertretungsberechtigte Person";

  if (!legalName) return { ok: false as const, error: "invalid_checkout_legal_name" };
  if (!street || !postalCode || !city) return { ok: false as const, error: "invalid_checkout_address" };
  if (!contactName) return { ok: false as const, error: "invalid_checkout_contact_name" };
  if (!contactEmail) return { ok: false as const, error: "invalid_checkout_contact_email" };
  if (record.website && !sponsorWebsite) return { ok: false as const, error: "invalid_checkout_website" };
  if (!signerName) return { ok: false as const, error: "invalid_checkout_signer_name" };
  if (!signerEmail) return { ok: false as const, error: "invalid_checkout_signer_email" };
  if (record.contractTermsAccepted !== true) return { ok: false as const, error: "checkout_contract_terms_required" };
  if (record.authorityConfirmed !== true) return { ok: false as const, error: "checkout_authority_confirmation_required" };

  return {
    ok: true as const,
    value: {
      idempotencyKey: String(record.idempotencyKey),
      packageVersionId: String(record.packageVersionId),
      legalName,
      street,
      postalCode,
      city,
      website: sponsorWebsite,
      contactName,
      contactEmail,
      contactPhone,
      signerName,
      signerEmail,
      signerRole,
    },
  };
}
