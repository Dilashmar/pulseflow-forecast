// What the What Changed tab shows (SPEC 5): a bar per category of change in
// stage-based value, and one table per category. Display logic only; every
// number comes from the pipeline's week_over_week.json.

import { money, signedMoney } from "./format";
import type { CouldntCompare, WeekChange, WeekOverWeekFile } from "./types";

export type Tone = "up" | "down" | "zero";

export interface ChangeBar {
  key: string;
  label: string;
  count: number;
  valueCents: number;
  valueText: string;
  tone: Tone;
}

export interface ChangeRow {
  key: string;
  category: string; // the section title, e.g. "Stage moves"
  dealId: string;
  customer: string;
  product: string;
  salesRep: string;
  isTop: boolean;
  before: string | null; // null: nothing to compare (Couldn't compare)
  after: string;
  direction: { symbol: "▲" | "▼" | null; word: string } | null;
  acvNote: string | null;
  change: string;
  changeCents: number; // for sorting
  tone: Tone;
  alsoIn: string | null;
}

export interface ChangeSection {
  key: string;
  title: string;
  heading: string;
  rows: ChangeRow[];
}

export interface WhatChangedView {
  caption: string;
  bars: ChangeBar[];
  net: string;
  summary: string; // the chart in words, for screen readers
  topNote: string | null;
  sections: ChangeSection[];
}

const OTHER = "Other changes"; // a chart bar only when its value isn't $0

// Pipeline categories (week_over_week.py) -> what the tab calls them. "group" is the chart bar.
const CATEGORIES: { key: string; title: string; group: string }[] = [
  { key: "New Deals", title: "New deals", group: "New deals" },
  { key: "Slipped (out of Q4)", title: "Slipped out of Q4", group: "Slipped out of Q4" },
  { key: "Closed Lost", title: "Closed Lost", group: "Closed Lost" },
  { key: "Stage Moves", title: "Stage moves", group: "Stage moves" },
  { key: "ACV Changes", title: "Amount changes", group: "Amount changes" },
  { key: "Pulled into Q4", title: "Pulled into Q4", group: OTHER },
  { key: "Quarter changed (other)", title: "Quarter changed (other)", group: OTHER },
  { key: "Missing from current", title: "Missing from this week's export", group: OTHER },
];
const COPIED = { key: "Copied from HubSpot", title: "Copied from HubSpot (not new)" };
const COULDNT_COMPARE = "Couldn't compare";

const DIRECTIONS: Record<string, ChangeRow["direction"]> = {
  advanced: { symbol: "▲", word: "Advanced" },
  regressed: { symbol: "▼", word: "Regressed" },
  changed: { symbol: null, word: "Changed" },
  expansion: { symbol: "▲", word: "Increase" },
  contraction: { symbol: "▼", word: "Decrease" },
};

const BLANK = "—";
const cents = (dollars: number) => Math.round(dollars * 100);
const toneOf = (c: number): Tone => (c > 0 ? "up" : c < 0 ? "down" : "zero");
const plural = (n: number) => `${n} ${n === 1 ? "deal" : "deals"}`;

