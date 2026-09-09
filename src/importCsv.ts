export type ParsedCsv = { columns: string[]; rows: Array<Record<string, string>> };

function detectDelimiter(text: string) {
  let comma = 0;
  let semicolon = 0;
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    if (!quoted && (character === '\n' || character === '\r')) break;
    if (!quoted && character === ',') comma += 1;
    if (!quoted && character === ';') semicolon += 1;
  }
  return semicolon >= comma ? ';' : ',';
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      matrix.push(row);
      row = [];
      field = '';
      continue;
    }
    field += character;
  }
  if (quoted) throw new Error('csv_unclosed_quote');
  if (field || row.length) {
    row.push(field);
    matrix.push(row);
  }

  const nonEmpty = matrix.filter((candidate) => candidate.some((value) => value.trim()));
  if (nonEmpty.length < 2) throw new Error('csv_no_data');
  const columns = nonEmpty[0].map((value) => value.trim());
  if (columns.some((column) => !column)) throw new Error('csv_empty_column');
  if (new Set(columns).size !== columns.length) throw new Error('csv_duplicate_column');
  if (columns.length > 50) throw new Error('csv_too_many_columns');

  const rows = nonEmpty.slice(1).map((values) => Object.fromEntries(columns.map((column, index) => [column, (values[index] ?? '').trim()])));
  if (rows.length > 1000) throw new Error('csv_too_many_rows');
  return { columns, rows };
}
