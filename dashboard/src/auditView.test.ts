import { describe, expect, it } from "vitest";

import { auditView } from "./auditView";
import { audit, forecast } from "./data";
import type { AuditFile } from "./types";

const all = auditView(audit, forecast);
const tab = (view: ReturnType<typeof auditView>, label: string) => view.tabs.find((t) => t.label === label)!;
const issue = (view: ReturnType<typeof auditView>, tabLabel: string, title: string) =>
  tab(view, tabLabel).issues.find((i) => i.title === title)!;

describe("summary and the source-file filter", () => {
  it("one line, then each of the 4 files with its count", () => {
    expect(all.summary).toBe("40 issues found across the 4 source files");
    expect(all.files.map((f) => [f.label, f.count])).toEqual([
      ["All files", 40],
      ["Salesforce (this week)", 19],
      ["Salesforce (last week)", 6],
      ["VP scorecard", 9],
      ["HubSpot", 16],
    ]);
  });
});

describe("tabs by type of issue", () => {
  it("judgment calls, fixes, notes; every entry counted once", () => {
    expect(all.tabs.map((t) => [t.label, t.count])).toEqual([
      ["Judgment calls", 6], ["Fixed automatically", 25], ["Notes", 9],
    ]);
    expect(all.tabs.reduce((n, t) => n + t.count, 0)).toBe(audit.entries.length);
  });

  it("issues largest first, each with the pipeline's short resolution", () => {
    expect(tab(all, "Fixed automatically").issues.map((i) => [i.title, i.countText])).toEqual([
      ["Monthly billing converted to annual", "7 records"],
      ["Outside the forecast quarter, left out", "5 records"],
      ["VP rows matched by name", "4 records"],
      ["VP sheet matched by short ID", "4 records"],
      ["Closed Lost deals left out", "2 records"],
      ["Duplicate rows removed", "2 records"],
      ["Conflicting versions, kept the latest", "1 record"],
    ]);
    expect(issue(all, "Fixed automatically", "Monthly billing converted to annual").resolution).toBe("Annual value = amount × 12");
  });

  it("judgment calls also show their dollars", () => {
    expect(issue(all, "Judgment calls", "VP override").resolution)
      .toBe("Formula by default; the VP overrides switch applies the VP's number · +$550K impact");
    expect(issue(all, "Judgment calls", "Past-due deals").resolution).toBe("Kept in the forecast and flagged · $812K at risk");
  });

  it("a Needs a check tab comes first, only when there is something to check", () => {
    const flagged: AuditFile = {
      ...audit,
      entries: [...audit.entries, { ...audit.entries[0], kind: "Needs review", title: "Conflicting versions, latest unclear", action: "Kept the first row; needs a check" }],
    };
    const view = auditView(flagged, forecast);
    expect(view.tabs.map((t) => [t.label, t.count])[0]).toEqual(["Needs a check", 1]);
  });
});

describe("expanded issue: one line per record, with where it is", () => {
  it("customer, file and row, and what was wrong", () => {
    expect(issue(all, "Judgment calls", "Past-due deals").records[0]).toEqual({
      name: "Hyperion Health System",
      dealId: "006PF000001L001YAC",
      where: "Salesforce (this week) row 3",
      wrong: "Close date 2026-10-05 is before 2026-10-15 but the deal is still open",
    });
  });

  it("rows in the same file are joined; records in two files list both", () => {
    expect(issue(all, "Fixed automatically", "Duplicate rows removed").records[0].where).toBe("Salesforce (this week) rows 17, 18");
    expect(issue(all, "Judgment calls", "VP override").records[0].where).toBe("VP scorecard row 9 · Salesforce (this week) row 28");
  });

  it("an issue about a whole file has no customer", () => {
    const missing = issue(all, "Notes", "Columns missing from a file").records[0];
    expect([missing.name, missing.dealId, missing.where]).toEqual([null, null, "HubSpot, whole file"]);
  });
});

describe("filtered to one source file", () => {
  const hubspot = auditView(audit, forecast, "4_carebridge_hubspot_export.csv");

  it("tab counts and records follow the file", () => {
    expect(hubspot.tabs.map((t) => [t.label, t.count])).toEqual([
      ["Judgment calls", 2], ["Fixed automatically", 11], ["Notes", 3],
    ]);
    expect(issue(hubspot, "Judgment calls", "Past-due deals").records.map((r) => r.name)).toEqual(["Zephyr Valley Senior Care"]);
    expect(tab(hubspot, "Fixed automatically").issues.map((i) => i.title)).not.toContain("VP rows matched by name");
  });

  it("the file filter's own counts don't change", () => {
    expect(hubspot.files).toEqual(all.files);
  });

  it("a type with nothing in that file is empty", () => {
    expect(tab(auditView(audit, forecast, "3_vp_deal_scorecard.xlsx"), "Notes").issues).toEqual([]);
  });
});
