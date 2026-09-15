import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { claimContractSpaces, parseSponsorAddress, updateSponsorAddress } from "../netlify/functions/_shared/sponsor-self-service.ts";
import type { DatabaseClient } from "../netlify/functions/_shared/database.ts";
import { clearSponsorEntry, prepareSponsorAccess, readSponsorEntry, shouldOpenSponsorSpace } from "../src/sponsorAccess.ts";
import { claimSponsorInvitations, loadSponsorAccess, prepareSponsorAccessInvitation, recordSponsorAccessDelivery } from "../netlify/functions/_shared/sponsor-access-invitations.ts";
import { verifySponsorIdentity } from "../netlify/functions/_shared/sponsor-identity.ts";

const original = { street: "Alte Gasse 1", postal_code: "3178", city: "Bösingen" };
const newAddress = { street: "Neue Gasse 12", postal_code: "3186", city: "Düdingen" };

test("address input accepts postal addresses without allowing other sponsor fields to change", () => {
  const valid = { ...newAddress, original };
  assert.deepEqual(parseSponsorAddress({ ...valid, street: "  Neue Gasse 12  " }), { ok: true, value: valid });
  for (const extra of ["tenant_id", "sponsor_id", "identity_user_id", "contact_email", "status", "annual_value_cents", "legal_name"]) {
    assert.deepEqual(parseSponsorAddress({ ...valid, [extra]: "modified" }), { ok: false, error: "address_fields_only" });
  }
  for (const invalid of [null, [], {}, { ...valid, original: {} }, { ...valid, street: " " }, { ...valid, city: "x".repeat(121) }, { ...valid, street: "Strasse\u0000" }]) {
    assert.equal(parseSponsorAddress(invalid).ok, false);
  }
  assert.equal(parseSponsorAddress({ ...valid, postal_code: "SW1A 1AA" }).ok, true);
});

test("sponsor registration hints survive the login handoff and are cleared afterwards", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  } as Storage;
  assert.equal(readSponsorEntry(storage), null);
  prepareSponsorAccess({ email: "signer@example.invalid", name: "Testperson", mode: "signup" }, storage);
  assert.deepEqual(readSponsorEntry(storage), { email: "signer@example.invalid", name: "Testperson", mode: "signup" });
  clearSponsorEntry(storage);
  assert.equal(readSponsorEntry(storage), null);
  prepareSponsorAccess({ mode: "login" }, storage);
  storage.setItem("mittragen-sponsor-entry", "invalid JSON");
  assert.deepEqual(readSponsorEntry(storage), { mode: "login" });
});

test("returning sponsors reach their space without changing the default workspace of a dual-role administrator", () => {
  assert.equal(shouldOpenSponsorSpace({ hasAccess: true, hasWorkspace: false, claimed: 0 }), true);
  assert.equal(shouldOpenSponsorSpace({ hasAccess: true, hasWorkspace: true, claimed: 0 }), false);
  assert.equal(shouldOpenSponsorSpace({ hasAccess: true, hasWorkspace: true, claimed: 1 }), true);
  assert.equal(shouldOpenSponsorSpace({ hasAccess: false, hasWorkspace: true }), false);
  assert.equal(shouldOpenSponsorSpace({}), false);
});

