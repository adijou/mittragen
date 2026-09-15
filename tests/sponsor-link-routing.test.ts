import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { DatabaseClient } from "../netlify/functions/_shared/database.ts";
import { sponsorTargetQuery } from "../shared/sponsor-space-link.ts";

const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.includes("/node_modules/@netlify/identity/")) return { shortCircuit: true, format: "module", source: `
    let user; export const setTestUser = value => { user = value; };
    export const getUser = async () => user; export const refreshSession = async () => {};
    export const getIdentityConfig = () => ({ url: "https://identity.example.invalid" });
    export class AuthError extends Error {}
    export const verifyRequestOrigin = request => { if (request.headers.get("origin") !== new URL(request.url).origin) throw new AuthError("invalid origin"); };
  ` };
  if (url.endsWith("/netlify/functions/_shared/database.ts")) return { shortCircuit: true, format: "module", source: `
    let session; export const setTestSession = value => { session = value; };
    export const withSession = (...args) => session(...args);
    export const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  ` };
  return nextLoad(url, context);
} });
const { default: handler } = await import("../netlify/functions/sponsor-portal.mts");
const { setTestSession } = await import("../netlify/functions/_shared/database.ts") as never as { setTestSession: (fn: unknown) => void };
const { setTestUser } = await import("@netlify/identity") as never as { setTestUser: (user: unknown) => void };
hooks.deregister();

test("sponsor links select only their target and never fall back to an old space (real PostgreSQL RLS)", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } }); await db.waitReady;
  try {
    const migrations = new URL("../netlify/database/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations)).sort()) await db.exec(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8"));
    await db.exec(`CREATE ROLE link_test NOLOGIN; GRANT USAGE ON SCHEMA public TO link_test;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO link_test; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO link_test;`);
    setTestSession(async <T>(id: string, tenant: string | null, operation: (client: DatabaseClient) => Promise<T>, email?: string) => db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE link_test");
      await tx.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('app.user_email',$3,true)", [id, tenant ?? "", email ?? ""]);
      return operation({ query: async <Row>(sql: string, values?: unknown[]) => {
        const result = await tx.query<Row>(sql, values); return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      }, release() {} });
    }));
    const tenantA = randomUUID(); const tenantB = randomUUID(); const sponsorA = randomUUID(); const sponsorB = randomUUID();
    await db.query("INSERT INTO tenants(id,slug,name) VALUES ($1,'link-a','Verein A'),($2,'link-b','Verein B')", [tenantA, tenantB]);
    await db.query("INSERT INTO sponsors(id,tenant_id,legal_name) VALUES ($1,$2,'Sponsor A'),($3,$4,'Sponsor B')", [sponsorA, tenantA, sponsorB, tenantB]);
    await db.query("INSERT INTO sponsor_portal_access(tenant_id,sponsor_id,identity_user_id,email) VALUES ($1,$2,'account-a','a@example.invalid')", [tenantA, sponsorA]);
    await db.query("INSERT INTO sponsor_portal_invitations(tenant_id,sponsor_id,email,expires_at,invited_by,delivery_status) VALUES ($1,$2,'b@example.invalid',now()+interval '7 days','fixture','sent')", [tenantB, sponsorB]);
    const target = { tenantId: tenantB, sponsorId: sponsorB };
    const user = (id: string) => ({ id: `account-${id}`, email: `${id}@example.invalid`, confirmedAt: "2026-09-15T01:00:00Z" });
    const call = (id: string, path: string, method = "GET", body?: unknown, account?: string) => {
      setTestUser(user(id));
      return handler(new Request(`https://mittragen.example.invalid/api/sponsor-portal${path}`, {
        method, headers: { Origin: "https://mittragen.example.invalid", ...(account ? { "X-Sponsor-Account": account } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
      }), { requestId: "link-test", cookies: { get: () => undefined } } as never);
    };
    await t.test("account A cannot claim or read sponsor B and sees no fallback data", async () => {
      for (const response of [await call("a", "/claim", "POST", { target }), await call("a", `?${sponsorTargetQuery(target)}`)]) {
        assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: "sponsor_link_access_denied" });
      }
      assert.equal((await db.query("SELECT accepted_at FROM sponsor_portal_invitations WHERE sponsor_id=$1", [sponsorB])).rows[0].accepted_at, null);
    });
    await t.test("the intended verified recipient can claim and load exactly sponsor B", async () => {
      assert.equal((await call("b", "/claim", "POST", { target })).status, 200);
      const response = await call("b", `?${sponsorTargetQuery(target)}`);
      assert.equal(response.status, 200);
      const { spaces } = await response.json(); assert.equal(spaces.length, 1); assert.equal(spaces[0].sponsor.id, sponsorB);
    });
    await t.test("an account authorized for multiple spaces still lands on the linked sponsor", async () => {
      await db.query("INSERT INTO sponsor_portal_access(tenant_id,sponsor_id,identity_user_id,email) VALUES ($1,$2,'account-a','a@example.invalid')", [tenantB, sponsorB]);
      const { spaces } = await (await call("a", `?${sponsorTargetQuery(target)}`)).json();
      assert.deepEqual(spaces.map((space: { sponsor: { id: string } }) => space.sponsor.id), [sponsorB]);
    });
    await t.test("incomplete and forged targets fail closed, including wrong organization/sponsor combinations", async () => {
      assert.equal((await call("a", "?sponsor=invalid")).status, 422);
      assert.equal((await call("a", "/claim", "POST", { target: { sponsorId: sponsorB } })).status, 422);
      assert.equal((await call("a", `?${sponsorTargetQuery({ tenantId: tenantA, sponsorId: sponsorB })}`)).status, 403);
      assert.equal((await call("a", "/claim", "POST", { expectedEmail: "b@example.invalid" })).status, 403);
    });
    await t.test("changed cookies are rejected before reads or writes for the displayed account", async () => {
      for (const [path, method] of [["", "GET"], ["/claim", "POST"], ["/session", "GET"], [`/${tenantA}/${sponsorA}/contact`, "PATCH"], [`/${tenantA}/${sponsorA}/address`, "PATCH"], [`/${tenantA}/${sponsorA}/logo`, "POST"]]) {
        const response = await call("b", path, method, undefined, "account-a");
        assert.equal(response.status, 409); assert.equal((await response.json()).error, "sponsor_account_changed");
      }
    });
  } finally { await db.close(); }
});
