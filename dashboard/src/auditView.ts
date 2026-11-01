// What the Data Hygiene & Audit Log tab shows (SPEC 6.4), organised in three
// steps: a source-file filter, tabs by type of issue, then the issues (one per
// pipeline title, with its short action) that open to their records. Only
// judgment calls show dollars; every entry's $ impact stays in audit_log.json.
// Display logic only.

import { money, signedMoney } from "./format";
import type { AuditEntry, AuditFile, AuditRecord, Deal, ForecastFile } from "./types";

export const ALL_FILES = "all";

export interface FileFilter {
  key: string; // a source file name, or ALL_FILES
  label: string;
  count: number;
}

export interface AuditRecordLine {
  name: string | null; // the deal's customer; null when the entry is about a whole file
  dealId: string | null; // a deal in forecast.json to open, if the entry names one
  where: string; // "Salesforce (this week) rows 17, 18 · VP scorecard row 9"
  wrong: string;
}

export interface AuditIssue {
  key: string;
  title: string;
  resolution: string;
  countText: string;
  records: AuditRecordLine[];
}

export interface AuditTab {
  key: string;
  label: string;
  count: number;
  issues: AuditIssue[];
}

export interface AuditView {
  summary: string;
  files: FileFilter[];
  tabs: AuditTab[];
}

// Tabs in order. "Needs a check" only appears when the log has one of those.
const TABS: { key: string; label: string; kinds: AuditEntry["kind"][]; optional?: boolean }[] = [
  { key: "attention", label: "Needs a check", kinds: ["Needs review", "Flag"], optional: true },
  { key: "decisions", label: "Judgment calls", kinds: ["Decision"] },
  { key: "fixes", label: "Fixed automatically", kinds: ["Fix"] },
  { key: "notes", label: "Notes", kinds: ["Note"] },
];

// forecast.json's input file keys (config.FILES) -> how the tab names each file.
const FILE_LABELS: Record<string, string> = {
  sf_current: "Salesforce (this week)",
  sf_prior: "Salesforce (last week)",
  vp_scorecard: "VP scorecard",
  hubspot: "HubSpot",
};

const cents = (dollars: number) => Math.round(dollars * 100);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function auditView(audit: AuditFile, forecast: ForecastFile, file: string = ALL_FILES): AuditView {
  const inputFiles = forecast.meta.input_files;
  const label = (name: string) => FILE_LABELS[Object.keys(inputFiles).find((k) => inputFiles[k] === name) ?? ""] ?? name;
  const touches = (e: AuditEntry, name: string) => e.records.some((r) => r.source_file === name);

  const files: FileFilter[] = [
    { key: ALL_FILES, label: "All files", count: audit.entries.length },
    ...Object.keys(FILE_LABELS).filter((k) => inputFiles[k]).map((k) => ({
      key: inputFiles[k],
      label: FILE_LABELS[k],
      count: audit.entries.filter((e) => touches(e, inputFiles[k])).length,
    })),
  ];

  const shown = file === ALL_FILES ? audit.entries : audit.entries.filter((e) => touches(e, file));
  const tabs = TABS
    .filter((t) => !t.optional || audit.entries.some((e) => t.kinds.includes(e.kind)))
    .map((t) => {
      const entries = shown.filter((e) => t.kinds.includes(e.kind));
      const issues = byTitle(entries)
        .map((group) => issueOf(group, forecast, label))
        .sort((a, b) => b.records.length - a.records.length || a.title.localeCompare(b.title));
      return { key: t.key, label: t.label, count: entries.length, issues };
    });

  return {
    summary: `${count(audit.entries.length, "issue", "issues")} found across the ${files.length - 1} source files`,
    files,
    tabs,
  };
}

function issueOf(entries: AuditEntry[], forecast: ForecastFile, label: (name: string) => string): AuditIssue {
  const first = entries[0];
  let resolution = first.action;
  if (first.kind === "Decision") {
    // Judgment calls are what the meeting decides on, so they keep their dollars.
    const impact = entries.reduce((sum, e) => sum + cents(e.impact), 0) / 100;
    const atRisk = entries.reduce((sum, e) => sum + cents(e.at_risk ?? 0), 0) / 100;
    if (impact !== 0) resolution += ` · ${signedMoney(impact)} impact`;
    if (atRisk !== 0) resolution += ` · ${money(atRisk)} at risk`;
  }
  return {
    key: first.title,
    title: first.title,
    resolution,
    countText: count(entries.length, "record", "records"),
    records: entries.map((e) => {
      const deal = entryDeal(e, forecast);
      return {
        name: deal?.customer ?? e.records.find((r) => r.customer)?.customer ?? null,
        dealId: deal?.deal_id ?? null,
        where: whereText(e.records, label),
        wrong: e.what_was_wrong,
      };
    }),
  };
}

/** "Salesforce (this week) rows 17, 18", "VP scorecard row 9 · Salesforce (this week) row 28", "HubSpot, whole file". */
function whereText(records: AuditRecord[], label: (name: string) => string): string {
  const rowsByFile = new Map<string, (number | null)[]>();
  for (const r of records) rowsByFile.set(r.source_file, [...(rowsByFile.get(r.source_file) ?? []), r.source_row]);
  return [...rowsByFile].map(([name, rows]) => {
    const numbers = rows.filter((n): n is number => n !== null);
    if (numbers.length === 0) return `${label(name)}, whole file`;
    return `${label(name)} ${numbers.length === 1 ? "row" : "rows"} ${numbers.join(", ")}`;
  }).join(" · ");
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
    if (r.deal_id === null) continue;
    const deal = forecast.deals.find((d) => d.deal_id === r.deal_id || d.match_key === r.deal_id);
    if (deal) return deal;
  }
  return undefined;
}