export function whatChangedView(wow: WeekOverWeekFile): WhatChangedView {
  const changes = (key: string) => wow.changes[key] ?? [];
  const titlesByDeal = dealTitles(wow);

  // Bars: one per group, largest increase first. Other changes only when it isn't $0.
  const groups = [...new Set(CATEGORIES.map((c) => c.group))];
  const bars = groups
    .map((group) => {
      const list = CATEGORIES.filter((c) => c.group === group).flatMap((c) => changes(c.key));
      const valueCents = list.reduce((sum, ch) => sum + cents(ch.ev_change), 0);
      return { key: group, label: group, count: list.length, valueCents, valueText: signedMoney(valueCents / 100), tone: toneOf(valueCents) };
    })
    .filter((b) => b.label !== OTHER || b.valueCents !== 0)
    .sort((a, b) => b.valueCents - a.valueCents);

  const netCents = bars.reduce((sum, b) => sum + b.valueCents, 0);
  const net = `Net change: ${signedMoney(netCents / 100)}`;
  const summary = `${bars.map((b) => `${b.label} ${b.valueText} (${plural(b.count)})`).join("; ")}. ${net}.`;

  // Tables: in chart order (an Other changes group lists each of its categories), then copies, then couldn't compare.
  const sections: ChangeSection[] = [];
  for (const bar of bars) {
    for (const c of CATEGORIES.filter((c) => c.group === bar.key)) {
      const rows = changes(c.key).map((ch) => changeRow(ch, c.title, titlesByDeal));
      if (rows.length === 0) continue;
      const total = changes(c.key).reduce((sum, ch) => sum + cents(ch.ev_change), 0);
      sections.push({ key: c.key, title: c.title, heading: `${c.title} · ${plural(rows.length)} · net ${signedMoney(total / 100)}`, rows: sortRows(rows) });
    }
  }
  const copies = changes(COPIED.key).map((ch) => changeRow(ch, COPIED.title, titlesByDeal));
  if (copies.length > 0) {
    sections.push({ key: COPIED.key, title: COPIED.title, heading: `${COPIED.title} · ${plural(copies.length)}`, rows: copies });
  }
  if (wow.couldnt_compare.length > 0) {
    sections.push({
      key: COULDNT_COMPARE,
      title: COULDNT_COMPARE,
      heading: `${COULDNT_COMPARE} · ${plural(wow.couldnt_compare.length)}`,
      rows: wow.couldnt_compare.map(couldntCompareRow),
    });
  }

  const anyTop = sections.some((s) => s.rows.some((r) => r.isTop));
  return {
    caption: `Change in ${wow.ev_basis} pipeline value (Salesforce only)`,
    bars,
    net,
    summary,
    topNote: anyTop
      ? "Top deals are forecast from VP scores. Changes here use stage probability, so they won't match the forecast's change for those deals."
      : null,
    sections,
  };
}

/** One deal's changes this week, for the detail panel (in table order). */
export function dealChanges(wow: WeekOverWeekFile, dealId: string): ChangeRow[] {
  return whatChangedView(wow).sections.flatMap((s) => s.rows.filter((r) => r.dealId === dealId));
}

function changeRow(ch: WeekChange, title: string, titlesByDeal: Map<string, string[]>): ChangeRow {
  const c = cents(ch.ev_change);
  const copy = ch.category === COPIED.key;
  const others = (titlesByDeal.get(ch.deal_id) ?? []).filter((t) => t !== title);
  return {
    key: `${ch.category}-${ch.deal_id}`,
    category: title,
    dealId: ch.deal_id,
    customer: ch.customer ?? BLANK,
    product: ch.product ?? BLANK,
    salesRep: ch.sales_rep ?? BLANK,
    isTop: ch.bucket === "Top",
    before: ch.before === null ? "Not in last week's export" : readable(ch.before),
    after: ch.after === null ? "Not in this week's export" : readable(ch.after),
    direction: ch.label ? DIRECTIONS[ch.label] ?? { symbol: null, word: ch.label } : null,
    acvNote: ch.acv_change === null ? null : `${signedMoney(ch.acv_change)} ACV`,
    change: copy ? "$0 · already counted" : signedMoney(c / 100),
    changeCents: c,
    tone: toneOf(c),
    alsoIn: others.length > 0 ? `Also in ${others.join(", ")}` : null,
  };
}

function couldntCompareRow(d: CouldntCompare): ChangeRow {
  return {
    key: `couldnt-${d.deal_id}`,
    category: COULDNT_COMPARE,
    dealId: d.deal_id,
    customer: d.customer ?? BLANK,
    product: d.product ?? BLANK,
    salesRep: d.sales_rep ?? BLANK,
    isTop: false,
    before: null,
    after: d.reason,
    direction: null,
    acvNote: null,
    change: BLANK,
    changeCents: 0,
    tone: "zero",
    alsoIn: null,
  };
}

/** Section titles each deal appears under, for the "Also in" note. */
function dealTitles(wow: WeekOverWeekFile): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of CATEGORIES) {
    for (const ch of wow.changes[c.key] ?? []) map.set(ch.deal_id, [...(map.get(ch.deal_id) ?? []), c.title]);
  }
  return map;
}

/** Largest change either way first; ties by customer. */
function sortRows(rows: ChangeRow[]): ChangeRow[] {
  return [...rows].sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents) || a.customer.localeCompare(b.customer));
}

/** "Technical Validation, $350,000" -> "Technical Validation · $350K". Text without amounts is unchanged. */
function readable(text: string): string {
  return text.replace(/, (?=\$)/g, " · ").replace(/\$([\d,]+(?:\.\d+)?)/g, (_, n: string) => money(Number(n.replace(/,/g, ""))));
}
