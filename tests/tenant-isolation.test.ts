import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../netlify/database/migrations/20260908210000_create_multitenant_core/migration.sql", import.meta.url);
const teamMigrationPath = new URL("../netlify/database/migrations/20260908223000_team_invitations/migration.sql", import.meta.url);
const importMigrationPath = new URL("../netlify/database/migrations/20260909054000_sponsor_imports/migration.sql", import.meta.url);
const transitionMigrationPath = new URL("../netlify/database/migrations/20260909070000_transition_campaigns/migration.sql", import.meta.url);

test("all tenant-owned tables enforce row-level security", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const protectedTables = ["tenants", "tenant_memberships", "sponsors", "tenant_invitations", "audit_events"];

  for (const table of protectedTables) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
});

test("pending invitations can only be claimed by the authenticated email", async () => {
  const sql = await readFile(teamMigrationPath, "utf8");
  assert.match(sql, /lower\(email\) = app_current_user_email\(\)/i);
  assert.match(sql, /accepted_at IS NULL/i);
  assert.match(sql, /expires_at > now\(\)/i);
  assert.match(sql, /WITH CHECK \(tenant_id = app_current_tenant_id\(\)\)/i);
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

test("import batches and source rows enforce tenant isolation", async () => {
  const sql = await readFile(importMigrationPath, "utf8");
  for (const table of ["sponsor_import_batches", "sponsor_import_rows"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
  for (const policy of ["sponsor_import_batches_isolated", "sponsor_import_rows_isolated"]) {
    const start = sql.indexOf(`CREATE POLICY ${policy}`);
    assert.notEqual(start, -1);
    const block = sql.slice(start, sql.indexOf(";", start) + 1);
    assert.match(block, /tenant_id = app_current_tenant_id\(\)/);
    assert.match(block, /WITH CHECK/);
  }
});

test("transition campaigns, mappings and sponsor proposals enforce tenant isolation", async () => {
  const sql = await readFile(transitionMigrationPath, "utf8");
  for (const table of ["transition_campaigns", "transition_mappings", "transition_sponsors"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
  for (const policy of ["transition_campaigns_isolated", "transition_mappings_isolated", "transition_sponsors_isolated"]) {
    const start = sql.indexOf(`CREATE POLICY ${policy}`);
    assert.notEqual(start, -1);
    const block = sql.slice(start, sql.indexOf(";", start) + 1);
    assert.match(block, /tenant_id = app_current_tenant_id\(\)/);
    assert.match(block, /WITH CHECK/);
  }
});