test("self-service runs against PostgreSQL with real migrations and a role subject to RLS", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.waitReady;
  try {
    const migrations = new URL("../netlify/database/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations)).sort()) {
      await db.exec(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8"));
    }
    await db.exec(`CREATE ROLE sponsor_test NOLOGIN;
      GRANT USAGE ON SCHEMA public TO sponsor_test;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO sponsor_test;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO sponsor_test;`);
    const tenantA = randomUUID(); const tenantB = randomUUID();
    await db.query("INSERT INTO tenants (id, slug, name) VALUES ($1,'test-a','Testverein A'),($2,'test-b','Testverein B')", [tenantA, tenantB]);
    const fixture = async (tenantId: string, email: string, status: "confirmed" | "sent" | "revoked") => {
      const sponsorId = randomUUID(); const contractId = randomUUID(); const packageId = randomUUID(); const versionId = randomUUID();
      await db.query("INSERT INTO sponsors (id,tenant_id,legal_name,street,postal_code,city) VALUES ($1,$2,'Testsponsor',$3,$4,$5)", [sponsorId, tenantId, original.street, original.postal_code, original.city]);
      await db.query("INSERT INTO sponsorship_packages (id,tenant_id,created_by) VALUES ($1,$2,'fixture')", [packageId, tenantId]);
      await db.query(`INSERT INTO sponsorship_package_versions (id,tenant_id,package_id,version_number,name,price_cents,duration_months,payment_plan,created_by)
        VALUES ($1,$2,$3,1,'Testpaket',100000,36,'annual','fixture')`, [versionId, tenantId, packageId]);
      await db.query(`INSERT INTO sponsorship_contracts (id,tenant_id,sponsor_id,package_version_id,contract_number,status,snapshot_hash,released_at,created_by,sponsor_snapshot)
        VALUES ($1,$2,$3,$4,$5,'released',$6,now(),'fixture',$7::jsonb)`, [contractId, tenantId, sponsorId, versionId, `TEST-${contractId}`, "a".repeat(64), JSON.stringify(original)]);
      await db.query(`INSERT INTO contract_signing_requests
        (tenant_id,contract_id,sponsor_id,signer_email,signer_name,signer_role,delivery_mode,token_hash,status,expires_at,confirmed_at,created_by)
        VALUES ($1,$2,$3,$4,'Testperson','Vertretung','one_time',$5,$6,now() - interval '1 day',CASE WHEN $6 = 'confirmed' THEN now() ELSE NULL END,'fixture')`,
      [tenantId, contractId, sponsorId, email, randomUUID().replaceAll("-", "").repeat(2), status]);
      return { tenantId, sponsorId, contractId };
    };
    const signed = await fixture(tenantA, "Signer@Example.invalid", "confirmed");
    const other = await fixture(tenantA, "other@example.invalid", "confirmed");
    const foreign = await fixture(tenantB, "foreign@example.invalid", "confirmed");
    await fixture(tenantA, "pending@example.invalid", "sent");
    await fixture(tenantB, "revoked@example.invalid", "revoked");
    const user = { id: "signer-account", email: "signer@example.invalid", confirmedAt: new Date().toISOString() };
    const session = async <T>(identity: typeof user, tenantId: string | null, fn: (client: DatabaseClient) => Promise<T>) => {
      return db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE sponsor_test");
        await tx.query("SELECT set_config('app.user_id',$1,true), set_config('app.user_email',$2,true), set_config('app.tenant_id',$3,true)", [identity.id, identity.email, tenantId ?? ""]);
        const client: DatabaseClient = {
          query: async <Row>(sql: string, params?: unknown[]) => {
            const result = await tx.query<Row>(sql, params);
            return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
          },
          release: () => {},
        };
        return fn(client);
      });
    };

    await t.test("only confirmed requests matching the verified email can be discovered without a tenant", async () => {
      await session(user, null, async (client) => {
        const rows = await client.query<{ sponsor_id: string }>("SELECT sponsor_id FROM contract_signing_requests");
        assert.deepEqual(rows.rows.map((row) => row.sponsor_id), [signed.sponsorId]);
        assert.equal(await claimContractSpaces(client, { ...user, confirmedAt: undefined }), 0);
      });
      for (const email of ["pending@example.invalid", "revoked@example.invalid", "unknown@example.invalid"]) {
        assert.equal(await session({ ...user, email }, null, (client) => claimContractSpaces(client, { ...user, email })), 0);
      }
    });

    await t.test("confirmation unlocks documents after verified signup, even after the signing link expires", async () => {
      const before = await session(user, tenantA, (client) => client.query("SELECT id FROM sponsorship_contracts"));
      assert.equal(before.rows.length, 0);
      assert.equal(await session(user, null, (client) => claimContractSpaces(client, user)), 1);
      assert.equal(await session(user, null, (client) => claimContractSpaces(client, user)), 0);
      const ownDocuments = await session(user, tenantA, (client) => client.query<{ id: string }>("SELECT id FROM sponsorship_contracts"));
      assert.deepEqual(ownDocuments.rows.map((row) => row.id), [signed.contractId]);
      const foreignDocuments = await session(user, tenantB, (client) => client.query("SELECT id FROM sponsorship_contracts"));
      assert.equal(foreignDocuments.rows.length, 0);
      const access = await db.query<{ identity_user_id: string; sponsor_id: string }>("SELECT identity_user_id,sponsor_id FROM sponsor_portal_access");
      assert.deepEqual(access.rows, [{ identity_user_id: user.id, sponsor_id: signed.sponsorId }]);
    });

    await t.test("address writes deny both another sponsor in the same tenant and another tenant", async () => {
      for (const target of [other, foreign]) {
        const result = await session(user, target.tenantId, (client) => updateSponsorAddress(client, target.tenantId, target.sponsorId, user.id, { ...newAddress, original }));
        assert.equal(result.state, "denied");
      }
    });

    await t.test("address changes persist, are audited and do not rewrite the released contract", async () => {
      const result = await session(user, tenantA, (client) => updateSponsorAddress(client, tenantA, signed.sponsorId, user.id, { ...newAddress, original }));
      assert.deepEqual(result, { state: "saved", address: newAddress });
      const sponsor = await db.query("SELECT street,postal_code,city FROM sponsors WHERE id=$1", [signed.sponsorId]);
      assert.deepEqual(sponsor.rows[0], newAddress);
      const contract = await db.query<{ sponsor_snapshot: unknown; snapshot_hash: string }>("SELECT sponsor_snapshot,snapshot_hash FROM sponsorship_contracts WHERE id=$1", [signed.contractId]);
      assert.deepEqual(contract.rows[0], { sponsor_snapshot: original, snapshot_hash: "a".repeat(64) });
      const audit = await db.query<{ metadata: unknown }>("SELECT metadata FROM audit_events WHERE action='sponsor.address_updated' AND object_id=$1", [signed.sponsorId]);
      assert.deepEqual(audit.rows[0].metadata, { source: "sponsor_portal", before: original, after: newAddress });
      const stale = await session(user, tenantA, (client) => updateSponsorAddress(client, tenantA, signed.sponsorId, user.id, { ...original, original }));
      assert.equal(stale.state, "conflict");
    });

    const administrator = { ...user, id: "admin-a", email: "admin@example.invalid" };
    await db.query("INSERT INTO tenant_memberships (tenant_id,identity_user_id,role) VALUES ($1,$2,'sponsoring_admin'),($1,'viewer-a','viewer')", [tenantA, administrator.id]);
    const bareSponsor = randomUUID();
    await db.query("INSERT INTO sponsors (id,tenant_id,legal_name,contact_email) VALUES ($1,$2,'Importierter Sponsor','original@example.invalid')", [bareSponsor, tenantA]);
    const invite = (email: string, sponsorId = bareSponsor) => session(administrator, tenantA,
      (client) => prepareSponsorAccessInvitation(client, tenantA, sponsorId, administrator.id, email));
    const deliver = (invitation: { id: string; updated_at: string }, result: { emailId: string } | { error: string }, sponsorId = bareSponsor) => session(administrator, tenantA,
      (client) => recordSponsorAccessDelivery(client, tenantA, sponsorId, administrator.id, invitation, result));

    await t.test("direct invitations require sponsor administration and the correct organization", async () => {
      for (const identity of [user, { ...user, id: "viewer-a" }]) {
        const prepared = await session(identity, tenantA, (client) => prepareSponsorAccessInvitation(client, tenantA, bareSponsor, identity.id, "recipient@example.invalid"));
        assert.equal(prepared.state, "denied");
        const access = await session(identity, tenantA, (client) => loadSponsorAccess(client, tenantA, bareSponsor, identity.id));
        assert.equal(access.state, "denied");
      }
      assert.equal((await invite("recipient@example.invalid", foreign.sponsorId)).state, "not_found");
      const otherTenant = await session(administrator, tenantB, (client) => prepareSponsorAccessInvitation(client, tenantB, foreign.sponsorId, administrator.id, "recipient@example.invalid"));
      assert.equal(otherTenant.state, "denied");
      assert.equal((await db.query("SELECT id FROM sponsor_portal_invitations")).rows.length, 0);
    });

    await t.test("an imported sponsor needs no contract; only a sent invitation and verified recipient grant access", async () => {
      const recipient = { ...user, id: "new-sponsor-account", email: "invited@example.invalid" };
      const prepared = await invite(recipient.email);
      assert.equal(prepared.state, "ready");
      if (prepared.state !== "ready") throw new Error("invitation not prepared");
      assert.equal((await db.query("SELECT id FROM sponsorship_contracts WHERE sponsor_id=$1", [bareSponsor])).rows.length, 0);
      assert.equal(await session(recipient, null, (client) => claimSponsorInvitations(client, recipient)), 0);
      assert.equal((await invite(recipient.email)).state, "busy");
      await deliver(prepared.invitation, { emailId: "fake-email-id" });
      assert.equal(await session(recipient, null, (client) => claimSponsorInvitations(client, { ...recipient, confirmedAt: undefined })), 0);
      const wrong = { ...recipient, email: "wrong@example.invalid", id: "wrong-account" };
      assert.equal(await session(wrong, null, (client) => claimSponsorInvitations(client, wrong)), 0);
      const recovered = await verifySponsorIdentity({ ...recipient, confirmedAt: undefined }, "test-user-token",
        "https://identity.example.invalid", async () => Response.json({
          id: recipient.id, email: recipient.email, confirmed_at: recipient.confirmedAt,
        }));
      assert.ok(recovered.user);
      assert.equal(await session(recipient, null, (client) => claimSponsorInvitations(client, recovered.user!)), 1);
      assert.equal(await session(recipient, null, (client) => claimSponsorInvitations(client, recipient)), 0);
      const access = await session(administrator, tenantA, (client) => loadSponsorAccess(client, tenantA, bareSponsor, administrator.id));
      assert.equal(access.state, "ready");
      if (access.state !== "ready") throw new Error("access missing");
      assert.deepEqual(access.accounts.map((item) => item.email), [recipient.email]);
      assert.ok(access.invitations[0].accepted_at);
      assert.equal(access.invitations[0].delivery_status, "sent");
      assert.equal((await db.query<{ contact_email: string }>("SELECT contact_email FROM sponsors WHERE id=$1", [bareSponsor])).rows[0].contact_email, "original@example.invalid");
      assert.equal((await db.query("SELECT id FROM tenant_memberships WHERE identity_user_id=$1", [recipient.id])).rows.length, 0);
      const audit = await db.query<{ action: string }>("SELECT action FROM audit_events WHERE object_id=$1 ORDER BY created_at", [bareSponsor]);
      assert.deepEqual(audit.rows.map((item) => item.action), ["sponsor.access_invitation_prepared", "sponsor.access_invitation_sent", "sponsor.access_activated"]);
    });

    await t.test("failed and expired invitations cannot grant access; resending reuses the invitation and protects newer results", async () => {
      const recipient = { ...user, id: "retry-account", email: "retry@example.invalid" };
      const first = await invite(recipient.email);
      if (first.state !== "ready") throw new Error("first invitation missing");
      await deliver(first.invitation, { error: "mail_unavailable" });
      assert.equal(await session(recipient, null, (client) => claimSponsorInvitations(client, recipient)), 0);
      const second = await invite(recipient.email);
      if (second.state !== "ready") throw new Error("retry invitation missing");
      assert.equal(second.invitation.id, first.invitation.id);
      await assert.rejects(deliver(first.invitation, { emailId: "late-old-result" }), /invitation_delivery_conflict/);
      await deliver(second.invitation, { emailId: "fake-retry-mail" });
      await db.query("UPDATE sponsor_portal_invitations SET expires_at=now()-interval '1 day',sent_at=now()-interval '2 minutes' WHERE id=$1", [second.invitation.id]);
      assert.equal(await session(recipient, null, (client) => claimSponsorInvitations(client, recipient)), 0);
      const third = await invite(recipient.email);
      if (third.state !== "ready") throw new Error("expired retry missing");
      await deliver(third.invitation, { emailId: "fake-renewed-mail" });
      assert.equal(await session(recipient, null, (client) => claimSponsorInvitations(client, recipient)), 1);
      const matches = await db.query("SELECT id FROM sponsor_portal_invitations WHERE sponsor_id=$1 AND email=$2", [bareSponsor, recipient.email]);
      assert.equal(matches.rows.length, 1);
    });

    await t.test("a direct invitation reveals the imported legacy contract only to its recipient and leaves the contract unchanged", async () => {
      const recipient = { ...user, id: "legacy-account", email: "legacy@example.invalid" };
      const legacy = await fixture(tenantA, recipient.email, "confirmed");
      await db.query("DELETE FROM contract_signing_requests WHERE contract_id=$1", [legacy.contractId]);
      await db.query(`UPDATE sponsorship_contracts SET status='confirmed',confirmed_at=now(),confirmation_mode='admin_legacy',
        confirmed_by='fixture',confirmed_email='legacy@example.invalid',confirmed_name='Testperson',confirmed_role='Vertretung',
        confirmation_recorded_at=now(),confirmation_note='Papiervertrag im Testarchiv' WHERE id=$1`, [legacy.contractId]);
      const prepared = await invite(recipient.email, legacy.sponsorId);
      if (prepared.state !== "ready") throw new Error("legacy invitation missing");
      await deliver(prepared.invitation, { emailId: "fake-legacy-mail" }, legacy.sponsorId);
      assert.equal(await session(recipient, null, (client) => claimSponsorInvitations(client, recipient)), 1);
      const documents = await session(recipient, tenantA, (client) => client.query<{ id: string }>("SELECT id FROM sponsorship_contracts"));
      assert.deepEqual(documents.rows.map((row) => row.id), [legacy.contractId]);
      const otherDocuments = await session(recipient, tenantB, (client) => client.query("SELECT id FROM sponsorship_contracts"));
      assert.equal(otherDocuments.rows.length, 0);
      const contract = await db.query<{ sponsor_snapshot: unknown; snapshot_hash: string; confirmation_mode: string }>("SELECT sponsor_snapshot,snapshot_hash,confirmation_mode FROM sponsorship_contracts WHERE id=$1", [legacy.contractId]);
      assert.deepEqual(contract.rows[0], { sponsor_snapshot: original, snapshot_hash: "a".repeat(64), confirmation_mode: "admin_legacy" });
      assert.equal((await db.query("SELECT id FROM contract_signing_requests WHERE contract_id=$1", [legacy.contractId])).rows.length, 0);
    });
  } finally { await db.close(); }
});
