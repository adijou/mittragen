import type { Config, Context } from "@netlify/functions";
import { isResponse, json, permissionsFor, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession } from "./_shared/database.ts";

type MembershipRow = {
  tenant_id: string;
  role: MembershipRole;
  display_name: string | null;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  default_currency: string;
};

type SponsorSummary = {
  status: string;
  count: string;
  annual_value_cents: string;
};

export default async (request: Request, context: Context) => {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const user = await requireUser();
  if (isResponse(user)) return user;

  const tenantId = context.params.tenantId;
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);

  const workspace = await withSession(user.id, tenantId, async (client) => {
    const membershipResult = await client.query<MembershipRow>(`
      SELECT tenant_id, role, display_name
      FROM tenant_memberships
      WHERE tenant_id = $1 AND identity_user_id = $2
      LIMIT 1
    `, [tenantId, user.id]);

    const membership = membershipResult.rows[0];
    if (!membership) return null;

    const tenantResult = await client.query<TenantRow>(`
      SELECT id, name, slug, kind, status, default_currency
      FROM tenants
      WHERE id = $1
    `, [tenantId]);

    const sponsorSummary = await client.query<SponsorSummary>(`
      SELECT status, count(*)::text AS count, sum(annual_value_cents)::text AS annual_value_cents
      FROM sponsors
      WHERE tenant_id = $1
      GROUP BY status
      ORDER BY status
    `, [tenantId]);

    const auditResult = await client.query<{ action: string; created_at: string; metadata: Record<string, unknown> }>(`
      SELECT action, created_at::text, metadata
      FROM audit_events
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 8
    `, [tenantId]);

    return {
      tenant: tenantResult.rows[0],
      membership: { ...membership, permissions: permissionsFor(membership.role) },
      sponsorSummary: sponsorSummary.rows,
      auditEvents: auditResult.rows,
    };
  });

  if (!workspace) return json({ error: "tenant_access_denied" }, 403);
  return json({ workspace });
};

export const config: Config = {
  path: "/api/workspace/:tenantId",
};

