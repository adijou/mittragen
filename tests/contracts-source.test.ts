import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("direct contracts preserve the negotiated value and reserve capacity only on release", async () => {
  const source = await readFile(new URL("../netlify/functions/contracts.mts", import.meta.url), "utf8");
  const collectionStart = source.indexOf("if (routes.collection.test(pathname))");
  const releaseStart = source.indexOf("if (routes.release.test(pathname)");
  const createFlow = source.slice(collectionStart, releaseStart);
  const releaseFlow = source.slice(releaseStart);

  assert.match(source, /\$4::integer AS contract_value_cents/);
  assert.match(source, /priceCents: source\.contract_value_cents/);
  assert.match(createFlow, /parsed\.value\.mode === "transition" \? parsed\.value\.transitionSponsorId : null/);
  assert.doesNotMatch(createFlow, /ensureDirectReservation/);
  assert.match(releaseFlow, /source\.mode === "direct" && !await ensureDirectReservation/);
  assert.match(source, /package_capacity_exceeded/);
  assert.match(source, /package_exclusivity_conflict/);
});

test("sponsor editing no longer exposes package assignment fields", async () => {
  const source = await readFile(new URL("../src/SponsorDirectory.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, />Zugeordnetes Paket</);
  assert.doesNotMatch(source, />Jahreswert in CHF</);
  assert.match(source, /Paket und Jahreswert werden im Vertragscenter ausgewählt/);
});
