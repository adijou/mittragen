import type { DatabaseClient } from "./database.ts";

export type MatchInfoPartner = { sponsorName:string; packageName:string };

export function matchInfoPartnerLevel(packageName:string):"Gold"|"Silber"|null {
  if(/gold/i.test(packageName))return "Gold";
  if(/silber|silver/i.test(packageName))return "Silber";
  return null;
}

/** Match the sponsor overview: confirmed contracts take priority over the legacy assignment. */
export async function listMatchInfoPartners(client:DatabaseClient,tenantId:string):Promise<MatchInfoPartner[]> {
  const result=await client.query<{sponsor_id:string;sponsor_name:string;package_name:string}>(`
    WITH confirmed_packages AS (
      SELECT contract.sponsor_id,
        COALESCE(NULLIF(btrim(contract.package_snapshot->>'name'),''),version.name) AS package_name
      FROM sponsorship_contracts contract
      JOIN sponsorship_package_versions version ON version.id=contract.package_version_id AND version.tenant_id=contract.tenant_id
      WHERE contract.tenant_id=$1 AND contract.status='confirmed'
    ), partner_packages AS (
      SELECT sponsor_id,package_name FROM confirmed_packages
      UNION ALL
      SELECT sponsor.id,version.name FROM sponsors sponsor
      JOIN sponsorship_package_versions version ON version.id=sponsor.assigned_package_version_id AND version.tenant_id=sponsor.tenant_id
      WHERE sponsor.tenant_id=$1 AND NOT EXISTS (SELECT 1 FROM confirmed_packages confirmed WHERE confirmed.sponsor_id=sponsor.id)
    )
    SELECT sponsor.id AS sponsor_id,sponsor.legal_name AS sponsor_name,partner.package_name
    FROM partner_packages partner JOIN sponsors sponsor ON sponsor.id=partner.sponsor_id AND sponsor.tenant_id=$1
    WHERE sponsor.status<>'inactive'
    ORDER BY lower(sponsor.legal_name),sponsor.id`,[tenantId]);
  const partners=new Map<string,MatchInfoPartner>();
  for(const row of result.rows){
    const level=matchInfoPartnerLevel(row.package_name);
    if(!level)continue;
    const previous=partners.get(row.sponsor_id);
    // Multiple contracts must not print a sponsor repeatedly; Gold is the higher category.
    if(!previous||level==='Gold')partners.set(row.sponsor_id,{sponsorName:row.sponsor_name,packageName:row.package_name});
  }
  return [...partners.values()];
}
