export const paymentPlans = ["annual", "semiannual", "quarterly", "custom"] as const;
export const packageVisibilities = ["private", "public"] as const;
export const exclusivityScopes = ["none", "industry", "team", "area", "channel", "period"] as const;

export type PaymentPlan = typeof paymentPlans[number];
export type PackageVisibility = typeof packageVisibilities[number];
export type ExclusivityScope = typeof exclusivityScopes[number];

export type PackageVersionInput = {
  name: string;
  description: string | null;
  priceCents: number;
  durationMonths: number;
  paymentPlan: PaymentPlan;
  paymentTerms: string | null;
  validFrom: string | null;
  validUntil: string | null;
  visibility: PackageVisibility;
  capacity: number | null;
  deviationApprovalRequired: boolean;
};

export type PackageRightInput = {
  name: string;
  description: string | null;
  quantity: number;
  scheduleText: string | null;
  channel: string | null;
  location: string | null;
  responsibleRole: string | null;
  exclusivityScope: ExclusivityScope;
  exclusivityKey: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function text(value: unknown, min: number, max: number, nullable = false) {
  if (value === null || value === undefined || value === "") return nullable ? null : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) return undefined;
  return normalized;
}

function integer(value: unknown, min: number, max: number) {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : null;
}

function date(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

export function parsePackageVersionInput(body: unknown): Result<PackageVersionInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const name = text(record.name, 1, 160);
  const description = text(record.description, 1, 3000, true);
  const priceCents = integer(record.priceCents, 0, 100_000_000_000);
  const durationMonths = integer(record.durationMonths, 1, 120);
  const paymentTerms = text(record.paymentTerms, 1, 500, true);
  const validFrom = date(record.validFrom);
  const validUntil = date(record.validUntil);
  const capacity = record.capacity === null || record.capacity === undefined || record.capacity === "" ? null : integer(record.capacity, 1, 1_000_000);

  if (!name) return { ok: false, error: "invalid_package_name" };
  if (record.description && description === undefined) return { ok: false, error: "invalid_package_description" };
  if (priceCents === null) return { ok: false, error: "invalid_package_price" };
  if (durationMonths === null) return { ok: false, error: "invalid_package_duration" };
  if (typeof record.paymentPlan !== "string" || !paymentPlans.includes(record.paymentPlan as PaymentPlan)) return { ok: false, error: "invalid_payment_plan" };
  if (record.paymentTerms && paymentTerms === undefined) return { ok: false, error: "invalid_payment_terms" };
  if (validFrom === undefined || validUntil === undefined) return { ok: false, error: "invalid_package_validity" };
  if (validFrom && validUntil && validUntil < validFrom) return { ok: false, error: "invalid_package_validity" };
  if (typeof record.visibility !== "string" || !packageVisibilities.includes(record.visibility as PackageVisibility)) return { ok: false, error: "invalid_package_visibility" };
  if (capacity === null && record.capacity !== null && record.capacity !== undefined && record.capacity !== "") return { ok: false, error: "invalid_package_capacity" };
  if (typeof record.deviationApprovalRequired !== "boolean") return { ok: false, error: "invalid_deviation_approval" };

  return { ok: true, value: {
    name, description: description ?? null, priceCents, durationMonths,
    paymentPlan: record.paymentPlan as PaymentPlan, paymentTerms: paymentTerms ?? null,
    validFrom, validUntil, visibility: record.visibility as PackageVisibility, capacity,
    deviationApprovalRequired: record.deviationApprovalRequired,
  } };
}

export function parsePackageRightInput(body: unknown): Result<PackageRightInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const name = text(record.name, 1, 160);
  const description = text(record.description, 1, 2000, true);
  const quantity = integer(record.quantity, 1, 1_000_000);
  const scheduleText = text(record.scheduleText, 1, 300, true);
  const channel = text(record.channel, 1, 120, true);
  const location = text(record.location, 1, 160, true);
  const responsibleRole = text(record.responsibleRole, 1, 120, true);
  if (!name) return { ok: false, error: "invalid_right_name" };
  if (quantity === null) return { ok: false, error: "invalid_right_quantity" };
  for (const [key, value] of [["description", description], ["schedule", scheduleText], ["channel", channel], ["location", location], ["responsibility", responsibleRole]] as const) {
    const sourceKey = key === "schedule" ? "scheduleText" : key === "responsibility" ? "responsibleRole" : key;
    if (record[sourceKey] && value === undefined) return { ok: false, error: `invalid_right_${key}` };
  }
  if (typeof record.exclusivityScope !== "string" || !exclusivityScopes.includes(record.exclusivityScope as ExclusivityScope)) return { ok: false, error: "invalid_exclusivity_scope" };
  const exclusivityScope = record.exclusivityScope as ExclusivityScope;
  const exclusivityKey = text(record.exclusivityKey, 1, 160, true);
  if (exclusivityScope === "none" && exclusivityKey) return { ok: false, error: "unexpected_exclusivity_key" };
  if (exclusivityScope !== "none" && !exclusivityKey) return { ok: false, error: "exclusivity_key_required" };
  return { ok: true, value: { name, description: description ?? null, quantity, scheduleText: scheduleText ?? null, channel: channel ?? null, location: location ?? null, responsibleRole: responsibleRole ?? null, exclusivityScope, exclusivityKey: exclusivityKey ?? null } };
}

export function parseVersionCopyInput(body: unknown): Result<{ sourceVersionId: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const sourceVersionId = (body as Record<string, unknown>).sourceVersionId;
  if (typeof sourceVersionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceVersionId)) return { ok: false, error: "invalid_source_version" };
  return { ok: true, value: { sourceVersionId } };
}
