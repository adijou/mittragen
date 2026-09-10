import type { Config, Context } from "@netlify/functions";
import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import { hasPermission, isResponse, json, requireUser, type MembershipRole } from "./_shared/auth.ts";
import { isUuid, withSession, type DatabaseClient } from "./_shared/database.ts";
import { parseSponsorInput, type SponsorInput } from "./_shared/sponsor-input.ts";

type SponsorRow = SponsorInput & {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
};

async function membershipRole(client: DatabaseClient, tenantId: string, userId: string) {
  const result = await client.query<{ role: MembershipRole }>(`
    SELECT role
    FROM tenant_memberships
    WHERE tenant_id = $1 AND identity_user_id = $2
    LIMIT 1
  `, [tenantId, userId]);
  return result.rows[0]?.role ?? null;
}

const columns = [
  "legal_name", "contact_name", "contact_email", "phone", "street", "postal_code", "city", "website",
  "source_organization", "status", "proposal_package", "assigned_package_version_id", "annual_value_cents", "notes",
] as const;

const returningColumns = `
  id, tenant_id, legal_name, contact_name, contact_email, phone, street, postal_code, city, website,
  source_organization, status, proposal_package, assigned_package_version_id, annual_value_cents, notes,
  created_at::text AS created_at, updated_at::text AS updated_at
`;

export default async (request: Request, context: Context) => {
  const user = await requireUser();
  if (isResponse(user)) return user;

  const tenantId = context.params.tenantId;
  const sponsorId = context.params.sponsorId;
  if (!tenantId || !isUuid(tenantId)) return json({ error: "invalid_tenant" }, 422);
  if (sponsorId && !isUuid(sponsorId)) return json({ error: "invalid_sponsor" }, 422);

  if (request.method === "GET") {
    const result = await withSession(user.id, tenantId, async (client) => {
      const role = await membershipRole(client, tenantId, user.id);
      if (!role || !hasPermission(role, "sponsors:read")) return null;
      const sponsors = await client.query<SponsorRow & { assigned_package_name: string | null }>(`
        SELECT sponsor.id, sponsor.tenant_id, sponsor.legal_name, sponsor.contact_name, sponsor.contact_email,
               sponsor.phone, sponsor.street, sponsor.postal_code, sponsor.city, sponsor.website,
               sponsor.source_organization, sponsor.status, sponsor.proposal_package,
               sponsor.assigned_package_version_id, version.name AS assigned_package_name,
               sponsor.annual_value_cents, sponsor.notes, sponsor.created_at::text, sponsor.updated_at::text
        FROM sponsors sponsor
        LEFT JOIN sponsorship_package_versions version
          ON version.id = sponsor.assigned_package_version_id AND version.tenant_id = sponsor.tenant_id
        WHERE sponsor.tenant_id = $1
        ORDER BY sponsor.legal_name, sponsor.id
      `, [tenantId]);
      const packageOptions = await client.query<{ id: string; name: string; price_cents: number }>(`
        SELECT version.id, version.name, version.price_cents
        FROM sponsorship_package_versions version
        JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
        WHERE version.tenant_id = $1 AND version.status = 'published' AND package.status = 'active'
        ORDER BY lower(version.name), version.version_number DESC
      `, [tenantId]);
      return { sponsors: sponsors.rows, packageOptions: packageOptions.rows };
    });
    if (!result) return json({ error: "tenant_access_denied" }, 403);
    return json(result);
  }

  if (!['POST', 'PATCH'].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  if (request.method === "PATCH" && !sponsorId) return json({ error: "sponsor_required" }, 422);

  try {
    verifyRequestOrigin(request);
  } catch (error) {
    return json({ error: "invalid_request_origin" }, (error as AuthError).status ?? 403);
  }

  const parsed = parseSponsorInput(await request.json().catch(() => null), request.method === "POST" ? "create" : "update");
  if (!parsed.ok) return json({ error: parsed.error }, 422);

  try {
    const result = await withSession(user.id, tenantId, async (client) => {
      const role = await membershipRole(client, tenantId, user.id);
      if (!role || !hasPermission(role, "sponsors:write")) return { denied: true as const };
      const requestedPackageVersion = parsed.value.assigned_package_version_id;
      if (requestedPackageVersion) {
        const available = await client.query<{ id: string }>(`
          SELECT version.id
          FROM sponsorship_package_versions version
          JOIN sponsorship_packages package ON package.id = version.package_id AND package.tenant_id = version.tenant_id
          WHERE version.tenant_id = $1 AND version.id = $2 AND version.status = 'published' AND package.status = 'active'
          LIMIT 1
        `, [tenantId, requestedPackageVersion]);
        if (!available.rows[0]) return { invalidPackage: true as const };
      }

      if (request.method === "POST") {
        const input = parsed.value as SponsorInput;
        const created = await client.query<SponsorRow>(`
          INSERT INTO sponsors (
            tenant_id, legal_name, contact_name, contact_email, phone, street, postal_code, city, website,
            source_organization, status, proposal_package, assigned_package_version_id, annual_value_cents, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING ${returningColumns}
        `, [tenantId, ...columns.map((column) => input[column])]);
        const sponsor = created.rows[0];
        await client.query(`
          INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
          VALUES ($1, $2, 'sponsor.created', 'sponsor', $3, jsonb_build_object('legal_name', $4::text))
        `, [tenantId, user.id, sponsor.id, sponsor.legal_name]);
        return { sponsor };
      }

      const entries = Object.entries(parsed.value) as Array<[keyof SponsorInput, SponsorInput[keyof SponsorInput]]>;
      const assignments = entries.map(([column], index) => `${column} = $${index + 3}`).join(", ");
      const updated = await client.query<SponsorRow>(`
        UPDATE sponsors
        SET ${assignments}, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${returningColumns}
      `, [tenantId, sponsorId, ...entries.map(([, value]) => value)]);
      const sponsor = updated.rows[0];
      if (!sponsor) return { notFound: true as const };
      await client.query(`
        INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, metadata)
        VALUES ($1, $2, 'sponsor.updated', 'sponsor', $3, jsonb_build_object('fields', $4::text[]))
      `, [tenantId, user.id, sponsor.id, entries.map(([field]) => field)]);
      return { sponsor };
    });

    if ('denied' in result) return json({ error: "permission_denied" }, 403);
    if ('invalidPackage' in result) return json({ error: "invalid_assigned_package" }, 422);
    if ('notFound' in result) return json({ error: "sponsor_not_found" }, 404);
    return json(result, request.method === "POST" ? 201 : 200);
  } catch (error) {
    console.error("sponsor_write_failed", { requestId: context.requestId, tenantId, sponsorId, error });
    return json({ error: "sponsor_write_failed" }, 500);
  }
};

export const config: Config = {
  path: ["/api/sponsors/:tenantId", "/api/sponsors/:tenantId/:sponsorId"],
};
