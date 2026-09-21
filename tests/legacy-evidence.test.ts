import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('PostgreSQL keeps unknown historical evidence explicit and immutable without weakening electronic confirmations', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.waitReady;
  try {
    const migrations = new URL('../netlify/database/migrations/', import.meta.url);
    for (const directory of (await readdir(migrations)).sort()) await db.exec(await readFile(new URL(`${directory}/migration.sql`, migrations), 'utf8'));
    const tenant = randomUUID(), sponsor = randomUUID(), pack = randomUUID(), version = randomUUID();
    await db.query("INSERT INTO tenants(id,slug,name) VALUES($1,'legacy','Legacy')", [tenant]);
    await db.query("INSERT INTO sponsors(id,tenant_id,legal_name) VALUES($1,$2,'Sponsor')", [sponsor,tenant]);
    await db.query("INSERT INTO sponsorship_packages(id,tenant_id,created_by) VALUES($1,$2,'admin')", [pack,tenant]);
    await db.query("INSERT INTO sponsorship_package_versions(id,tenant_id,package_id,version_number,name,price_cents,duration_months,payment_plan,created_by) VALUES($1,$2,$3,1,'Internal',20000,36,'annual','admin')", [version,tenant,pack]);
    const insert = async (mode: string | null, status = 'confirmed') => {
      const id = randomUUID();
      await db.query(`INSERT INTO sponsorship_contracts(id,tenant_id,sponsor_id,package_version_id,contract_number,status,snapshot_hash,released_at,created_by,
        confirmed_by,confirmed_email,confirmed_role,confirmation_mode,confirmation_recorded_at,confirmation_note,package_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,now(),'admin','admin','admin@example.invalid','Unbekannt',$8,now(),'Source row 2','{"priceCents":0}')`,
      [id,tenant,sponsor,version,`TEST-${id}`,status,'a'.repeat(64),mode]);
      return id;
    };
    const id = await insert('admin_legacy');
    const result = await db.query('SELECT confirmed_at,confirmed_name,confirmation_recorded_at FROM sponsorship_contracts WHERE id=$1',[id]);
    assert.equal(result.rows[0].confirmed_at,null); assert.equal(result.rows[0].confirmed_name,null); assert.ok(result.rows[0].confirmation_recorded_at);
    for (const mode of [null,'authenticated_account','one_time_link','legacy_portal']) await assert.rejects(insert(mode), /check constraint/);
    await assert.rejects(db.query("UPDATE sponsorship_contracts SET confirmed_name='Invented' WHERE id=$1",[id]), /confirmed_contract_is_immutable/);
    await assert.rejects(db.query("UPDATE sponsorship_contracts SET package_snapshot='{}' WHERE id=$1",[id]), /released_contract_is_immutable/);
    const released = randomUUID();
    await db.query(`INSERT INTO sponsorship_contracts(id,tenant_id,sponsor_id,package_version_id,contract_number,status,snapshot_hash,released_at,created_by)
      VALUES($1,$2,$3,$4,$5,'released',$6,now(),'admin')`,[released,tenant,sponsor,version,`TEST-${released}`,'a'.repeat(64)]);
    await assert.rejects(db.query(`UPDATE sponsorship_contracts SET status='confirmed',confirmed_by='admin',confirmed_email='a@example.invalid',confirmed_role='Signer',confirmation_mode='one_time_link',confirmation_recorded_at=now() WHERE id=$1`,[released]),/contract_confirmation_evidence_required/);
    await db.query(`UPDATE sponsorship_contracts SET status='confirmed',confirmed_by='admin',confirmed_email='a@example.invalid',confirmed_role='Unbekannt',confirmation_mode='admin_legacy',confirmation_recorded_at=now(),confirmation_note='Source' WHERE id=$1`,[released]);
    // Exercise the production overview query under a role subject to tenant RLS.
    const emptySponsor = randomUUID(), foreignTenant = randomUUID(), foreignSponsor = randomUUID();
    await db.query("INSERT INTO sponsors(id,tenant_id,legal_name) VALUES($1,$2,'No package')",[emptySponsor,tenant]);
    await db.query("INSERT INTO tenants(id,slug,name) VALUES($1,'foreign','Foreign')",[foreignTenant]);
    await db.query("INSERT INTO sponsors(id,tenant_id,legal_name) VALUES($1,$2,'Foreign sponsor')",[foreignSponsor,foreignTenant]);
    await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES($1,'admin','owner')",[tenant]);
    await db.exec("CREATE ROLE legacy_test NOLOGIN; GRANT USAGE ON SCHEMA public TO legacy_test; GRANT SELECT ON ALL TABLES IN SCHEMA public TO legacy_test");
    const source = await readFile(new URL('../netlify/functions/sponsors.mts',import.meta.url),'utf8');
    const queryStart = source.indexOf('SELECT sponsor.id, sponsor.tenant_id');
    const queryEnd = source.indexOf('`, [tenantId]);',queryStart);
    const sql = source.slice(queryStart,queryEnd);
    await db.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE legacy_test');
      await tx.query("SELECT set_config('app.user_id','admin',true),set_config('app.tenant_id',$1,true)",[tenant]);
      const overview = await tx.query<{id:string;package_assignments:Array<{annual_value_cents:number;contract_id:string}>}>(sql,[tenant]);
      assert.equal(overview.rows.length,2);
      assert.deepEqual(overview.rows.find(row=>row.id===emptySponsor)?.package_assignments,[]);
      assert.equal(overview.rows.find(row=>row.id===sponsor)?.package_assignments.find(item=>item.contract_id===id)?.annual_value_cents,0);
      assert.equal((await tx.query(sql,[foreignTenant])).rows.length,0);
    });
  } finally { await db.close(); }
});
