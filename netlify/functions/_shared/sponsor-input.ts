export const sponsorStatuses = ["draft", "prepared", "review", "opened", "question", "approved", "active", "inactive"] as const;

export type SponsorStatus = typeof sponsorStatuses[number];

export type SponsorInput = {
  legal_name: string;
  contact_name: string | null;
  contact_email: string | null;
  phone: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  website: string | null;
  source_organization: string | null;
  status: SponsorStatus;
  proposal_package: string | null;
  assigned_package_version_id: string | null;
  annual_value_cents: number;
  notes: string | null;
};

type SponsorInputResult =
  | { ok: true; value: Partial<SponsorInput> }
  | { ok: false; error: string };

const fieldRules = {
  legal_name: 160,
  contact_name: 160,
  contact_email: 254,
  phone: 80,
  street: 200,
  postal_code: 30,
  city: 120,
  website: 500,
  source_organization: 160,
  proposal_package: 160,
  notes: 5000,
} as const;

const normalizeText = (value: unknown, maxLength: number) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length > maxLength) return undefined;
  return normalized || null;
};

export function parseSponsorInput(body: unknown, mode: "create" | "update"): SponsorInputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const value: Partial<SponsorInput> = {};

  for (const [field, maxLength] of Object.entries(fieldRules) as Array<[keyof typeof fieldRules, number]>) {
    if (!(field in record)) continue;
    const normalized = normalizeText(record[field], maxLength);
    if (normalized === undefined) return { ok: false, error: `invalid_${field}` };
    Object.assign(value, { [field]: normalized });
  }

  if (mode === "create" && !value.legal_name) return { ok: false, error: "invalid_legal_name" };
  if (mode === "update" && "legal_name" in value && !value.legal_name) return { ok: false, error: "invalid_legal_name" };

  if ("contact_email" in value && value.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contact_email)) {
    return { ok: false, error: "invalid_contact_email" };
  }

  if ("website" in value && value.website) {
    try {
      const url = new URL(value.website);
      if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: "invalid_website" };
    } catch {
      return { ok: false, error: "invalid_website" };
    }
  }

  if ("status" in record) {
    if (typeof record.status !== "string" || !sponsorStatuses.includes(record.status as SponsorStatus)) {
      return { ok: false, error: "invalid_status" };
    }
    value.status = record.status as SponsorStatus;
  } else if (mode === "create") {
    value.status = "active";
  }

  if ("assigned_package_version_id" in record) {
    const packageVersionId = record.assigned_package_version_id;
    if (packageVersionId === null || packageVersionId === "") value.assigned_package_version_id = null;
    else if (typeof packageVersionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(packageVersionId)) {
      value.assigned_package_version_id = packageVersionId;
    } else return { ok: false, error: "invalid_assigned_package" };
  } else if (mode === "create") value.assigned_package_version_id = null;

  if ("annual_value_cents" in record) {
    const amount = record.annual_value_cents;
    if (!Number.isSafeInteger(amount) || (amount as number) < 0 || (amount as number) > 100_000_000_000) {
      return { ok: false, error: "invalid_annual_value" };
    }
    value.annual_value_cents = amount as number;
  } else if (mode === "create") {
    value.annual_value_cents = 0;
  }

  if (mode === "create") {
    for (const field of Object.keys(fieldRules) as Array<keyof typeof fieldRules>) {
      if (field !== "legal_name" && !(field in value)) Object.assign(value, { [field]: null });
    }
  }

  if (mode === "update" && Object.keys(value).length === 0) return { ok: false, error: "no_changes" };
  return { ok: true, value };
}
