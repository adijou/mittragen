import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packagesApiSource = new URL("../netlify/functions/packages.mts", import.meta.url);
const packageUiSource = new URL("../src/PackageManagement.tsx", import.meta.url);

test("package duplication creates an independent private version-one draft with copied rights", async () => {
  const source = await readFile(packagesApiSource, "utf8");
  const duplicateStart = source.indexOf('if (matches.duplicate && request.method === "POST"');
  const duplicateEnd = source.indexOf('if (matches.versions && request.method === "POST"', duplicateStart);
  const duplicateFlow = source.slice(duplicateStart, duplicateEnd);

  assert.notEqual(duplicateStart, -1);
  assert.match(duplicateFlow, /hasPermission\(role, "packages:write"\)/);
  assert.match(duplicateFlow, /source\.tenant_id = \$1 AND source\.package_id = \$2 AND source\.id = \$3/);
  assert.match(duplicateFlow, /INSERT INTO sponsorship_packages/);
  assert.match(duplicateFlow, /SELECT \$1, \$4, 1, left\(source\.name, 152\) \|\| ' – Kopie'/);
  assert.match(duplicateFlow, /source\.valid_from, source\.valid_until, 'private'/);
  assert.match(duplicateFlow, /INSERT INTO sponsorship_rights/);
  assert.match(duplicateFlow, /'package\.duplicated'/);
  assert.doesNotMatch(duplicateFlow, /sponsorship_package_online_settings/);
});

test("package and version copying are separate, clearly labelled actions", async () => {
  const api = await readFile(packagesApiSource, "utf8");
  const ui = await readFile(packageUiSource, "utf8");
  const versionStart = api.indexOf('if (matches.versions && request.method === "POST"');
  const versionEnd = api.indexOf('if (matches.version && request.method === "PATCH"', versionStart);
  const versionFlow = api.slice(versionStart, versionEnd);

  assert.match(ui, /Paket duplizieren/);
  assert.match(ui, /Neue Version erstellen/);
  assert.doesNotMatch(ui, /Als neue Version kopieren/);
  assert.match(ui, /\/api\/packages\/\$\{tenantId\}\/\$\{detail\.package\.id\}\/duplicate/);
  assert.match(versionFlow, /SELECT \$1, \$2,/);
  assert.match(versionFlow, /COALESCE\(max\(version_number\), 0\) \+ 1/);
});
