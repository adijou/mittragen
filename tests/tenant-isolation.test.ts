import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../netlify/database/migrations/20260908210000_create_multitenant_core/migration.sql", import.meta.url);
const teamMigrationPath = new URL("../netlify/database/migrations/20260908223000_team_invitations/migration.sql", import.meta.url);
const importMigrationPath = new URL("../netlify/database/migrations/20260909054000_sponsor_imports/migration.sql", import.meta.url);
const transitionMigrationPath = new URL("../netlify/database/migrations/20260909070000_transition_campaigns/migration.sql", import.meta.url);
const packageMigrationPath = new URL("../netlify/database/migrations/20260909073000_sponsorship_packages/migration.sql", import.meta.url);
const sponsorPortalMigrationPath = new URL("../netlify/database/migrations/20260909080000_sponsor_portal/migration.sql", import.meta.url);
const contractMigrationPath = new URL("../netlify/database/migrations/20260909090000_contracts/migration.sql", import.meta.url);
const demoSponsorMigrationPath = new URL("../netlify/database/migrations/20260910090000_mark-demo-sponsors/migration.sql", import.meta.url);
const dossierMigrationPath = new URL("../netlify/database/migrations/20260910193000_excel_import_dossier/migration.sql", import.meta.url);
const organizationMigrationPath = new URL("../netlify/database/migrations/20260911120000_organization_profile_branding/migration.sql", import.meta.url);
const signingMigrationPath = new URL("../netlify/database/migrations/20260912100000_contract_signing_requests/migration.sql", import.meta.url);

test("all tenant-owned tables enforce row-level security", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const protectedTables = ["tenants", "tenant_memberships", "sponsors", "tenant_invitations", "audit_events"];

  for (const table of protectedTables) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
});

test("sponsor portal access is identity-bound and invitations are email-bound", async () => {
  const sql = await readFile(sponsorPortalMigrationPath, "utf8");
  for (const table of ["sponsor_portal_invitations", "sponsor_portal_access"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(sql, /lower\(email\) = app_current_user_email\(\)/i);
  assert.match(sql, /identity_user_id = app_current_user_id\(\)/i);
  assert.match(sql, /transition_sponsor_id/i);
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

test("packages, immutable versions, rights and reservations enforce tenant isolation", async () => {
  const sql = await readFile(packageMigrationPath, "utf8");
  const tables = ["sponsorship_packages", "sponsorship_package_versions", "sponsorship_rights", "sponsorship_package_reservations"];
  for (const table of tables) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(sql, /published_package_version_is_immutable/i);
  assert.match(sql, /FOR UPDATE/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /package_capacity_exceeded/i);
  assert.match(sql, /package_exclusivity_conflict/i);
  assert.match(sql, /override_reason IS NULL OR NEW\.override_approved_by IS NULL/i);
});

test("contracts and their evidence are tenant-isolated and immutable after release", async () => {
  const sql = await readFile(contractMigrationPath, "utf8");
  for (const table of ["tenant_contract_settings", "contract_number_counters", "sponsorship_contracts", "sponsorship_contract_events"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(sql, /snapshot_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(sql, /released_contract_is_immutable/i);
  assert.match(sql, /confirmed_contract_is_immutable/i);
  assert.match(sql, /contract_events_are_immutable/i);
  assert.match(sql, /identity_user_id = app_current_user_id\(\)/i);
});

test("only exact onboarding seed rows are marked as example sponsors", async () => {
  const sql = await readFile(demoSponsorMigrationPath, "utf8");
  assert.match(sql, /ADD COLUMN is_demo_data BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(sql, /event\.metadata @> '\{"demo_data": true\}'::jsonb/i);
  assert.match(sql, /sponsor\.legal_name = seed\.legal_name/i);
  assert.match(sql, /sponsor\.annual_value_cents = seed\.annual_value_cents/i);
});

test("dossier profile and imported package assignments remain tenant-bound", async () => {
  const sql = await readFile(dossierMigrationPath, "utf8");
  assert.match(sql, /FOREIGN KEY \(assigned_package_version_id, tenant_id\)/i);
  assert.match(sql, /REFERENCES sponsorship_package_versions\(id, tenant_id\)/i);
  assert.match(sql, /ALTER TABLE tenant_sponsoring_profiles ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE tenant_sponsoring_profiles FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /tenant_id = app_current_tenant_id\(\)/i);
});

test("organization profile consolidates dossier contacts and validates branding metadata", async () => {
  const sql = await readFile(organizationMigrationPath, "utf8");
  assert.match(sql, /contact_name = COALESCE\(tenant_contract_settings\.contact_name, EXCLUDED\.contact_name\)/i);
  assert.match(sql, /contact_email = COALESCE\(tenant_contract_settings\.contact_email, EXCLUDED\.contact_email\)/i);
  assert.match(sql, /logo_content_type IN \('image\/png', 'image\/jpeg'\)/i);
  assert.match(sql, /brand_primary_color ~ '\^#\[0-9A-F\]\{6\}\$'/i);
});

test("contract signing links are hashed, expiring and tenant-isolated", async () => {
  const sql = await readFile(signingMigrationPath, "utf8");
  assert.match(sql, /token_hash TEXT UNIQUE/i);
  assert.match(sql, /token_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL/i);
  assert.match(sql, /ALTER TABLE contract_signing_requests ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE contract_signing_requests FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /app\.contract_signing_token_hash/i);
  assert.match(sql, /expires_at > now\(\)/i);
  assert.match(sql, /status IN \('sent', 'opened', 'confirmed'\)/i);
  assert.match(sql, /lower\(signer_email\) = app_current_user_email\(\)/i);
  assert.match(sql, /UNIQUE \(contract_id\)/i);
});
