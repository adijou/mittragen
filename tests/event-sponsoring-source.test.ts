import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicSource = new URL("../netlify/functions/event-sponsoring-public.mts", import.meta.url);
const internalSource = new URL("../netlify/functions/event-sponsoring.mts", import.meta.url);
const publicUiSource = new URL("../src/EventSponsoringPublic.tsx", import.meta.url);
const migrationSource = new URL("../netlify/database/migrations/20260912143000_event_sponsoring/migration.sql", import.meta.url);

test("public matchball booking is account-free and prices are computed from the selected event", async () => {
  const source = await readFile(publicSource, "utf8");
  assert.doesNotMatch(source, /requireUser/);
  assert.match(source, /parseEventBooking/);
  assert.match(source, /event\.rows\[0\]\.price_cents \+ \(value\.includeFnMention/);
  assert.match(source, /status = 'published'/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /event_already_booked/);
  assert.doesNotMatch(source, /sendContract|sendIdentity|sendExisting|Resend/);
});

test("event flyers load the central organization brand", async () => {
  const source = await readFile(internalSource, "utf8");
  assert.match(source, /loadOrganizationPdfBrand/);
  assert.match(source, /createEventFlyerPdf/);
  assert.match(source, /event_sponsoring\.booking_cancelled/);
});

test("public form explicitly explains direct reservation without login or email confirmation", async () => {
  const source = await readFile(publicUiSource, "utf8");
  assert.match(source, /Kein Konto und keine E-Mail-Bestätigung erforderlich/);
  assert.match(source, /unmittelbar reserviert/);
  assert.match(source, /termsAccepted/);
});

test("FC Sense Saane is prefilled idempotently with the published 2026/27 home schedule", async () => {
  const source = await readFile(migrationSource, "utf8");
  assert.match(source, /tenant\.slug = 'fc-sense-saane'/);
  assert.match(source, /'aff-ffv-matchcenter'/);
  assert.match(source, /sponsorship_events_external_source_idx/);
  assert.match(source, /ON CONFLICT DO NOTHING/);
  assert.match(source, /'134058'/);
  assert.match(source, /'134161'/);
  assert.match(source, /'2027-04-04 12:00 Europe\/Zurich'::timestamptz, true, '134121'/);
  assert.equal((source.match(/'FC Bösingen I', 'FC /g) ?? []).length, 9);
  assert.match(source, /'FC Bösingen I', 'SC Düdingen IIIa'/);
});
