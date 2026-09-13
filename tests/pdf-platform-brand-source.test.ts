import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all generated documents use the shared neutral platform signet", async () => {
  const helper = await readFile(new URL("../netlify/functions/_shared/pdf-platform-brand.ts", import.meta.url), "utf8");
  const sources = await Promise.all([
    "contract-pdf.ts",
    "dossier-pdf.ts",
    "event-flyer-pdf.ts",
  ].map((name) => readFile(new URL(`../netlify/functions/_shared/${name}`, import.meta.url), "utf8")));

  assert.match(helper, /drawSvgPath/);
  assert.match(helper, /Erstellt mit/);
  assert.match(helper, /mittragen\.ch/);
  for (const source of sources) {
    assert.match(source, /drawPlatformCredit/);
    assert.doesNotMatch(source, /erstellt mit mittragen\.ch/i);
  }
});
