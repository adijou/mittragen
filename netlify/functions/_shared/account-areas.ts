import type { DatabaseClient } from "./database.ts";
import type { AccountArea, WorkspaceArea, SponsorArea } from "../../../shared/account-areas.ts";

// Read only: listing areas must not open proposals or accept invitations.
export async function loadAccountAreas(client: DatabaseClient, userId: string): Promise<AccountArea[]> {
  const memberships = await client.query<WorkspaceArea>(`
    SELECT 'workspace' AS kind, tenant.id AS "tenantId", tenant.name AS "tenantName", membership.role
    FROM tenant_memberships membership JOIN tenants tenant ON tenant.id = membership.tenant_id
    WHERE membership.identity_user_id = $1 ORDER BY tenant.name, tenant.id
  `, [userId]);
  const accesses = await client.query<{ tenant_id: string; sponsor_id: string }>(`
    SELECT tenant_id, sponsor_id FROM sponsor_portal_access
    WHERE identity_user_id = $1 ORDER BY tenant_id, sponsor_id
  `, [userId]);
  const areas: AccountArea[] = [...memberships.rows];
  for (const access of accesses.rows) {
    // The tenant comes from this user's actual access, never request input.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [access.tenant_id]);
    const sponsor = await client.query<SponsorArea>(`
      SELECT 'sponsor' AS kind, tenant.id AS "tenantId", tenant.name AS "tenantName",
        sponsor.id AS "sponsorId", sponsor.legal_name AS "sponsorName"
      FROM sponsor_portal_access access
      JOIN sponsors sponsor ON sponsor.id = access.sponsor_id AND sponsor.tenant_id = access.tenant_id
      JOIN tenants tenant ON tenant.id = access.tenant_id
      WHERE access.identity_user_id = $1 AND access.tenant_id = $2 AND access.sponsor_id = $3
    `, [userId, access.tenant_id, access.sponsor_id]);
    areas.push(...sponsor.rows);
  }
  return areas.sort((a, b) => a.tenantName.localeCompare(b.tenantName, "de-CH")
    || a.kind.localeCompare(b.kind) || (a.kind === "sponsor" && b.kind === "sponsor" ? a.sponsorName.localeCompare(b.sponsorName, "de-CH") : 0));
}
