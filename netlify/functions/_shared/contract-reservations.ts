import type { DatabaseClient } from "./database.ts";

export async function ensureDirectReservation(client: DatabaseClient, tenantId: string, sponsorId: string, packageVersionId: string, actorId: string) {
  const existing = await client.query<{ id: string; status: "held" | "confirmed"; expired: boolean }>(`
    SELECT id, status, (expires_at IS NOT NULL AND expires_at <= now()) AS expired
    FROM sponsorship_package_reservations
    WHERE tenant_id = $1 AND sponsor_id = $2 AND package_version_id = $3
      AND status IN ('held', 'confirmed')
    LIMIT 1
  `, [tenantId, sponsorId, packageVersionId]);
  if (existing.rows[0]?.status === "confirmed") return true;
  if (existing.rows[0]?.status === "held" && !existing.rows[0].expired) return false;
  if (existing.rows[0]?.status === "held") {
    await client.query(`UPDATE sponsorship_package_reservations
      SET status = 'released', updated_at = now()
      WHERE tenant_id = $1 AND id = $2`, [tenantId, existing.rows[0].id]);
  }
  await client.query(`INSERT INTO sponsorship_package_reservations
    (tenant_id, package_version_id, sponsor_id, status, created_by)
    VALUES ($1, $2, $3, 'confirmed', $4)`,
    [tenantId, packageVersionId, sponsorId, actorId]);
  return true;
}

export async function nextContractNumber(client: DatabaseClient, tenantId: string) {
  const year = new Date().getUTCFullYear();
  const counter = await client.query<{ last_value: number }>(`
    INSERT INTO contract_number_counters (tenant_id, contract_year, last_value) VALUES ($1,$2,1)
    ON CONFLICT (tenant_id, contract_year) DO UPDATE SET last_value = contract_number_counters.last_value + 1
    RETURNING last_value
  `, [tenantId, year]);
  return `MT-${year}-${String(counter.rows[0].last_value).padStart(4, "0")}`;
}
