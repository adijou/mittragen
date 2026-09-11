import assert from "node:assert/strict";
import test from "node:test";
import { deriveBrandColors, normalizedLogoDimensions } from "../src/brandColors.ts";

test("brand colors derive a dominant and a distinct accent color", () => {
  const pixels = [
    ...Array.from({ length: 8 }, () => ({ red: 160, green: 25, blue: 48, alpha: 255 })),
    ...Array.from({ length: 4 }, () => ({ red: 22, green: 88, blue: 190, alpha: 255 })),
    ...Array.from({ length: 20 }, () => ({ red: 255, green: 255, blue: 255, alpha: 255 })),
  ];
  assert.deepEqual(deriveBrandColors(pixels), { primary: "#A01930", accent: "#1658BE" });
});

test("brand colors ignore transparent pixels and use safe defaults for empty artwork", () => {
  assert.deepEqual(deriveBrandColors([{ red: 255, green: 0, blue: 0, alpha: 0 }]), { primary: "#0B2144", accent: "#1967FF" });
});

test("oversized logos are normalized to PDF-safe dimensions", () => {
  assert.deepEqual(normalizedLogoDimensions(4800, 2400), { width: 2400, height: 1200 });
  assert.deepEqual(normalizedLogoDimensions(1200, 600), { width: 1200, height: 600 });
  assert.equal(normalizedLogoDimensions(10, 600), null);
});
