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
