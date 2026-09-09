import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../src/importCsv.ts";

test("parses Swiss semicolon CSV files with quoted fields and a BOM", () => {
  const parsed = parseCsv("\uFEFFFirma;Kontakt;Bemerkung\r\nBäckerei Sense;Mia Muster;\"Zeile 1; Zeile 2\"\r\n");
  assert.deepEqual(parsed.columns, ["Firma", "Kontakt", "Bemerkung"]);
  assert.deepEqual(parsed.rows, [{ Firma: "Bäckerei Sense", Kontakt: "Mia Muster", Bemerkung: "Zeile 1; Zeile 2" }]);
});

test("parses comma CSV and escaped quotes", () => {
  const parsed = parseCsv('Company,Notes\n"Muster, AG","Sagt ""ja"""');
  assert.equal(parsed.rows[0].Company, "Muster, AG");
  assert.equal(parsed.rows[0].Notes, 'Sagt "ja"');
});

test("rejects duplicate headings and files without data rows", () => {
  assert.throws(() => parseCsv("Firma;Firma\nA;B"), /csv_duplicate_column/);
  assert.throws(() => parseCsv("Firma;Ort\n;"), /csv_no_data/);
});
