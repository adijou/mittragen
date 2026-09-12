import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  component: new URL("../src/ProductBrand.tsx", import.meta.url),
  styles: new URL("../src/styles.css", import.meta.url),
  icon: new URL("../public/brand/mittragen-icon.svg", import.meta.url),
  horizontal: new URL("../public/brand/mittragen-logo-horizontal.svg", import.meta.url),
  index: new URL("../index.html", import.meta.url),
  migration: new URL("../netlify/database/migrations/20260913014500_brand_world_defaults/migration.sql", import.meta.url),
  main: new URL("../src/main.tsx", import.meta.url),
  productiveAccess: new URL("../src/ProductiveAccess.tsx", import.meta.url),
};

test("product brand uses the carrying m and exact mittragen.ch wordmark", async () => {
  const [component, icon, horizontal] = await Promise.all([
    readFile(files.component, "utf8"),
    readFile(files.icon, "utf8"),
    readFile(files.horizontal, "utf8"),
  ]);
  for (const source of [icon, horizontal]) {
    assert.match(source, /#?1F6BFF|var\(--blue\)/i);
    assert.match(source, /#?F2B632|var\(--gold\)/i);
  }
  assert.match(component, /brand__arch/);
  assert.match(component, /brand__person/);
  assert.match(component, />\.ch</);
  assert.doesNotMatch(icon, /linearGradient|filter|shadow/i);
  assert.match(horizontal, /mittragen<tspan[^>]*>\.ch<\/tspan>/);
});

test("website and new organization defaults use the approved brand palette", async () => {
  const [styles, index, migration] = await Promise.all([
    readFile(files.styles, "utf8"),
    readFile(files.index, "utf8"),
    readFile(files.migration, "utf8"),
  ]);
  assert.match(styles, /--navy:\s*#0b2142/i);
  assert.match(styles, /--blue:\s*#1f6bff/i);
  assert.match(styles, /--gold:\s*#f2b632/i);
  assert.match(styles, /--surface-2:\s*#f4f7fb/i);
  assert.match(styles, /font-family:\s*"Inter"/);
  assert.match(index, /mittragen\.ch – Unterstützung\. Einfach weiter\./);
  assert.match(migration, /brand_primary_color SET DEFAULT '#0B2142'/);
  assert.match(migration, /brand_accent_color SET DEFAULT '#1F6BFF'/);
});

test("legacy prototypes are closed and absent from the productive workspace menu", async () => {
  const [main, productiveAccess] = await Promise.all([
    readFile(files.main, "utf8"),
    readFile(files.productiveAccess, "utf8"),
  ]);
  assert.match(main, /\["\/admin", "\/space", "\/ueberfuehren"\]/);
  assert.match(main, /window\.history\.replaceState\(\{\}, "", "\/login"\)/);
  assert.doesNotMatch(productiveAccess, />Überführungs-Prototyp</);
  assert.match(productiveAccess, /const goToWebsite = \(\) => window\.location\.assign\("\/"\)/);
  assert.match(productiveAccess, /<AuthPage \{\.\.\.session\} onHome=\{goToWebsite\}/);
  assert.match(productiveAccess, /<WorkspacePage[^>]+onHome=\{goToWebsite\}/);
});
