type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type DossierProfileInput = {
  headline: string | null;
  seasonLabel: string | null;
  introduction: string | null;
  clubPortrait: string | null;
  sponsorshipImpact: string | null;
  audience: string | null;
};

export type DossierContact = { contactName: string | null; contactEmail: string | null };

const fields = {
  headline: { maximum: 160, minimum: 2 },
  seasonLabel: { maximum: 80 },
  introduction: { maximum: 2000 },
  clubPortrait: { maximum: 5000 },
  sponsorshipImpact: { maximum: 5000 },
  audience: { maximum: 3000 },
} as const;

export function parseDossierProfile(body: unknown): Result<DossierProfileInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const value = {} as DossierProfileInput;
  for (const [field, rule] of Object.entries(fields) as Array<[keyof DossierProfileInput, { maximum: number; minimum?: number }]>) {
    const raw = record[field];
    if (raw !== null && raw !== undefined && typeof raw !== "string") return { ok: false, error: `invalid_${field}` };
    const normalized = typeof raw === "string" ? raw.trim() : "";
    if (normalized.length > rule.maximum || (normalized && normalized.length < (rule.minimum ?? 0))) {
      return { ok: false, error: `invalid_${field}` };
    }
    value[field] = normalized || null;
  }
  return { ok: true, value };
}

export function dossierMissingFields(profile: DossierProfileInput, contact: DossierContact) {
  return [
    ["headline", profile.headline],
    ["introduction", profile.introduction],
    ["clubPortrait", profile.clubPortrait],
    ["sponsorshipImpact", profile.sponsorshipImpact],
    ["contactName", contact.contactName],
    ["contactEmail", contact.contactEmail],
  ].filter(([, content]) => !content).map(([field]) => field);
}
