import assert from "node:assert/strict";
import test from "node:test";
import { mapImportRow, parseImportBatchInput, parseImportMappingInput, parseSwissFrancs } from "../netlify/functions/_shared/import-input.ts";

test("validates import batches and preserves the source column order", () => {
  const parsed = parseImportBatchInput({
    name: "Sponsoren 2026",
    sourceFilename: "sponsoren.csv",
    rows: [
      { Firma: "Bäckerei Sense", EMail: "kontakt@example.ch" },
      { Firma: "Garage Muster", EMail: "garage@example.ch" },
    ],
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value.sourceColumns, ["Firma", "EMail"]);
});

test("requires a valid company-name mapping", () => {
  assert.deepEqual(parseImportMappingInput({ mapping: { contact_email: "Mail" } }, ["Firma", "Mail"]), { ok: false, error: "legal_name_mapping_required" });
  assert.deepEqual(parseImportMappingInput({ mapping: { legal_name: "Unbekannt" } }, ["Firma"]), { ok: false, error: "invalid_mapping_source" });
});

test("accepts reviewed package labels and rejects malformed package ids", () => {
  const versionId = "123e4567-e89b-42d3-a456-426614174000";
  const parsed = parseImportMappingInput({
    mapping: { legal_name: "Firma", proposal_package: "Paket" },
    packageMapping: { Goldsponsor: versionId, Einzelbeitrag: null },
  }, ["Firma", "Paket"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value.packageMapping, { Goldsponsor: versionId, Einzelbeitrag: null });
  assert.deepEqual(parseImportMappingInput({
    mapping: { legal_name: "Firma" }, packageMapping: { Gold: "wrong" },
  }, ["Firma"]), { ok: false, error: "invalid_package_mapping_version" });
});

test("maps a sponsor row, normalizes websites and parses Swiss francs", () => {
  const result = mapImportRow(
    { Firma: "Bäckerei Sense", Mail: "kontakt@example.ch", Web: "sense.example", Betrag: "CHF 1'250.50" },
    { legal_name: "Firma", contact_email: "Mail", website: "Web", annual_value_chf: "Betrag" },
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.mappedData.website, "https://sense.example");
  assert.equal(result.mappedData.annual_value_cents, 125050);
  assert.equal(parseSwissFrancs("1 250,50"), 125050);
});

test("reports row-level validation failures before anything is imported", () => {
  const missingName = mapImportRow({ Firma: "", Mail: "nicht-gueltig" }, { legal_name: "Firma", contact_email: "Mail" });
  assert.deepEqual(missingName.errors, ["invalid_legal_name"]);
  const invalidAmount = mapImportRow({ Firma: "Muster AG", Betrag: "nach Absprache" }, { legal_name: "Firma", annual_value_chf: "Betrag" });
  assert.deepEqual(invalidAmount.errors, ["invalid_annual_value"]);
});
