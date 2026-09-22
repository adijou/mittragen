export type SortValue = string | number | boolean | null | undefined;
export type TableSort<Key extends string = string> = { key: Key | null; direction: "asc" | "desc" };

const collator = new Intl.Collator("de-CH", { numeric: true, sensitivity: "base" });
const missing = (value: SortValue) => value == null || value === "" || (typeof value === "number" && !Number.isFinite(value));

export function nextSort<Key extends string>(current: TableSort<Key>, key: Key): TableSort<Key> {
  return { key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" };
}

/** Sort underlying values, keep missing values last in both directions and preserve ties. */
export function sortRows<Row, Key extends string>(rows: readonly Row[], sort: TableSort<Key>, value: (row: Row, key: Key) => SortValue): Row[] {
  const key = sort.key;
  if (key === null) return [...rows];
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const left = value(a.row, key), right = value(b.row, key);
    if (missing(left) || missing(right)) return Number(missing(left)) - Number(missing(right)) || a.index - b.index;
    const compared = typeof left === "number" && typeof right === "number" ? left - right
      : typeof left === "boolean" && typeof right === "boolean" ? Number(left) - Number(right)
      : collator.compare(String(left), String(right));
    return (sort.direction === "asc" ? compared : -compared) || a.index - b.index;
  }).map(({ row }) => row);
}

export function matchesSearch(query: string, ...values: SortValue[]): boolean {
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("de-CH");
  return !normalized || values.some(value => value != null && String(value).normalize("NFKC").toLocaleLowerCase("de-CH").includes(normalized));
}

export function filterOptions(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort(collator.compare);
}
