import { useMemo, useState } from 'react';
import { SortableHeader, useTableSort } from './SortableHeader';
import { filterOptions, matchesSearch, sortRows } from './tableData';
import { parseSpreadsheetFile } from './importSpreadsheet';
import { previewLegacyImport, type LegacySponsorOption, type LegacyPackageOption } from './legacyImport';

const money = (cents: number) => new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' }).format(cents / 100);
const messages: Record<string, string> = {
  legacy_duplicate_conflict: 'Abweichender oder offener Vertrag vorhanden. Bitte im Vertragscenter prüfen.',
  contract_selection_not_found: 'Sponsor oder Paket nicht verfügbar.',
  contract_settings_incomplete: 'Organisationsangaben unvollständig.',
  package_capacity_exceeded: 'Paketkapazität ausgeschöpft.',
  package_exclusivity_conflict: 'Konflikt mit einem Exklusivrecht.',
  package_reservation_held: 'Offene Reservierung vorhanden.',
  permission_denied: 'Keine Berechtigung für die Übernahme.',
};
export function LegacyContractImport({ tenantId, sponsors, catalog, onChanged, onBusyChange }: { tenantId: string; sponsors: LegacySponsorOption[]; catalog: LegacyPackageOption[]; onChanged: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [source, setSource] = useState<Record<string, string>[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [packageFilter, setPackageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { sort, toggleSort, resetSort } = useTableSort<'line' | 'sponsor' | 'package' | 'amount' | 'date' | 'signer' | 'evidence' | 'status'>('line');
  const rows = useMemo(() => previewLegacyImport(source, sponsors, catalog), [source, sponsors, catalog]);
  const packages = filterOptions(rows.map(row => row.packageName));
  const rowStatus = (row: typeof rows[number]) => row.errors.length ? 'invalid' : results[row.line] ? 'done' : 'valid';
  const visibleRows = sortRows(rows.filter(row => (!packageFilter || row.packageName === packageFilter)
    && (!statusFilter || rowStatus(row) === statusFilter)
    && matchesSearch(search, row.sponsor, row.packageName, row.signer, row.evidence, row.errors.join(' '), results[row.line])), sort, (row, key) => {
    switch (key) {
      case 'line': return row.line;
      case 'sponsor': return row.sponsor;
      case 'package': return row.packageName;
      case 'amount': return row.amount;
      case 'date': return row.date ? Date.parse(row.date) : null;
      case 'signer': return row.signer;
      case 'evidence': return row.evidence;
      case 'status': return row.errors.join(', ') || results[row.line] || 'Bereit zur Prüfung';
    }
  });
  const importRows = async () => {
    if (!acknowledged || rows.some(row => row.errors.length) || busy) return;
    setBusy(true); onBusyChange(true); setError('');
    try {
      for (const row of rows) {
        if (results[row.line] === 'Übernommen' || results[row.line] === 'Bereits vorhanden') continue;
        const response = await fetch(`/api/contracts/${tenantId}/legacy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          sponsorId: row.sponsorId, packageVersionId: row.packageVersionId, annualValueCents: row.amount,
          confirmedOn: row.date || null, confirmedOnUnknown: !row.date,
          signingAuthorityName: row.signer || null, signingAuthorityUnknown: !row.signer,
          evidenceNote: row.evidence, acknowledged: true, skipExisting: true,
        }) });
        const body = await response.json() as { error?: string; skipped?: boolean };
        if (!response.ok) throw new Error(`Zeile ${row.line}: ${messages[body.error ?? ''] ?? 'Übernahme fehlgeschlagen. Bitte Daten prüfen und erneut versuchen.'}`);
        setResults(previous => ({ ...previous, [row.line]: body.skipped ? 'Bereits vorhanden' : 'Übernommen' }));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Übernahme fehlgeschlagen.'); }
    finally {
      try { await onChanged(); } catch { setError(previous => previous || 'Übersicht konnte nicht aktualisiert werden. Bitte neu laden.'); }
      setBusy(false); onBusyChange(false);
    }
  };
  return <details className="contract-legacy" open>
    <summary>Mehrere Altverträge aus einer Liste übernehmen</summary>
    <p>CSV oder Excel mit einer Zuordnung pro Zeile. Spalten: Sponsor, Paket, Jahreswert CHF, Abschlussdatum (JJJJ-MM-TT), Unterzeichnende Person, Nachweis. Namen müssen eindeutig zu bestehenden Sponsoren und Paketen passen. Interne Paketentwürfe sind möglich. Es werden keine E-Mails versendet.</p>
    <label><span>Altvertragsliste auswählen</span><input type="file" accept=".csv,.xlsx" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      setError(''); setResults({}); setSource([]); setAcknowledged(false); setSearch(''); setPackageFilter(''); setStatusFilter(''); resetSort();
      try {
        const sheets = await parseSpreadsheetFile(file);
        const sheet = sheets[0];
        if (!sheet || !['Sponsor', 'Paket', 'Jahreswert CHF', 'Nachweis'].every(name => sheet.columns.includes(name))) throw new Error('Erforderliche Spalten fehlen. Bitte die beschriebenen Spaltennamen verwenden.');
        setSource(sheet.rows);
      } catch (reason) { setError(reason instanceof Error && reason.message.startsWith('Erforderliche') ? reason.message : 'Die Datei konnte nicht gelesen werden. Bitte Format und Spalten prüfen.'); }
    }}/></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    {rows.length > 0 && <>
      <p><strong>{rows.length} Zuordnungen · {money(rows.filter(row => !row.errors.length).reduce((sum, row) => sum + row.amount, 0))} pro Jahr</strong></p>
      <div className="table-filters">
        <label><span>Importzeilen suchen</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Sponsor, Paket oder Nachweis"/></label>
        <label><span>Paket</span><select value={packageFilter} onChange={event => setPackageFilter(event.target.value)}><option value="">Alle Pakete</option>{packages.map(name => <option key={name}>{name}</option>)}</select></label>
        <label><span>Prüfung</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Alle Zeilen</option><option value="invalid">Mit Fehlern</option><option value="valid">Bereit zur Prüfung</option><option value="done">Übernommen / vorhanden</option></select></label>
        <button type="button" className="table-reset" onClick={() => { setSearch(''); setPackageFilter(''); setStatusFilter(''); resetSort(); }}>Zurücksetzen</button>
        <span role="status">{visibleRows.length} von {rows.length} Zeilen</span>
      </div>
      <p className="table-filter-note">Filter und Sortierung ändern nur die Vorschau. Die Übernahme umfasst weiterhin alle geprüften Zeilen der Datei.</p>
      <div className="sponsor-table-wrap"><table className="sponsor-table"><thead><tr>{([['line', 'Zeile'], ['sponsor', 'Sponsor'], ['package', 'Paket'], ['amount', 'CHF/Jahr'], ['date', 'Abschlussdatum'], ['signer', 'Unterzeichnende Person'], ['evidence', 'Nachweis'], ['status', 'Status']] as const).map(([key, label]) => <SortableHeader key={key} label={label} sortKey={key} sort={sort} onSort={toggleSort}/>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={row.line}><td>{row.line}</td><td>{row.sponsor}</td><td>{row.packageName}</td><td>{Number.isFinite(row.amount) ? money(row.amount) : '–'}</td><td>{row.date || 'Unbekannt'}</td><td>{row.signer || 'Unbekannt'}</td><td>{row.evidence}</td><td>{row.errors.join(', ') || results[row.line] || 'Bereit zur Prüfung'}</td></tr>)}{visibleRows.length === 0 && <tr><td colSpan={8}>Keine Zeilen für die gewählten Filter.</td></tr>}</tbody></table></div>
      <label className="contract-release-check"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/><span>Ich bestätige den vorhandenen Altbestand und die geprüften Zuordnungen. Fehlende Abschlussdaten und unterzeichnende Personen werden ausdrücklich als unbekannt dokumentiert. Vorhandene identische Zuordnungen werden übersprungen; abweichende Verträge werden nicht überschrieben.</span></label>
      <button className="access-primary" disabled={busy || !acknowledged || rows.some(row => row.errors.length)} onClick={() => void importRows()}>{busy ? 'Altverträge werden übernommen …' : 'Geprüfte Altverträge übernehmen'}</button>
      {Object.keys(results).length > 0 && <p role="status">{Object.keys(results).length} von {rows.length} Zuordnungen übernommen oder bereits vorhanden.</p>}
    </>}
  </details>;
}
