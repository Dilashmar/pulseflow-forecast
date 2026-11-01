// Deal Room table (SPEC 6.2): product and rep filters (the brief's two), search,
// the two sections (Top 8 strategic deals, Forecasted Longtail) with their
// totals, and the Reset to baseline count. Display logic only; every number
// comes from the rows (forecast.ts).

import type { DealRoomRow } from "./dealRoomRows";
import { isChanged, type Scenario } from "./forecast";
import { money } from "./format";

export interface Filters {
  product: string | null;
  rep: string | null;
}

export const NO_FILTERS: Filters = { product: null, rep: null };

export interface Section {
  key: "top" | "longtail";
  title: string;
  rows: DealRoomRow[];
  total: string;
}

export function filterOptions(rows: DealRoomRow[]) {
  const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return {
    products: unique(rows.map((r) => r.product)),
    reps: unique(rows.map((r) => r.salesRep)),
  };
}

/** Rows matching the product, the rep and the search text (all that are set). */
export function visibleRows(rows: DealRoomRow[], filters: Filters, search: string): DealRoomRow[] {
  const query = search.trim().toLowerCase();
  return rows.filter((r) =>
    (filters.product === null || r.product === filters.product)
    && (filters.rep === null || r.salesRep === filters.rep)
    && (query === "" || searchText(r).includes(query)));
}

/** Top 8 in VP rank order (promoted deals after them); Longtail by expected value, largest first. */
export function dealSections(rows: DealRoomRow[]): Section[] {
  const top = rows.filter((r) => r.isTop);
  const longtail = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.isTop)
    .sort((a, b) => b.row.evCents - a.row.evCents || a.index - b.index) // ties keep pipeline order
    .map(({ row }) => row);
  const total = (list: DealRoomRow[]) => money(list.reduce((sum, r) => sum + r.evCents, 0) / 100);
  return [
    { key: "top", title: "Top 8 strategic deals", rows: top, total: total(top) },
    { key: "longtail", title: "Forecasted Longtail", rows: longtail, total: total(longtail) },
  ];
}

/** What Reset to baseline would undo: each edited or moved deal, and the VP override switch. */
export function changeCount(rows: DealRoomRow[], scenario: Scenario): number {
  if (!isChanged(scenario)) return 0;
  return rows.filter((r) => r.edited || r.moved !== null).length + (scenario.vpOverride ? 1 : 0);
}

export function resetLabel(count: number): string {
  return `Reset to baseline (${count} ${count === 1 ? "change" : "changes"})`;
}

function searchText(r: DealRoomRow): string {
  return [r.customer, r.product, r.salesRep, r.stage, r.dealId].join(" ").toLowerCase();
}
