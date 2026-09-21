import assert from 'node:assert/strict';
import test from 'node:test';
import { previewLegacyImport } from '../src/legacyImport.ts';
import { packageOverview, sponsorPackageCsv, type SponsorOverviewRow } from '../src/sponsorPackageOverview.ts';
import { parseContractAdminConfirmation } from '../netlify/functions/_shared/contract-input.ts';

const source = { Sponsor: 'Muster AG', Paket: 'Werbetafel', 'Jahreswert CHF': '0', Nachweis: 'Sponsorenliste, Zeile 2' };
const sponsors = [{ id: 's', legal_name: 'Muster AG' }];
const packages = [{ id: 'p', name: 'Werbetafel' }];
test('legacy import preserves free packages and explicitly missing historical evidence', () => {
  const [row] = previewLegacyImport([source], sponsors, packages);
  assert.deepEqual(row.errors, []); assert.equal(row.amount, 0); assert.equal(row.date, ''); assert.equal(row.signer, '');
  const parsed = parseContractAdminConfirmation({ confirmedOn: null, confirmedOnUnknown: true, signingAuthorityName: null, signingAuthorityUnknown: true, evidenceNote: row.evidence, acknowledged: true });
  assert.equal(parsed.ok, true);
  if (parsed.ok) { assert.equal(parsed.value.confirmedOn, null); assert.equal(parsed.value.signingAuthorityName, null); }
  for (const input of [{}, { confirmedOnUnknown: true }, { signingAuthorityUnknown: true }, { confirmedOnUnknown: true, signingAuthorityUnknown: true, confirmedOn: '2024-01-01' }, { confirmedOnUnknown: true, signingAuthorityUnknown: true, signingAuthorityName: 'Cannot invent' }]) {
    assert.equal(parseContractAdminConfirmation({ ...input, evidenceNote: 'List', acknowledged: true }).ok, false);
  }
});
test('import refuses missing or ambiguous matches, duplicate rows and invalid amounts and dates', () => {
  assert.equal(previewLegacyImport([source], [], packages)[0].errors.length, 1);
  assert.equal(previewLegacyImport([source], [...sponsors, { id: 'other', legal_name: 'Muster AG' }], packages)[0].errors.length, 1);
  assert.equal(previewLegacyImport([source, source], sponsors, packages)[1].errors.length, 1);
  for (const value of ['', '-1', '1.234', 'NaN', '=400']) assert.ok(previewLegacyImport([{ ...source, 'Jahreswert CHF': value }], sponsors, packages)[0].errors.length);
  assert.ok(previewLegacyImport([{ ...source, Abschlussdatum: '2024-02-30' }], sponsors, packages)[0].errors.length);
});
test('package overview includes all sponsors, combines package versions and distinguishes zero from missing', () => {
  const base: SponsorOverviewRow = { id: 's', legal_name: 'Sponsor', contact_name: null, contact_email: null, phone: null, street: null, postal_code: null, city: null, website: null, status: 'active' };
  const assignment = { contract_id: 'c1', contract_number: 'C1', package_id: 'p', package_name: 'Werbetafel', annual_value_cents: 0 };
  const list = [{ ...base, package_assignments: [assignment, assignment, { ...assignment, contract_id: 'c2', package_id: 'club', package_name: 'Clubinfo', annual_value_cents: 30000 }] }, { ...base, id: 'other', legal_name: '=HYPERLINK("unsafe")' }];
  const overview = packageOverview(list);
  assert.equal(overview.rows.length, 2); assert.equal(overview.columns.length, 2);
  assert.equal(overview.rows[0].amounts.get('p'), 0); assert.equal(overview.rows[1].amounts.has('p'), false);
  assert.equal(overview.rows[0].totalCents, 30000);
  const csv = sponsorPackageCsv(list);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes(';0.00;300.00')); assert.ok(csv.includes('"\'=HYPERLINK'));
});
