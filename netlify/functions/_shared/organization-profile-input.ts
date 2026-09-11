import { parseContractSettings, type RenewalMode } from "./contract-input.ts";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type OrganizationProfileInput = {
  legalName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  representativeName: string | null;
  representativeTitle: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  renewalMode: RenewalMode;
  noticeMonths: number | null;
  placeOfJurisdiction: string | null;
  brandPrimaryColor: string;
  brandAccentColor: string;
};

function optionalText(value: unknown, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : undefined;
}

function color(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : null;
}

export function parseOrganizationProfile(body: unknown): Result<OrganizationProfileInput> {
  const contract = parseContractSettings(body);
  if (!contract.ok) return contract;
  const record = body as Record<string, unknown>;
  const contactName = optionalText(record.contactName, 160);
  const contactPhone = optionalText(record.contactPhone, 80);
  const website = optionalText(record.website, 500);
  if (contactName === undefined) return { ok: false, error: "invalid_contact_name" };
  if (contactPhone === undefined) return { ok: false, error: "invalid_contact_phone" };
  if (website === undefined) return { ok: false, error: "invalid_website" };
  if (website) {
    try {
      const parsed = new URL(website);
      if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: "invalid_website" };
    } catch {
      return { ok: false, error: "invalid_website" };
    }
  }
  const brandPrimaryColor = color(record.brandPrimaryColor);
  const brandAccentColor = color(record.brandAccentColor);
  if (!brandPrimaryColor) return { ok: false, error: "invalid_brand_primary_color" };
  if (!brandAccentColor) return { ok: false, error: "invalid_brand_accent_color" };
  return { ok: true, value: {
    ...contract.value,
    contactName: contactName ?? null,
    contactPhone: contactPhone ?? null,
    website: website ?? null,
    brandPrimaryColor,
    brandAccentColor,
  } };
}

export function parseBrandColors(primary: unknown, accent: unknown) {
  const brandPrimaryColor = color(primary);
  const brandAccentColor = color(accent);
  return brandPrimaryColor && brandAccentColor
    ? { ok: true as const, value: { brandPrimaryColor, brandAccentColor } }
    : { ok: false as const, error: "invalid_brand_colors" };
}
