// What the What Changed tab shows (SPEC 6.3): a column per category of change in
// stage-based value, in the brief's order; selecting a column lists its deals.
// Display logic only; every number comes from the pipeline's week_over_week.json.

import { money, signedMoney } from "./format";
import type { CouldntCompare, WeekChange, WeekOverWeekFile } from "./types";

export type Tone = "up" | "down" | "zero";

export interface ChangeRow {
  key: string;
  category: string; // the pipeline category's name here, e.g. "Stage moves"
  dealId: string;
  customer: string;
  before: string | null; // null: nothing before (a new deal, Couldn't compare)
  after: string;
  change: string;
  changeCents: number; // for sorting
  tone: Tone;
}

export interface ChangeCategory {
  key: string; // the first pipeline category in it (selection key)
  label: string;
  countText: string;
  valueCents: number;
  valueText: string;
  tone: Tone;
  rows: ChangeRow[];
}

export interface WhatChangedView {
  caption: string;
  categories: ChangeCategory[]; // the chart's columns, in the brief's order
  defaultKey: string; // the column selected when the tab opens
  net: string;
  netTone: Tone;
  summary: string; // the chart in words, for screen readers
  note: string;
  couldntCompare: ChangeRow[];
}

const OTHER = "Other changes"; // a column only when its value isn't $0

// Pipeline categories (week_over_week.py) -> what the tab calls them. "column" is the chart column.
const CATEGORIES: { key: string; title: string; column: string }[] = [
  { key: "New Deals", title: "New deals", column: "New deals" },
  { key: "Slipped (out of Q4)", title: "Slipped out of Q4", column: "Slipped out of Q4" },
  { key: "Closed Lost", title: "Closed Lost", column: "Closed Lost" },
  { key: "Stage Moves", title: "Stage moves", column: "Stage moves" },
  { key: "ACV Changes", title: "Amount changes", column: "Amount changes" },
  { key: "Pulled into Q4", title: "Pulled into Q4", column: OTHER },
  { key: "Quarter changed (other)", title: "Quarter changed (other)", column: OTHER },
  { key: "Missing from current", title: "Missing from this week's export", column: OTHER },
];
// Not a column: a copy of a HubSpot deal isn't a change. Its deal panel still says so.
const COPIED = { key: "Copied from HubSpot", title: "Copied from HubSpot (not new)" };
const COULDNT_COMPARE = "Couldn't compare";

const BLANK = "—";
const cents = (dollars: number) => Math.round(dollars * 100);
const toneOf = (c: number): Tone => (c > 0 ? "up" : c < 0 ? "down" : "zero");
const plural = (n: number) => `${n} ${n === 1 ? "deal" : "deals"}`;

export function whatChangedView(wow: WeekOverWeekFile): WhatChangedView {
  const changes = (key: string) => wow.changes[key] ?? [];

  const columns = [...new Set(CATEGORIES.map((c) => c.column))];
  const categories = columns
    .map((column) => {
      const members = CATEGORIES.filter((c) => c.column === column);
      const rows = sortRows(members.flatMap((c) => changes(c.key).map((ch) => changeRow(ch, c.title))));
      const valueCents = rows.reduce((sum, r) => sum + r.changeCents, 0);
      return {
        key: members[0].key,
        label: column,
        countText: plural(rows.length),
        valueCents,
        valueText: signedMoney(valueCents / 100),
        tone: toneOf(valueCents),
        rows,
      };
    })
    .filter((c) => c.label !== OTHER || c.valueCents !== 0);

  const netCents = categories.reduce((sum, c) => sum + c.valueCents, 0);
  const net = signedMoney(netCents / 100);

  return {
    caption: `Salesforce pipeline, ${wow.ev_basis} value. Select a column to see its deals.`,
    categories,
    defaultKey: (categories.find((c) => c.rows.length > 0) ?? categories[0]).key,
    net,
    netTone: toneOf(netCents),
    summary: `${categories.map((c) => `${c.label} ${c.valueText} (${c.countText})`).join("; ")}. Net change ${net}.`,
    note: "Values use stage probability, so Top deals here won't match their VP-scored forecast.",
    couldntCompare: wow.couldnt_compare.map(couldntCompareRow),
  };
}

/** One deal's changes this week, for the detail panel (in the chart's order). */
export function dealChanges(wow: WeekOverWeekFile, dealId: string): ChangeRow[] {
  const view = whatChangedView(wow);
  const copies = (wow.changes[COPIED.key] ?? []).map((ch) => changeRow(ch, COPIED.title));
  return [...view.categories.flatMap((c) => c.rows), ...copies, ...view.couldntCompare].filter((r) => r.dealId === dealId);
}

function changeRow(ch: WeekChange, title: string): ChangeRow {
  const c = cents(ch.ev_change);
  const copy = ch.category === COPIED.key;
  let before = ch.before === null ? null : readable(ch.before);
  let after = ch.after === null ? "Not in this week's export" : readable(ch.after);
  if (ch.before === null && !copy) after = `New · ${after}`;
  if (ch.acv_change !== null && before !== null) before = `Annual value ${before}`;
  return {
    key: `${ch.category}-${ch.deal_id}`,
    category: title,
    dealId: ch.deal_id,
    customer: ch.customer ?? BLANK,
    before,
    after,
    change: copy ? "$0 · already counted" : signedMoney(c / 100),
    changeCents: c,
    tone: toneOf(c),
  };
}

function couldntCompareRow(d: CouldntCompare): ChangeRow {
  return {
    key: `couldnt-${d.deal_id}`,
    category: COULDNT_COMPARE,
    dealId: d.deal_id,
    customer: d.customer ?? BLANK,
    before: null,
    after: d.reason,
    change: BLANK,
    changeCents: 0,
    tone: "zero",
  };
}

/** Largest change either way first; ties by customer. */
function sortRows(rows: ChangeRow[]): ChangeRow[] {
  return [...rows].sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents) || a.customer.localeCompare(b.customer));
}

/** "Technical Validation, $350,000" -> "Technical Validation · $350K". Text without amounts is unchanged. */
function readable(text: string): string {
  return text.replace(/, (?=\$)/g, " · ").replace(/\$([\d,]+(?:\.\d+)?)/g, (_, n: string) => money(Number(n.replace(/,/g, ""))));
}
