import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicSource = new URL("../netlify/functions/event-sponsoring-public.mts", import.meta.url);
const internalSource = new URL("../netlify/functions/event-sponsoring.mts", import.meta.url);
const publicUiSource = new URL("../src/EventSponsoringPublic.tsx", import.meta.url);
const flyerPdfSource = new URL("../netlify/functions/_shared/event-flyer-pdf.ts", import.meta.url);
const migrationSource = new URL("../netlify/database/migrations/20260912223000_multiple_event_sponsors_and_package_allocations/migration.sql", import.meta.url);
const classificationMigrationSource = new URL("../netlify/database/migrations/20260913070000_matchball_entitlement_classification/migration.sql", import.meta.url);

test("multiple event sponsors replace the former single-booking constraint", async () => {
  const migration = await readFile(migrationSource, "utf8");
  const publicApi = await readFile(publicSource, "utf8");
  assert.match(migration, /DROP INDEX IF EXISTS event_sponsorship_one_active_booking_idx/);
  assert.doesNotMatch(publicApi, /return json\(\{ error: "event_already_booked"/);
  assert.match(publicApi, /event_package_allocations/);
  assert.match(publicApi, /sponsor_count/);
});

test("seasonal package allocations are quota-protected, tenant-isolated and audited", async () => {
  const migration = await readFile(migrationSource, "utf8");
  const internalApi = await readFile(internalSource, "utf8");
  assert.match(migration, /CREATE TABLE event_package_allocations/);
  assert.match(migration, /event_package_allocation_guard/);
  assert.match(migration, /matchball_entitlement_exhausted/);
  assert.match(migration, /sponsorship_right_id/);
  assert.match(migration, /season_key/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(internalApi, /event_sponsoring\.package_allocation_created/);
  assert.match(internalApi, /fulfillment:write/);
});

test("only explicit matchball rights appear as event entitlements", async () => {
  const migration = await readFile(classificationMigrationSource, "utf8");
  const internalApi = await readFile(internalSource, "utf8");
  const explicitMatchball = /lower\(concat_ws\(' ', right_item\.name, right_item\.description\)\) ~ 'match\[ -\]\?ball'/;

  assert.match(internalApi, explicitMatchball);
  assert.match(migration, explicitMatchball);
  assert.match(internalApi, /'\(\[0-9\]\+\)\[\^0-9\]\{0,30\}\(matchball\|matchspiel\|heimspiel\)'/);
  assert.doesNotMatch(internalApi, /WHERE lower\(concat_ws\(' ', right_item\.name, right_item\.description, right_item\.schedule_text, right_item\.channel\)\)/);
  assert.match(migration, /matchball_entitlement_not_found/);
});

test("the public page explains multiple sponsorships and the PDF is match information", async () => {
  const publicUi = await readFile(publicUiSource, "utf8");
  const pdf = await readFile(flyerPdfSource, "utf8");
  assert.match(publicUi, /Mehrere Sponsoren möglich/);
  assert.match(publicUi, /Pro Spiel können sich mehrere Matchballsponsoren engagieren/);
  assert.match(pdf, /MATCHINFO/);
  assert.match(pdf, /TEAMS & SPIELLEITUNG/);
  assert.match(pdf, /MATCHBALLSPONSOREN/);
  assert.match(pdf, /VEREINSPARTNER/);
  assert.doesNotMatch(pdf, /DIESER MATCHBALL WIRD GESPENDET VON/);
  assert.doesNotMatch(pdf, /Herzlichen Dank/);
});
