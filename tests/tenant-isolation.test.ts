import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../netlify/database/migrations/20260908210000_create_multitenant_core/migration.sql", import.meta.url);

test("all tenant-owned tables enforce row-level security", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const protectedTables = ["tenants", "tenant_memberships", "sponsors", "tenant_invitations", "audit_events"];

  for (const table of protectedTables) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
});

test("tenant-owned records are checked against the request tenant", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const policy of ["sponsors_isolated", "invitations_isolated", "audit_events_isolated"]) {
    const start = sql.indexOf(`CREATE POLICY ${policy}`);
    assert.notEqual(start, -1);
    const block = sql.slice(start, sql.indexOf(";", start) + 1);
    assert.match(block, /tenant_id = app_current_tenant_id\(\)/);
    assert.match(block, /WITH CHECK/);
  }
});

