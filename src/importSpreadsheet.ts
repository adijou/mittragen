import { strFromU8, unzipSync } from "fflate";
import { parseCsv, type ParsedCsv } from "./importCsv.ts";

export type ParsedSheet = ParsedCsv & { name: string };

const xmlEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

function decodeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
      const numeric = Number.parseInt(entity.slice(radix === 16 ? 2 : 1), radix);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : match;
    }
    return xmlEntities[entity.toLowerCase()] ?? match;
  });
}

function attribute(tag: string, name: string) {
  const escaped = name.replace(":", "\\:");
  const match = tag.match(new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeXml(match?.[1] ?? match?.[2] ?? "");
}

function textNodes(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join("");
}

function columnNumber(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function workbookPath(target: string) {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const normalized = target.replace(/^\.\//, "").replace(/^\.\.\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function normalizeMatrix(matrix: string[][]): ParsedCsv {
  const firstDataRow = matrix.findIndex((row) => row.some((value) => value.trim()));
  if (firstDataRow < 0) throw new Error("spreadsheet_no_data");
  const sourceRows = matrix.slice(firstDataRow);
  const maximumColumns = Math.max(...sourceRows.map((row) => row.length));
  const usedIndexes = Array.from({ length: maximumColumns }, (_, index) => index).filter((index) =>
    sourceRows.some((row) => (row[index] ?? "").trim()),
  );
  if (usedIndexes.length > 50) throw new Error("spreadsheet_too_many_columns");

  const seen = new Map<string, number>();
  const columns = usedIndexes.map((index) => {
    const base = sourceRows[0][index]?.trim() || `Spalte ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
  const rows = sourceRows.slice(1)
    .filter((row) => usedIndexes.some((index) => (row[index] ?? "").trim()))
    .map((row) => Object.fromEntries(columns.map((column, offset) => [column, (row[usedIndexes[offset]] ?? "").trim()])));
  if (!rows.length) throw new Error("spreadsheet_no_data");
  if (rows.length > 1000) throw new Error("spreadsheet_too_many_rows");
  return { columns, rows };
}

export function parseXlsx(bytes: Uint8Array): ParsedSheet[] {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new Error("xlsx_invalid");
  }
  const readXml = (path: string) => {
    const file = archive[path];
    if (!file) throw new Error("xlsx_invalid");
    return strFromU8(file);
  };

  const workbook = readXml("xl/workbook.xml");
  const relationships = readXml("xl/_rels/workbook.xml.rels");
  const relationTargets = new Map(
    [...relationships.matchAll(/<Relationship\b([^>]*?)(?:\/>|>[\s\S]*?<\/Relationship>)/gi)]
      .map((match) => [attribute(match[1], "Id"), workbookPath(attribute(match[1], "Target"))]),
  );
  const sharedStringsXml = archive["xl/sharedStrings.xml"] ? strFromU8(archive["xl/sharedStrings.xml"]) : "";
  const sharedStrings = [...sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map((match) => textNodes(match[1]));
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*?)(?:\/>|>[\s\S]*?<\/sheet>)/gi)].map((match) => ({
    name: attribute(match[1], "name"),
    path: relationTargets.get(attribute(match[1], "r:id")),
  }));

  const parsed: ParsedSheet[] = [];
  for (const sheet of sheets) {
    if (!sheet.name || !sheet.path || !archive[sheet.path]) continue;
    const xml = strFromU8(archive[sheet.path]);
    const matrix: string[][] = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const row: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
        const properties = cellMatch[1];
        const content = cellMatch[2] ?? "";
        const index = columnNumber(attribute(properties, "r"));
        if (index < 0) continue;
        const type = attribute(properties, "t");
        const raw = content.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? "";
        if (type === "s") row[index] = sharedStrings[Number(raw)] ?? "";
        else if (type === "inlineStr") row[index] = textNodes(content);
        else if (type === "b") row[index] = raw === "1" ? "Ja" : "Nein";
        else row[index] = decodeXml(raw);
      }
      matrix.push(row);
    }
    try {
      parsed.push({ name: sheet.name, ...normalizeMatrix(matrix) });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "spreadsheet_no_data") throw error;
    }
  }
  if (!parsed.length) throw new Error("spreadsheet_no_data");
  return parsed;
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet[]> {
  if (/\.csv$/i.test(file.name)) return [{ name: "CSV", ...parseCsv(await file.text()) }];
  if (!/\.xlsx$/i.test(file.name)) throw new Error("spreadsheet_file_type");
  return parseXlsx(new Uint8Array(await file.arrayBuffer()));
}
