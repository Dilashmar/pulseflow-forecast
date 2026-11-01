// What the Data Hygiene & Audit Log tab shows (SPEC 6.4): a count summary, the
// judgment calls (Decision entries) with their reasoning and dollars, then
// everything else grouped by the pipeline's plain-English title. "Show all
// issues" opens the full table, one row per entry, with source file, record and
// $ impact, for whoever checks the numbers. Display logic only.

import { money, signedMoney } from "./format";
import type { AuditEntry, AuditFile, AuditRecord, Deal, ForecastFile } from "./types";

export type Kind = AuditEntry["kind"];

export interface AuditItem {
  name: string | null; // the deal's customer; null when the entry is about a whole file
  dealId: string | null; // a deal in forecast.json to open, if the entry names one
  detail: string; // what was wrong
}

export interface AuditGroup {
  key: string;
  title: string;
  countText: string; // "7 deals", or "3 issues" when not every entry is about a deal
  items: AuditItem[];
}

export interface JudgmentItem extends AuditItem {
  amount: string; // "+$550K impact" or "$360K at risk"
}

export interface JudgmentCall {
  key: string;
  title: string;
  check: string;
  amount: string;
  decision: string;
  reasoning: string | null;
  items: JudgmentItem[];
}

export interface AuditTableRow {
  key: string;
  title: string;
  kind: Kind;
  records: { file: string; record: string; dealId: string | null }[]; // one line per record
  issue: string; // what was wrong
  resolution: string;
  impact: string; // "+$320K", "$0", or "$360K at risk"
}

export interface AuditView {
  summary: string;
  judgmentCalls: JudgmentCall[];
  attention: AuditGroup[]; // Needs review and Flag: a person should look
  fixes: AuditGroup[];
  notes: AuditGroup[];
  notesSummary: string;
}

const ATTENTION: Kind[] = ["Needs review", "Flag"];
const cents = (dollars: number) => Math.round(dollars * 100);
const checkNumber = (check: string) => Number(check.replace(/\D/g, "")) || 0;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function auditView(audit: AuditFile, forecast: ForecastFile): AuditView {
  const ofKinds = (kinds: Kind[]) => audit.entries.filter((e) => kinds.includes(e.kind));
  const item = (e: AuditEntry): AuditItem => {
    const deal = entryDeal(e, forecast);
    return { name: deal?.customer ?? e.records.find((r) => r.customer)?.customer ?? null, dealId: deal?.deal_id ?? null, detail: e.what_was_wrong };
  };

  // Judgment calls: one card per title, in check order (D5, D6, D9...).
  const decisions = ofKinds(["Decision"]);
  const judgmentCalls = byTitle(decisions)
    .sort((a, b) => checkNumber(a[0].check) - checkNumber(b[0].check))
    .map((entries) => {
      const impact = entries.reduce((sum, e) => sum + cents(e.impact), 0) / 100;
      const atRisk = entries.reduce((sum, e) => sum + cents(e.at_risk ?? 0), 0) / 100;
      return {
        key: entries[0].title,
        title: entries[0].title,
        check: entries[0].check,
        amount: amountText(impact, atRisk),
        decision: entries[0].resolution,
        reasoning: entries[0].reasoning,
        items: entries.map((e) => ({ ...item(e), amount: amountText(e.impact, e.at_risk ?? 0) })),
      };
    });

  const groups = (kinds: Kind[]): AuditGroup[] =>
    byTitle(ofKinds(kinds))
      .map((entries) => {
        const items = entries.map(item);
        const allDeals = items.every((i) => i.dealId !== null);
        return {
          key: entries[0].title,
          title: entries[0].title,
          countText: count(items.length, allDeals ? "deal" : "issue", allDeals ? "deals" : "issues"),
          items,
        };
      })
      .sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title));

  const attention = groups(ATTENTION);
  const fixes = groups(["Fix"]);
  const notes = groups(["Note"]);
  const fixCount = ofKinds(["Fix"]).length;
  const attentionCount = ofKinds(ATTENTION).length;
  const noteCount = ofKinds(["Note"]).length;

  const summary = [
    `${count(fixCount, "issue", "issues")} fixed automatically`,
    `${count(judgmentCalls.length, "judgment call needs", "judgment calls need")} your attention`,
    attentionCount > 0 ? `${count(attentionCount, "issue needs", "issues need")} a check` : null,
  ].filter(Boolean).join(" · ");

  return {
    summary,
    judgmentCalls,
    attention,
    fixes,
    notes,
    notesSummary: `${count(noteCount, "note", "notes")} with no effect on the forecast`,
  };
}

/** Every audit entry, in audit_log.json order. */
export function auditTable(audit: AuditFile, forecast: ForecastFile): AuditTableRow[] {
  return audit.entries.map((e, i) => ({
    key: `${e.check}-${i}`,
    title: e.title,
    kind: e.kind,
    records: e.records.map((r) => ({
      file: r.source_file,
      record: r.source_row === null ? "Whole file" : [`Row ${r.source_row}`, r.customer].filter(Boolean).join(" · "),
      dealId: recordDeal(r, forecast)?.deal_id ?? null,
    })),
    issue: e.what_was_wrong,
    resolution: e.resolution,
    impact: e.impact === 0 && e.at_risk ? `${money(e.at_risk)} at risk` : e.impact === 0 ? "$0" : signedMoney(e.impact),
  }));
}

/** Entries grouped by title, each group in audit_log.json order. */
function byTitle(entries: AuditEntry[]): AuditEntry[][] {
  const map = new Map<string, AuditEntry[]>();
  for (const e of entries) map.set(e.title, [...(map.get(e.title) ?? []), e]);
  return [...map.values()];
}

/** The deal an entry is about: the first record whose ID (full, or a 15-character match key) is in forecast.json. */
function entryDeal(entry: AuditEntry, forecast: ForecastFile): Deal | undefined {
  for (const r of entry.records) {
    const deal = recordDeal(r, forecast);
    if (deal) return deal;
  }
  return undefined;
}

/** The deal in forecast.json a record names, by full ID or 15-character match key. */
function recordDeal(r: AuditRecord, forecast: ForecastFile): Deal | undefined {
  if (r.deal_id === null) return undefined;
  return forecast.deals.find((d) => d.deal_id === r.deal_id || d.match_key === r.deal_id);
}

function amountText(impact: number, atRisk: number): string {
  if (atRisk !== 0 && impact === 0) return `${money(atRisk)} at risk`;
  return `${impact === 0 ? "$0" : signedMoney(impact)} impact`;
}
