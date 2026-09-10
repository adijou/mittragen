export const tenantKinds = ["club", "association", "event", "project"] as const;

export type TenantKind = typeof tenantKinds[number];

export const tenantKindLabels: Record<TenantKind, string> = {
  club: "Sportklub",
  association: "Verein / Organisation",
  event: "Event",
  project: "Projekt",
};

type TenantUpdateResult =
  | { ok: true; value: { name: string; kind: TenantKind } }
  | { ok: false; error: string };

type TenantCreateResult =
  | { ok: true; value: { name: string; slug: string; kind: TenantKind; includeDemo: boolean } }
  | { ok: false; error: string };

export function parseTenantCreate(body: unknown): TenantCreateResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const slug = typeof record.slug === "string" ? record.slug.trim().toLowerCase() : "";
  const kind = typeof record.kind === "string" ? record.kind : "club";

  if (name.length < 2 || name.length > 120) return { ok: false, error: "invalid_name" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false, error: "invalid_slug" };
  if (!tenantKinds.includes(kind as TenantKind)) return { ok: false, error: "invalid_kind" };

  return {
    ok: true,
    value: {
      name,
      slug,
      kind: kind as TenantKind,
      includeDemo: record.includeDemo === true,
    },
  };
}

export function isDemoDataDeletionConfirmed(body: unknown, tenantName: string) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const confirmation = (body as Record<string, unknown>).confirmation;
  return typeof confirmation === "string" && confirmation.trim() === tenantName;
}

export function parseTenantUpdate(body: unknown): TenantUpdateResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const kind = typeof record.kind === "string" ? record.kind : "";

  if (name.length < 2 || name.length > 120) return { ok: false, error: "invalid_name" };
  if (!tenantKinds.includes(kind as TenantKind)) return { ok: false, error: "invalid_kind" };
  return { ok: true, value: { name, kind: kind as TenantKind } };
}

export const ownerMembershipParams = (
  tenantId: string,
  user: { id: string; email?: string; name?: string },
): [string, string, string | null, string] => [tenantId, user.id, user.email ?? null, user.name ?? user.email ?? "Owner"];
