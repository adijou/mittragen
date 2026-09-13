import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packagesApiSource = new URL("../netlify/functions/packages.mts", import.meta.url);
const packageUiSource = new URL("../src/PackageManagement.tsx", import.meta.url);
const packageMigrationSource = new URL("../netlify/database/migrations/20260909073000_sponsorship_packages/migration.sql", import.meta.url);

test("package rights can only be removed from a locked draft selected within the tenant", async () => {
  const source = await readFile(packagesApiSource, "utf8");
  const deleteStart = source.indexOf('if (matches.right && request.method === "DELETE"');
  const deleteEnd = source.indexOf('return json({ error: "route_not_found"', deleteStart);
  const deleteFlow = source.slice(deleteStart, deleteEnd);

  assert.notEqual(deleteStart, -1);
  assert.match(deleteFlow, /hasPermission\(role, "packages:write"\)/);
  assert.match(deleteFlow, /right_item\.tenant_id = \$1 AND right_item\.package_version_id = \$2 AND right_item\.id = \$3/);
  assert.match(deleteFlow, /version\.package_id = \$4/);
  assert.match(deleteFlow, /FOR UPDATE OF right_item, version/);
  assert.match(deleteFlow, /right\.status !== "draft"/);
  assert.match(deleteFlow, /DELETE FROM sponsorship_rights/);
  assert.match(deleteFlow, /'package\.right_deleted'/);
});

test("published package rights remain immutable while the editor exposes confirmed draft removal", async () => {
  const ui = await readFile(packageUiSource, "utf8");
  const migration = await readFile(packageMigrationSource, "utf8");

  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON sponsorship_rights/);
  assert.match(migration, /target_status <> 'draft'/);
  assert.match(ui, /method: "DELETE"/);
  assert.match(ui, /Leistung entfernen/);
  assert.match(ui, /Endgültig entfernen/);
  assert.match(ui, /Veröffentlichte Paketversionen und bestehende Verträge bleiben unverändert/);
});
