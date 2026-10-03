import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { DatabaseClient } from "../netlify/functions/_shared/database.ts";
import { claimSponsorInvitations } from "../netlify/functions/_shared/sponsor-access-invitations.ts";
import { accountAreaPath, selectWorkspaceTenant } from "../shared/account-areas.ts";
import { claimAccountAreas, readAccountAreas } from "../src/accountAreas.ts";

const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.includes("/node_modules/@netlify/identity/")) return { shortCircuit: true, format: "module", source: `
    let user; export const setTestUser = value => { user = value; };
    export const getUser = async () => user; export const refreshSession = async () => {};
    export const getIdentityConfig = () => ({ url: "https://identity.example.invalid" });
  ` };
  if (url.endsWith("/netlify/functions/_shared/database.ts")) return { shortCircuit: true, format: "module", source: `
    let session; export const setTestSession = value => { session = value; };
    export const withSession = (...args) => session(...args);
  ` };
  return nextLoad(url, context);
} });
const { default: handler } = await import("../netlify/functions/account-areas.mts");
const { setTestSession } = await import("../netlify/functions/_shared/database.ts") as never as { setTestSession: (fn: unknown) => void };
const { setTestUser } = await import("@netlify/identity") as never as { setTestUser: (user: unknown) => void };
hooks.deregister();

test("one verified account has isolated workspace and sponsor areas (PostgreSQL RLS)", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } }); await db.waitReady;
  try {
    const migrations = new URL("../netlify/database/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations)).sort()) await db.exec(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8"));
    await db.exec(`CREATE ROLE area_test NOLOGIN; GRANT USAGE ON SCHEMA public TO area_test;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO area_test; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO area_test;`);
    const session = async <T>(id: string, tenant: string | null, operation: (client: DatabaseClient) => Promise<T>, email?: string) => db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE area_test");
      await tx.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('app.user_email',$3,true)", [id, tenant ?? "", email ?? ""]);
      return operation({ query: async <Row>(sql: string, values?: unknown[]) => {
        const result = await tx.query<Row>(sql, values); return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      }, release() {} });
    });
    setTestSession(session);
    const tenantA = randomUUID(), tenantB = randomUUID(), tenantC = randomUUID();
    const sponsorB = randomUUID(), hiddenSponsor = randomUUID(), secondSponsor = randomUUID();
    const user = { id: "dual-user", email: "dual@example.invalid", confirmedAt: "2026-09-29T20:00:00Z" };
    await db.query("INSERT INTO tenants(id,slug,name) VALUES ($1,'area-a','Verein A'),($2,'area-b','Verein B'),($3,'area-c','Privater Verein C')", [tenantA, tenantB, tenantC]);
    await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES ($1,$2,'owner'),($3,'other-user','owner')", [tenantA, user.id, tenantC]);
    await db.query("INSERT INTO sponsors(id,tenant_id,legal_name) VALUES ($1,$2,'Meine Firma'),($3,$2,'Fremde Firma'),($4,$2,'Zweite Firma')", [sponsorB, tenantB, hiddenSponsor, secondSponsor]);
    await db.query("INSERT INTO sponsor_portal_access(tenant_id,sponsor_id,identity_user_id,email) VALUES ($1,$2,'other-user','other@example.invalid')", [tenantB, hiddenSponsor]);
    await db.query("INSERT INTO sponsor_portal_invitations(tenant_id,sponsor_id,email,expires_at,invited_by,delivery_status) VALUES ($1,$2,$3,now()+interval '7 days','fixture','sent')", [tenantB, sponsorB, user.email]);
    const request = (account = user.id, method = "GET") => new Request("https://mittragen.example.invalid/api/account/areas", { method, headers: { "X-Sponsor-Account": account } });
    const context = { requestId: "area-test", cookies: { get: () => undefined } } as never;
    const list = async () => { setTestUser(user); const res = await handler(request(), context); assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "no-store"); return (await res.json()).areas; };

    await t.test("listing does not accept invitations or expose unrelated organizations", async () => {
      assert.deepEqual(await list(), [{ kind: "workspace", tenantId: tenantA, tenantName: "Verein A", role: "owner" }]);
      assert.equal((await db.query("SELECT accepted_at FROM sponsor_portal_invitations WHERE sponsor_id=$1", [sponsorB])).rows[0].accepted_at, null);
    });
    await t.test("an invitation adds only the sponsor relationship to the existing administrator", async () => {
      assert.equal(await session(user.id, null, (client) => claimSponsorInvitations(client, user), user.email), 1);
      assert.deepEqual(await list(), [
        { kind: "workspace", tenantId: tenantA, tenantName: "Verein A", role: "owner" },
        { kind: "sponsor", tenantId: tenantB, tenantName: "Verein B", sponsorId: sponsorB, sponsorName: "Meine Firma" },
      ]);
      assert.deepEqual((await db.query("SELECT tenant_id,role FROM tenant_memberships WHERE identity_user_id=$1", [user.id])).rows, [{ tenant_id: tenantA, role: "owner" }]);
      assert.equal(await session(user.id, null, (client) => claimSponsorInvitations(client, user), user.email), 0);
    });
    await t.test("multiple sponsor companies in one organization stay distinct", async () => {
      await db.query("INSERT INTO sponsor_portal_access(tenant_id,sponsor_id,identity_user_id,email) VALUES ($1,$2,$3,$4)", [tenantB, secondSponsor, user.id, user.email]);
      const areas = await list(); assert.equal(areas.length, 3);
      assert.equal(areas.filter((area: { kind: string }) => area.kind === "sponsor").length, 2);
      assert.equal(new Set(areas.map(accountAreaPath)).size, 3);
    });
    await t.test("revoking sponsor access leaves the unrelated admin role unchanged", async () => {
      await db.query("DELETE FROM sponsor_portal_access WHERE identity_user_id=$1", [user.id]);
      assert.deepEqual(await list(), [{ kind: "workspace", tenantId: tenantA, tenantName: "Verein A", role: "owner" }]);
    });
    await t.test("authentication and account switches are checked before data is returned", async () => {
      setTestUser(null); assert.equal((await handler(request(), context)).status, 401);
      setTestUser(user); assert.equal((await handler(request("other-user"), context)).status, 409);
      assert.equal((await handler(request(user.id, "POST"), context)).status, 405);
    });
  } finally { await db.close(); }
});

