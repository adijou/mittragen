import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, permissionsFor, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession } from "./_shared/database.ts";
import { ownerMembershipParams, parseTenantUpdate, tenantKinds } from "./_shared/tenant-input.ts";

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  role: MembershipRole;
};

function databaseCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

const demoSponsors = [
  ["Bergbau AG", "FC Bösingen", "review", "Gold Plus", 2500000],
  ["Solartec AG", "beide Klubs", "opened", "Gold", 1500000],
  ["Fischer & Partner", "FC Wünnewil-Flamatt", "approved", "Silber", 800000],
  ["Garage Sense", "FC Bösingen", "question", "Bronze", 500000],
  ["Käserei Sensetal", "FC Wünnewil-Flamatt", "prepared", "Silber", 800000],
  ["Bauwerk Freiburg", "beide Klubs", "review", "Gold Plus", 2500000],
  ["Regionalmarkt Unterland", "FC Bösingen", "review", "Bronze", 500000],
] as const;

export default async (request: Request, _context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const tenantIdFromPath = _context.params.tenantId;

  if (request.method === "GET" && !tenantIdFromPath) {
    const tenants = await withSession(user.id, null, async (client) => {
      const result = await client.query<TenantRow>(`
        SELECT tenant.id, tenant.name, tenant.slug, tenant.kind, tenant.status, membership.role
        FROM tenant_memberships membership
        JOIN tenants tenant ON tenant.id = membership.tenant_id
        WHERE membership.identity_user_id = $1
        ORDER BY tenant.name
      `, [user.id]);
      return result.rows;
    });

    return json({ tenants: tenants.map((tenant) => ({ ...tenant, permissions: permissionsFor(tenant.role) })) });
  }

  if (request.method === "PATCH") {
    if (!tenantIdFromPath || !isUuid(tenantIdFromPath)) return json({ error: "invalid_tenant" }, 422);
    try {
      verifyRequestOrigin(request);
    } catch (error) {
      return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
    }

    const parsed = parseTenantUpdate(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 422);

    try {
      const result = await withSession(user.id, tenantIdFromPath, async (client) => {
        const membership = await client.query<{ role: MembershipRole }>(`
          SELECT role FROM tenant_memberships
          WHERE tenant_id = $1 AND identity_user_id = $2
          LIMIT 1
        `, [tenantIdFromPath, user.id]);
        const role = membership.rows[0]?.role;
        if (!role || !hasPermission(role, "tenant:manage")) return null;

        const updated = await client.query<TenantRow>(`
          UPDATE tenants
          SET name = $2, kind = $3::tenant_kind, updated_at = now()
          WHERE id = $1
          RETURNING id, name, slug, kind, status, $4::membership_role AS role
        `, [tenantIdFromPath, parsed.value.name, parsed.value.kind, role]);
        if (!updated.rows[0]) return null;

        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'tenant.updated', 'tenant', $3::text, jsonb_build_object('name', $4::text, 'kind', $5::text))
        `, [tenantIdFromPath, user.id, tenantIdFromPath, parsed.value.name, parsed.value.kind]);
        return updated.rows[0];
      });

      if (!result) return json({ error: "permission_denied" }, 403);
      return json({ tenant: { ...result, permissions: permissionsFor(result.role) } });
    } catch (error) {
      console.error("tenant_update_failed", { requestId: _context.requestId, tenantId: tenantIdFromPath, error });
      return json({ error: "tenant_update_failed", requestId: _context.requestId }, 500);
    }
  }

  if (request.method !== "POST" || tenantIdFromPath) return json({ error: "method_not_allowed" }, 405);

  try {
    verifyRequestOrigin(request);
  } catch (error) {
    const authError = error as AuthError;
    return json({ error: "invalid_request_origin" }, authError.status ?? 403);
  }

  const body = await request.json().catch(() => null) as null | { name?: unknown; slug?: unknown; kind?: unknown; includeDemo?: unknown };
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const kind = typeof body?.kind === "string" ? body.kind : "club";
  const includeDemo = body?.includeDemo !== false;

  if (name.length < 2 || name.length > 120) return json({ error: "invalid_name" }, 422);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "invalid_slug" }, 422);
  if (!tenantKinds.includes(kind as (typeof tenantKinds)[number])) return json({ error: "invalid_kind" }, 422);

  const tenantId = crypto.randomUUID();

  try {
    const tenant = await withSession(user.id, tenantId, async (client) => {
      const created = await client.query<TenantRow>(`
        INSERT INTO tenants (id, name, slug, kind, status)
        VALUES ($1, $2, $3, $4::tenant_kind, 'active')
        RETURNING id, name, slug, kind, status, 'owner'::membership_role AS role
      `, [tenantId, name, slug, kind]);

      await client.query(`
        INSERT INTO tenant_memberships (tenant_id, identity_user_id, email, display_name, role)
        VALUES ($1, $2, $3, $4, 'owner')
      `, ownerMembershipParams(tenantId, user));

      if (includeDemo) {
        for (const sponsor of demoSponsors) {
          await client.query(`
            INSERT INTO sponsors (tenant_id, legal_name, source_organization, status, proposal_package, annual_value_cents)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [tenantId, ...sponsor]);
        }
      }

      await client.query(`
        INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1, $2, 'tenant.created', 'tenant', $3::text, jsonb_build_object('demo_data', $4::boolean))
      `, [tenantId, user.id, tenantId, includeDemo]);

      return created.rows[0];
    });

    return json({ tenant: { ...tenant, permissions: permissionsFor("owner") } }, 201);
  } catch (error) {
    if (databaseCode(error) === "23505") return json({ error: "slug_already_exists" }, 409);
    console.error("tenant_create_failed", { requestId: _context.requestId, error });
    return json({ error: "tenant_create_failed", requestId: _context.requestId }, 500);
  }
};

export const config: Config = {
  path: ["/api/tenants", "/api/tenants/:tenantId"],
};
