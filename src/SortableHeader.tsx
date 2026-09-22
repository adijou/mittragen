import { useState } from "react";
import { nextSort, type TableSort } from "./tableData";

export function useTableSort<Key extends string>(initialKey: Key | null = null) {
  const [sort, setSort] = useState<TableSort<Key>>({ key: initialKey, direction: "asc" });
  return { sort, toggleSort: (key: Key) => setSort(current => nextSort(current, key)), resetSort: () => setSort({ key: initialKey, direction: "asc" }) };
}

export function SortableHeader<Key extends string>({ label, sortKey, sort, onSort, className }: {
  label: string; sortKey: Key; sort: TableSort<Key>; onSort: (key: Key) => void; className?: string;
}) {
  const active = sort.key === sortKey;
  const ascending = active && sort.direction === "asc";
  return <th scope="col" className={className} aria-sort={active ? ascending ? "ascending" : "descending" : "none"}>
    <button type="button" className="table-sort-button" onClick={() => onSort(sortKey)} aria-label={`${label}: ${ascending ? "absteigend" : "aufsteigend"} sortieren`}>
      <span>{label}</span><span className="table-sort-icon" aria-hidden="true">{active ? ascending ? "↑" : "↓" : "↕"}</span>
    </button>
  </th>;
}