test("a workspace target never falls back to another organization", () => {
  const tenants = [{ id: "a" }, { id: "b" }];
  assert.equal(selectWorkspaceTenant(tenants, "b", "a"), "b");
  assert.throws(() => selectWorkspaceTenant(tenants, "revoked", "a"), /workspace_link_access_denied/);
  assert.throws(() => selectWorkspaceTenant(tenants, "", "a"), /workspace_link_access_denied/);
  assert.equal(selectWorkspaceTenant(tenants, null, "stale-other-account"), "a");
});

test("area discovery pins all claims and reads to the current account and fails closed", async () => {
  const calls: string[] = [];
  await claimAccountAreas("current-user", async (url, init) => {
    assert.equal(new Headers(init?.headers).get("X-Sponsor-Account"), "current-user");
    calls.push(String(url)); return Response.json({ accountId: "current-user", areas: [] });
  });
  assert.deepEqual(calls, ["/api/sponsor-portal/claim", "/api/team/claim", "/api/account/areas"]);
  await assert.rejects(readAccountAreas("current-user", async () => Response.json({ accountId: "other-user", areas: [] })), /sponsor_account_changed/);
  await assert.rejects(readAccountAreas("current-user", async () => Response.json({ accountId: "current-user" })), /access_check_failed/);
  await assert.rejects(claimAccountAreas("current-user", async (url) => String(url).includes("team")
    ? Response.json({ error: "team_claim_failed" }, { status: 503 }) : Response.json({ claimed: 0 })), /team_claim_failed/);
});
