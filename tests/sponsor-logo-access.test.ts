import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { DatabaseClient } from "../netlify/functions/_shared/database.ts";

// Run the real route and SQL with RLS. Replace only Identity and blob storage,
// and bind the production transaction boundary to the isolated test database.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/node_modules/@netlify/identity/")) return { shortCircuit: true, format: "module", source: `
      let user;
      export const setTestUser = value => { user = value; };
      export const getUser = async () => user;
      export const refreshSession = async () => {};
      export class AuthError extends Error {}
      export const verifyRequestOrigin = request => {
        if (request.headers.get("origin") !== new URL(request.url).origin) throw new AuthError("invalid origin");
      };
    ` };
    if (url.includes("/node_modules/@netlify/blobs/")) return { shortCircuit: true, format: "module", source: `
      export const blobs = new Map();
      let fail = false;
      export const failNextWrite = () => { fail = true; };
      export const getStore = () => ({
        get: async key => blobs.get(key) ?? null,
        set: async (key, value) => { if (fail) { fail = false; throw new Error("simulated storage failure"); } blobs.set(key, value); },
        delete: async key => { blobs.delete(key); },
      });
    ` };
    if (url.endsWith("/netlify/functions/_shared/database.ts")) return { shortCircuit: true, format: "module", source: `
      let session;
      export const setTestSession = value => { session = value; };
      export const withSession = (...args) => session(...args);
      export const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    ` };
    return nextLoad(url, context);
  },
});
const { default: adminHandler, config } = await import("../netlify/functions/sponsors.mts");
const { handleSponsorLogo } = await import("../netlify/functions/_shared/sponsor-logo.ts");
const { setTestSession } = await import("../netlify/functions/_shared/database.ts") as never as { setTestSession: (fn: unknown) => void };
const { setTestUser } = await import("@netlify/identity") as never as { setTestUser: (user: unknown) => void };
const { blobs, failNextWrite } = await import("@netlify/blobs") as never as { blobs: Map<string, ArrayBuffer>; failNextWrite: () => void };
hooks.deregister();

test("admin and sponsor share logo storage while permissions and RLS protect every operation", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.waitReady;
  try {
    const migrations = new URL("../netlify/database/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations)).sort()) await db.exec(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8"));
    await db.exec(`CREATE ROLE logo_test NOLOGIN; GRANT USAGE ON SCHEMA public TO logo_test;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO logo_test; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO logo_test;`);
    setTestSession(async <T>(id: string, tenant: string, operation: (client: DatabaseClient) => Promise<T>, email?: string) => db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE logo_test");
      await tx.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('app.user_email',$3,true)", [id, tenant, email ?? ""]);
      return operation({ query: async <Row>(sql: string, values?: unknown[]) => {
        const result = await tx.query<Row>(sql, values); return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      }, release() {} });
    }));
    const tenant = randomUUID(); const otherTenant = randomUUID(); const sponsor = randomUUID(); const otherSponsor = randomUUID();
    await db.query("INSERT INTO tenants(id,slug,name) VALUES ($1,'logo-a','Verein A'),($2,'logo-b','Verein B')", [tenant, otherTenant]);
    await db.query("INSERT INTO sponsors(id,tenant_id,legal_name) VALUES ($1,$2,'Sponsor A'),($3,$4,'Sponsor B')", [sponsor, tenant, otherSponsor, otherTenant]);
    for (const role of ["owner", "sponsoring_admin", "viewer", "finance", "fulfillment"]) {
      await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES ($1,$2,$3)", [tenant, role, role]);
    }
    await db.query("INSERT INTO sponsor_portal_access(tenant_id,sponsor_id,identity_user_id,email) VALUES ($1,$2,'sponsor','sponsor@example.invalid')", [tenant, sponsor]);
    const png = await readFile(new URL("../public/brand/mittragen-icon-email.png", import.meta.url));
    const user = (id: string) => ({ id, email: `${id}@example.invalid` });
    const request = (method: string, targetTenant = tenant, targetSponsor = sponsor, validOrigin = true, validImage = true) => {
      const form = new FormData();
      form.set("logo", new Blob([validImage ? png : new Uint8Array([1, 2, 3])], { type: "image/png" }), "logo.png");
      return new Request(`https://mittragen.example.invalid/api/sponsors/${targetTenant}/${targetSponsor}/logo`, {
        method, headers: { Origin: validOrigin ? "https://mittragen.example.invalid" : "https://foreign.example.invalid" }, body: method === "POST" ? form : undefined,
      });
    };
    const callAdmin = async (id: string, method: string, targetTenant = tenant, targetSponsor = sponsor, validOrigin = true, validImage = true) => {
      setTestUser(user(id));
      return adminHandler(request(method, targetTenant, targetSponsor, validOrigin, validImage), { requestId: "logo-test", params: { tenantId: targetTenant, sponsorId: targetSponsor } } as never);
    };

    await t.test("route is registered and denies viewers, unrelated sponsors and cross-tenant writes", async () => {
      assert.ok(config.path?.includes("/api/sponsors/:tenantId/:sponsorId/logo"));
      for (const id of ["viewer", "finance", "fulfillment", "sponsor", "unknown"]) {
        assert.equal((await callAdmin(id, "POST")).status, 403);
        assert.equal((await callAdmin(id, "DELETE")).status, 403);
      }
      assert.equal((await callAdmin("owner", "POST", otherTenant, otherSponsor)).status, 403);
      assert.equal((await callAdmin("owner", "GET", tenant, otherSponsor)).status, 403);
      assert.equal((await callAdmin("owner", "POST", tenant, sponsor, false)).status, 403);
      assert.equal((await callAdmin("owner", "POST", tenant, sponsor, true, false)).status, 422);
      assert.equal(blobs.size, 0);
    });

    await t.test("admin upload is visible to sponsor and read-only admin roles without exposing blob keys in the directory", async () => {
      const saved = await callAdmin("sponsoring_admin", "POST");
      assert.equal(saved.status, 200);
      assert.equal((await saved.json()).logo.available, true);
      assert.equal(blobs.size, 1);
      for (const id of ["owner", "viewer", "finance", "fulfillment"]) {
        const read = await callAdmin(id, "GET"); assert.equal(read.status, 200);
        assert.equal(read.headers.get("Cache-Control"), "private, no-store");
        assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
      }
      const read = await handleSponsorLogo(request("GET"), { requestId: "test" } as never, user("sponsor"), tenant, sponsor);
      assert.equal(read.status, 200);
      setTestUser(user("owner"));
      const directory = await adminHandler(new Request(`https://mittragen.example.invalid/api/sponsors/${tenant}`), { params: { tenantId: tenant } } as never);
      const row = (await directory.json()).sponsors[0];
      assert.equal(row.logo_available, true); assert.ok(row.logo_updated_at); assert.equal("logo_blob_key" in row, false);
    });

    await t.test("sponsor replacement updates the shared logo, removes the old blob and logs the actor", async () => {
      const oldKey = [...blobs.keys()][0];
      const replacement = await handleSponsorLogo(request("POST"), { requestId: "test" } as never, user("sponsor"), tenant, sponsor);
      assert.equal(replacement.status, 200); assert.equal(blobs.size, 1); assert.equal(blobs.has(oldKey), false);
      assert.equal((await callAdmin("owner", "GET")).status, 200);
      const audit = await db.query<{ actor_user_id: string; metadata: { source: string } }>("SELECT actor_user_id,metadata FROM audit_events WHERE action='sponsor.logo_updated' ORDER BY created_at");
      assert.deepEqual(audit.rows.map((row) => [row.actor_user_id, row.metadata.source]), [["sponsoring_admin", "admin"], ["sponsor", "sponsor"]]);
    });

    await t.test("failed uploads preserve the previous logo and deletion is reflected in both spaces", async () => {
      const oldKey = [...blobs.keys()][0];
      t.mock.method(console, "error", () => {});
      failNextWrite(); assert.equal((await callAdmin("owner", "POST")).status, 500);
      assert.equal(blobs.has(oldKey), true); assert.equal(blobs.size, 1);
      assert.equal((await callAdmin("owner", "DELETE")).status, 200); assert.equal(blobs.size, 0);
      assert.equal((await callAdmin("owner", "GET")).status, 404);
      assert.equal((await handleSponsorLogo(request("GET"), { requestId: "test" } as never, user("sponsor"), tenant, sponsor)).status, 404);
      const result = await db.query<{ logo_blob_key: string | null; legal_name: string }>("SELECT logo_blob_key,legal_name FROM sponsors WHERE id=$1", [sponsor]);
      assert.deepEqual(result.rows[0], { logo_blob_key: null, legal_name: "Sponsor A" });
    });
  } finally { await db.close(); }
});
