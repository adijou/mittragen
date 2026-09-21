export type SponsorPackageAssignment = {
  contract_id: string;
  contract_number: string;
  package_id: string;
  package_name: string;
  annual_value_cents: number;
};

export type SponsorOverviewRow = {
  id: string; legal_name: string; contact_name: string | null; contact_email: string | null;
  phone: string | null; street: string | null; postal_code: string | null; city: string | null;
  website: string | null; status: string; package_assignments?: SponsorPackageAssignment[];
};

export function packageOverview(sponsors: SponsorOverviewRow[]) {
  const packages = new Map<string, string>();
  for (const sponsor of sponsors) for (const assignment of sponsor.package_assignments ?? []) {
    if (!packages.has(assignment.package_id)) packages.set(assignment.package_id, assignment.package_name);
  }
  const columns = [...packages].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "de-CH") || a.id.localeCompare(b.id));
  for (const column of columns) {
    if ([...packages.values()].filter(name => name === packages.get(column.id)).length > 1) column.name += ` (${column.id.slice(0, 8)})`;
  }
  const rows = sponsors.map(sponsor => {
    const amounts = new Map<string, number>();
    const seen = new Set<string>();
    for (const assignment of sponsor.package_assignments ?? []) {
      if (seen.has(assignment.contract_id)) continue;
      seen.add(assignment.contract_id);
      amounts.set(assignment.package_id, (amounts.get(assignment.package_id) ?? 0) + assignment.annual_value_cents);
    }
    return { sponsor, amounts, totalCents: [...amounts.values()].reduce((total, value) => total + value, 0) };
  });
  return { columns, rows };
}

function csvCell(value: string) {
  // Quoting alone does not prevent spreadsheet formula injection.
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function sponsorPackageCsv(sponsors: SponsorOverviewRow[]) {
  const { columns, rows } = packageOverview(sponsors);
  const headers = ["Sponsor", "Kontaktperson", "E-Mail", "Telefon", "Strasse", "PLZ", "Ort", "Website", "Status",
    ...columns.map(column => `${column.name} (CHF/Jahr)`), "Total bestätigte Pakete (CHF/Jahr)"];
  const lines = [headers.map(csvCell).join(";")];
  for (const { sponsor, amounts, totalCents } of rows) {
    const fields = [sponsor.legal_name, sponsor.contact_name, sponsor.contact_email, sponsor.phone, sponsor.street,
      sponsor.postal_code, sponsor.city, sponsor.website, sponsor.status];
    lines.push([...fields.map(value => csvCell(value ?? "")),
      ...columns.map(column => amounts.has(column.id) ? (amounts.get(column.id)! / 100).toFixed(2) : ""),
      (totalCents / 100).toFixed(2)].join(";"));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
