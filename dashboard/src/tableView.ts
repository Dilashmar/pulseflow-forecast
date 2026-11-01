// Deal Room table: filters, search, sort, record count and filtered subtotal.
// Display logic only; every number comes from the rows (forecast.ts).

import type { DealRoomRow, FlagKey } from "./dealRoomRows";
import { money } from "./format";
import type { Bucket } from "./types";

export interface Filters {
  products: string[]; // any of these
  rep: string | null;
  buckets: Bucket[]; // any of these
  flags: FlagKey[]; // any of these
}

export const NO_FILTERS: Filters = { products: [], rep: null, buckets: [], flags: [] };

export type SortKey =
  | "customer" | "bucket" | "product" | "salesRep" | "stage"
  | "annualAcv" | "gpa" | "probability" | "expectedValue";

export interface Sort {
  key: SortKey;
  direction: "asc" | "desc";
}

export const FLAG_FILTERS: { key: FlagKey; label: string }[] = [
  { key: "past_due", label: "Past due" },
  { key: "duplicate_merged", label: "Merged duplicate" },
  { key: "vp_override", label: "VP override" },
  { key: "needs_review", label: "Needs review" },
  { key: "edited", label: "Edited" },
];

export function filterOptions(rows: DealRoomRow[]) {
  const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return {
    products: unique(rows.map((r) => r.product)),
    reps: unique(rows.map((r) => r.salesRep)),
  };
}

/** Number of ticked filter options (search is not counted). */
export function activeFilterCount(filters: Filters): number {
  return filters.products.length + (filters.rep === null ? 0 : 1) + filters.buckets.length + filters.flags.length;
}

/** Filter (every group must pass; within a group any ticked option counts), search, then sort. */
export function visibleRows(rows: DealRoomRow[], filters: Filters, search: string, sort: Sort | null): DealRoomRow[] {
  const query = search.trim().toLowerCase();
  const kept = rows.filter((r) =>
    (filters.products.length === 0 || filters.products.includes(r.product))
    && (filters.rep === null || r.salesRep === filters.rep)
    && (filters.buckets.length === 0 || filters.buckets.includes(r.bucket))
    && (filters.flags.length === 0 || filters.flags.some((f) => r.flagKeys.includes(f)))
    && (query === "" || searchText(r).includes(query)));
  return sort ? sortRows(kept, sort) : kept; // no sort: pipeline order (Top by rank, then Longtail)
}

export function summary(visible: DealRoomRow[], totalCount: number): string {
  const cents = visible.reduce((sum, r) => sum + r.evCents, 0);
  return `Showing ${visible.length} of ${totalCount} deals · ${money(cents / 100)} expected value`;
}

function searchText(r: DealRoomRow): string {
  return [r.customer, r.product, r.salesRep, r.stage, r.dealId].join(" ").toLowerCase();
}

function sortValue(r: DealRoomRow, key: SortKey): string | number | null {
  switch (key) {
    case "customer": return r.customer;
    case "bucket": return r.bucket;
    case "product": return r.product;
    case "salesRep": return r.salesRep;
    case "stage": return r.stage;
    case "annualAcv": return r.acvValue;
    case "gpa": return r.gpaX100;
    case "probability": return r.probabilityValue;
    case "expectedValue": return r.evCents;
  }
}

function sortRows(rows: DealRoomRow[], sort: Sort): DealRoomRow[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = sortValue(a.row, sort.key);
      const y = sortValue(b.row, sort.key);
      if (x === null && y === null) return a.index - b.index;
      if (x === null) return 1; // blanks (e.g. Longtail GPA) last either way
      if (y === null) return -1;
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return order !== 0 ? sign * order : a.index - b.index; // ties keep pipeline order
    })
    .map(({ row }) => row);
}
