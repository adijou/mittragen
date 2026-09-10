import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseXlsx } from "../src/importSpreadsheet.ts";

function workbookFixture() {
  return zipSync({
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sponsoren" sheetId="1" r:id="rId1"/><sheet name="Leer" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0"?><sst><si><t>Firma</t></si><si><t>Kontakt</t></si><si><t>Paket</t></si><si><t>Beispiel AG</t></si><si><t>René Muster</t></si><si><t>Goldsponsor</t></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="D2" t="s"><v>5</v></c></row></sheetData></worksheet>`),
    "xl/worksheets/sheet2.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData/></worksheet>`),
  });
}

test("xlsx parser reads named sheets, shared strings and sparse columns", () => {
  const sheets = parseXlsx(workbookFixture());
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, "Sponsoren");
  assert.deepEqual(sheets[0].columns, ["Firma", "Kontakt", "Paket"]);
  assert.deepEqual(sheets[0].rows, [{ Firma: "Beispiel AG", Kontakt: "René Muster", Paket: "Goldsponsor" }]);
});

test("xlsx parser rejects invalid archives", () => {
  assert.throws(() => parseXlsx(strToU8("not a workbook")), /xlsx_invalid/);
});
