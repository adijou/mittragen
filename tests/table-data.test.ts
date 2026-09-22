import assert from "node:assert/strict";
import test from "node:test";
import { filterOptions, matchesSearch, nextSort, sortRows } from "../src/tableData.ts";
import { packageOverview, type SponsorOverviewRow } from "../src/sponsorPackageOverview.ts";

test("money sorts numerically, preserves zero and keeps unknown values last in either direction", () => {
  const rows = [undefined, 100000, 7500, null, 0, 40000, NaN];
  const original = [...rows];
  assert.deepEqual(sortRows(rows, { key: "amount", direction: "asc" }, row => row), [0, 7500, 40000, 100000, undefined, null, NaN]);
  assert.deepEqual(sortRows(rows, { key: "amount", direction: "desc" }, row => row), [100000, 40000, 7500, 0, undefined, null, NaN]);
  assert.deepEqual(rows, original);
});

test("names and contract versions use natural Swiss German ordering with stable ties", () => {
  const names = ["Zürich", "Müller 10", "Äsch", "Müller 2", "Bern", ""];
  assert.deepEqual(sortRows(names, { key: "name", direction: "asc" }, row => row), ["Äsch", "Bern", "Müller 2", "Müller 10", "Zürich", ""]);
  const versions = ["V-2026-10 V1", "V-2026-2 V10", "V-2026-2 V2"];
  assert.deepEqual(sortRows(versions, { key: "number", direction: "asc" }, row => row), ["V-2026-2 V2", "V-2026-2 V10", "V-2026-10 V1"]);
  const ties = [{ id: 1, name: "Müller" }, { id: 2, name: "MÜLLER" }];
  assert.deepEqual(sortRows(ties, { key: "name", direction: "desc" }, row => row.name), ties);
});

test("dates sort across year boundaries and missing historical dates remain unknown", () => {
  const dates = [null, "2026-01-02T12:00:00Z", "2025-12-31T12:00:00Z", "invalid"];
  assert.deepEqual(sortRows(dates, { key: "date", direction: "asc" }, row => row ? Date.parse(row) : null), ["2025-12-31T12:00:00Z", "2026-01-02T12:00:00Z", null, "invalid"]);
  assert.deepEqual(sortRows(dates, { key: "date", direction: "desc" }, row => row ? Date.parse(row) : null), ["2026-01-02T12:00:00Z", "2025-12-31T12:00:00Z", null, "invalid"]);
});

test("a repeated column click reverses order and a new column starts ascending", () => {
  const first = nextSort({ key: null, direction: "asc" }, "name");
  assert.deepEqual(first, { key: "name", direction: "asc" });
  const second = nextSort(first, "name");
  assert.deepEqual(second, { key: "name", direction: "desc" });
  assert.deepEqual(nextSort(second, "amount"), { key: "amount", direction: "asc" });
  assert.deepEqual(sortRows([3, 1, 2], { key: null, direction: "desc" }, row => row), [3, 1, 2]);
});

test("search handles case, Unicode normalization, empty queries and numeric zero", () => {
  assert.equal(matchesSearch("  MÜLLER ", null, "Mu\u0308ller AG"), true);
  assert.equal(matchesSearch("clubinfo", "Beispiel AG", "Clubinfo halbe Seite"), true);
  assert.equal(matchesSearch("0", 0), true);
  assert.equal(matchesSearch(" ", null), true);
  assert.equal(matchesSearch("Werbetafel", null, "Bronze"), false);
  assert.deepEqual(filterOptions(["Paket 10", null, "", " ", "Paket 2", "Paket 10"]), ["Paket 2", "Paket 10"]);
});

test("package amount sorting distinguishes free assignments from missing assignments", () => {
  const base: SponsorOverviewRow = { id: "s", legal_name: "Sponsor", contact_name: null, contact_email: null, phone: null, street: null, postal_code: null, city: null, website: null, status: "active" };
  const assignment = { contract_id: "c", contract_number: "C", package_id: "p", package_name: "Werbetafel", annual_value_cents: 0 };
  const sponsors = [base, { ...base, id: "free", package_assignments: [assignment] }, { ...base, id: "paid", package_assignments: [{ ...assignment, annual_value_cents: 40000 }] }];
  const { rows } = packageOverview(sponsors);
  for (const direction of ["asc", "desc"] as const) {
    const sorted = sortRows(rows, { key: "p", direction }, (row, key) => row.amounts.get(key));
    assert.deepEqual(sorted.map(row => row.sponsor.id), direction === "asc" ? ["free", "paid", "s"] : ["paid", "free", "s"]);
  }
});

test("filtering and sorting a complete import finds matches beyond the first display page without changing import order", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ line: i + 1, name: `Sponsor ${i + 1}`, package: i > 900 ? "Clubinfo" : "Werbetafel", amount: 1000 - i }));
  const visible = sortRows(rows.filter(row => row.package === "Clubinfo" && matchesSearch("Sponsor", row.name)), { key: "amount", direction: "asc" }, row => row.amount).slice(0, 50);
  assert.equal(visible.length, 50);
  assert.equal(visible[0].line, 1000);
  assert.equal(visible[49].line, 951);
  assert.equal(rows[0].line, 1);
  assert.equal(rows.length, 1000);
});
