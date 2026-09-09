import { parseSponsorInput, type SponsorInput } from "./sponsor-input.ts";

export const importTargets = [
  "legal_name",
  "contact_name",
  "contact_email",
  "phone",
  "street",
  "postal_code",
  "city",
  "website",
  "source_organization",
  "proposal_package",
  "annual_value_chf",
  "notes",
] as const;

export type ImportTarget = typeof importTargets[number];
export type ImportMapping = Partial<Record<ImportTarget, string>>;
export type ImportRawRow = Record<string, string>;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseImportBatchInput(body: unknown): Result<{
  name: string;
  sourceFilename: string;
  sourceColumns: string[];
  rows: ImportRawRow[];
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const sourceFilename = typeof record.sourceFilename === "string" ? record.sourceFilename.trim() : "";
  if (name.length < 2 || name.length > 160) return { ok: false, error: "invalid_import_name" };
  if (!sourceFilename || sourceFilename.length > 255) return { ok: false, error: "invalid_source_filename" };
  if (!Array.isArray(record.rows) || record.rows.length < 1 || record.rows.length > 1000) return { ok: false, error: "invalid_import_rows" };

  const columns: string[] = [];
  const seenColumns = new Set<string>();
  const rows: ImportRawRow[] = [];

  for (const row of record.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, error: "invalid_import_row" };
    const normalized: ImportRawRow = {};
    const entries = Object.entries(row as Record<string, unknown>);
    if (entries.length < 1 || entries.length > 50) return { ok: false, error: "invalid_import_columns" };
    for (const [rawColumn, rawValue] of entries) {
      const column = rawColumn.trim();
      if (!column || column.length > 80) return { ok: false, error: "invalid_import_column" };
      if (typeof rawValue !== "string" && rawValue !== null && rawValue !== undefined) return { ok: false, error: "invalid_import_value" };
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (value.length > 5000) return { ok: false, error: "invalid_import_value" };
      normalized[column] = value;
      if (!seenColumns.has(column)) {
        seenColumns.add(column);
        columns.push(column);
      }
    }
    rows.push(normalized);
  }

  if (columns.length > 50) return { ok: false, error: "invalid_import_columns" };
  return { ok: true, value: { name, sourceFilename, sourceColumns: columns, rows } };
}

export function parseImportMappingInput(body: unknown, sourceColumns: string[]): Result<ImportMapping> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const rawMapping = (body as Record<string, unknown>).mapping;
  if (!rawMapping || typeof rawMapping !== "object" || Array.isArray(rawMapping)) return { ok: false, error: "invalid_mapping" };

  const sourceSet = new Set(sourceColumns);
  const mapping: ImportMapping = {};
  for (const [target, source] of Object.entries(rawMapping as Record<string, unknown>)) {
    if (!importTargets.includes(target as ImportTarget)) return { ok: false, error: "invalid_mapping_target" };
    if (source === null || source === "") continue;
    if (typeof source !== "string" || !sourceSet.has(source)) return { ok: false, error: "invalid_mapping_source" };
    mapping[target as ImportTarget] = source;
  }
  if (!mapping.legal_name) return { ok: false, error: "legal_name_mapping_required" };
  return { ok: true, value: mapping };
}

export function parseSwissFrancs(value: string): number | null {
  const compact = value.trim().replace(/(?:CHF|Fr\.)/gi, "").replace(/[\s']/g, "");
  if (!compact) return 0;
  if (!/^[0-9.,]+$/.test(compact)) return null;

  let normalized = compact;
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    normalized = compact.replace(thousands, "").replace(decimal, ".");
  } else if (comma >= 0) {
    normalized = compact.replace(",", ".");
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents <= 100_000_000_000 ? cents : null;
}

export function mapImportRow(row: ImportRawRow, mapping: ImportMapping): { mappedData: SponsorInput | Record<string, never>; errors: string[] } {
  const sponsor: Record<string, unknown> = { status: "draft", annual_value_cents: 0 };
  for (const target of importTargets) {
    const source = mapping[target];
    if (!source) continue;
    const value = row[source] ?? "";
    if (target === "annual_value_chf") {
      const cents = parseSwissFrancs(value);
      if (cents === null) return { mappedData: {}, errors: ["invalid_annual_value"] };
      sponsor.annual_value_cents = cents;
    } else if (target === "website") {
      sponsor.website = value && !/^https?:\/\//i.test(value) ? `https://${value}` : value;
    } else {
      sponsor[target] = value;
    }
  }

  const parsed = parseSponsorInput(sponsor, "create");
  if (!parsed.ok) return { mappedData: {}, errors: [parsed.error] };
  return { mappedData: parsed.value as SponsorInput, errors: [] };
}
