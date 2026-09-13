import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packagesApiSource = new URL("../netlify/functions/packages.mts", import.meta.url);
const packageUiSource = new URL("../src/PackageManagement.tsx", import.meta.url);
const packageMigrationSource = new URL("../netlify/database/migrations/20260909073000_sponsorship_packages/migration.sql", import.meta.url);

test("only unused package drafts can be discarded and the action is audited", async () => {
  const source = await readFile(packagesApiSource, "utf8");
  const deleteStart = source.indexOf('if (matches.version && request.method === "DELETE"');
  const deleteEnd = source.indexOf('if (matches.version && request.method === "PATCH"', deleteStart);
  const deleteFlow = source.slice(deleteStart, deleteEnd);

  assert.notEqual(deleteStart, -1);
  assert.match(deleteFlow, /hasPermission\(role, "packages:write"\)/);
  assert.match(deleteFlow, /FOR UPDATE OF version, package/);
  assert.match(deleteFlow, /version\.status !== "draft"/);
  for (const reference of [
    "sponsors", "sponsorship_contracts", "sponsorship_package_reservations",
    "transition_mappings", "transition_sponsors", "event_package_allocations",
    "sponsorship_checkout_submissions",
  ]) assert.match(deleteFlow, new RegExp(`EXISTS \\(SELECT 1 FROM ${reference}`));
  assert.match(deleteFlow, /'package\.version_deleted'/);
  assert.match(deleteFlow, /DELETE FROM sponsorship_package_versions/);
  assert.match(deleteFlow, /packageDeleted/);
  assert.match(deleteFlow, /DELETE FROM sponsorship_packages/);
});

test("the package editor confirms draft discard and recovers to an existing package", async () => {
  const ui = await readFile(packageUiSource, "utf8");

  assert.match(ui, /selectedVersion\.status === "draft".*Entwurf verwerfen/);
  assert.match(ui, /Versionsentwurf wirklich verwerfen\?/);
  assert.match(ui, /Endgültig verwerfen/);
  assert.match(ui, /method: "DELETE"/);
  assert.match(ui, /package_version_in_use/);
  assert.match(ui, /packageIds\.has\(selectedPackageId\)/);
});

test("the database still rejects deletion of every published package version", async () => {
  const migration = await readFile(packageMigrationSource, "utf8");

  assert.match(migration, /BEFORE UPDATE OR DELETE ON sponsorship_package_versions/);
  assert.match(migration, /OLD\.status <> 'draft'/);
  assert.match(migration, /published_package_version_is_immutable/);
});
