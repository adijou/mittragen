export type LegacySponsorOption = { id: string; legal_name: string };
export type LegacyPackageOption = { id: string; name: string };
export type LegacyImportRow = { line: number; sponsor: string; packageName: string; amount: number; date: string; signer: string; evidence: string; sponsorId: string; packageVersionId: string; errors: string[] };
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('de-CH').replace(/\s+/g, ' ').trim();
export function previewLegacyImport(rows: Record<string, string>[], sponsors: LegacySponsorOption[], catalog: LegacyPackageOption[]): LegacyImportRow[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const sponsor = row.Sponsor?.trim() ?? '';
    const packageName = row.Paket?.trim() ?? '';
    const matches = sponsors.filter(item => normalize(item.legal_name) === normalize(sponsor));
    const packages = catalog.filter(item => normalize(item.name) === normalize(packageName));
    const rawAmount = (row['Jahreswert CHF'] ?? '').replace(/[’'\s]/g, '').replace(',', '.');
    const amount = Math.round(Number(rawAmount) * 100);
    const date = row.Abschlussdatum?.trim() ?? '';
    const signer = row['Unterzeichnende Person']?.trim() ?? '';
    const evidence = row.Nachweis?.trim() ?? '';
    const errors: string[] = [];
    if (matches.length !== 1) errors.push(matches.length ? 'Sponsorname mehrdeutig' : 'Sponsor nicht gefunden');
    if (packages.length !== 1) errors.push(packages.length ? 'Paketname mehrdeutig' : 'Paket nicht gefunden');
    if (!/^\d+(?:\.\d{1,2})?$/.test(rawAmount) || !Number.isSafeInteger(amount) || amount > 1_000_000_000) errors.push('Ungültiger Jahreswert');
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > new Date().toISOString().slice(0, 10))) errors.push('Ungültiges Abschlussdatum');
    if (!evidence || evidence.length > 600) errors.push('Nachweis fehlt oder ist zu lang');
    if (signer.length > 160) errors.push('Name zu lang');
    const key = `${matches[0]?.id}:${packages[0]?.id}`;
    if (matches.length === 1 && packages.length === 1) {
      if (seen.has(key)) errors.push('Doppelte Zuordnung in der Datei');
      seen.add(key);
    }
    return { line: index + 2, sponsor, packageName, amount, date, signer, evidence, sponsorId: matches[0]?.id ?? '', packageVersionId: packages[0]?.id ?? '', errors };
  });
}
