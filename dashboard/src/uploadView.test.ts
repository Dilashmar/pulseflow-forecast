import { describe, expect, it } from "vitest";

import type { CheckResult, ChecklistItem, UpdateStatus } from "./updateApi";
import { SERVER_DOWN, SLOTS, asOfError, canUndo, checklistView, defaultAsOf, slotSources } from "./uploadView";

const STATUS: UpdateStatus = { as_of: "2026-10-15", can_undo: false, undone: false, pending: false };
const FIRST_RUN: UpdateStatus = { as_of: null, can_undo: false, undone: false, pending: false };

const item = (slot: string, label: string, status: ChecklistItem["status"], messages: string[] = []): ChecklistItem =>
  ({ slot, label, file: null, source: null, status, messages });
const allOk = [
  item("sf_current", "This week's Salesforce", "ok"), item("sf_prior", "Last week's Salesforce", "ok"),
  item("hubspot", "HubSpot", "ok"), item("vp_scorecard", "VP scorecard", "ok"), item("as_of", "As-of date", "ok"),
];
const result = (ok: boolean, checklist: ChecklistItem[], message: string | null = null): CheckResult =>
  ({ ok, message, checklist, preview: null });

describe("the four drop zones", () => {
  it("labels, in order, with no 'optional'", () => {
    expect(SLOTS.map((s) => s.label)).toEqual(["This week's Salesforce", "Last week's Salesforce", "HubSpot", "VP scorecard"]);
  });

  it("nothing chosen: every slot reuses last run's file", () => {
    expect(slotSources({}, STATUS)).toEqual({
      sf_current: "Reused (as of 2026-10-15)",
      sf_prior: "Reused (as of 2026-10-15)",
      hubspot: "Reused (as of 2026-10-15)",
      vp_scorecard: "Reused (as of 2026-10-15)",
    });
  });

  it("a new this-week file makes last week automatic", () => {
    const sources = slotSources({ sf_current: "week_2_update.csv" }, STATUS);
    expect(sources.sf_current).toBe("New file: week_2_update.csv");
    expect(sources.sf_prior).toBe("Automatic: last run's this-week file");
    expect(sources.hubspot).toBe("Reused (as of 2026-10-15)");
  });

  it("a chosen last-week file wins over automatic", () => {
    const sources = slotSources({ sf_current: "a.csv", sf_prior: "b.csv" }, STATUS);
    expect(sources.sf_prior).toBe("New file: b.csv");
  });

  it("first run: nothing to reuse", () => {
    expect(slotSources({ hubspot: "h.csv" }, FIRST_RUN)).toEqual({
      sf_current: "Needed for the first run",
      sf_prior: "Needed for the first run",
      hubspot: "New file: h.csv",
      vp_scorecard: "Needed for the first run",
    });
  });
});

describe("as-of date", () => {
  it("defaults to the current data's date, editable", () => {
    expect(defaultAsOf(STATUS, "2026-10-01")).toBe("2026-10-15");
  });

  it("falls back to the dashboard's data date when the server has no run", () => {
    expect(defaultAsOf(FIRST_RUN, "2026-10-15")).toBe("2026-10-15");
    expect(defaultAsOf(null, "2026-10-15")).toBe("2026-10-15");
  });
});

describe("as-of date typed by hand: YYYY-MM-DD, digits and hyphens only", () => {
  const FORMAT = "Use the format YYYY-MM-DD, for example 2026-10-22.";

  it("accepts a real date", () => {
    expect(asOfError("2026-10-22")).toBeNull();
    expect(asOfError("2028-02-29")).toBeNull(); // leap year
  });

  it.each([
    ["22/10/2026"], ["2026-10-2"], ["2026-1-22"], ["26-10-22"], ["20261022"],
    ["2026-1O-22"], ["2026-10-22a"], [" 2026-10-22"], ["2026.10.22"], ["2026–10–22"], [""],
  ])("rejects %j: wrong format or a character other than digits and hyphens", (text) => {
    expect(asOfError(text)).toBe(FORMAT);
  });

  it.each([["2026-13-01"], ["2026-00-10"], ["2026-02-30"], ["2027-02-29"], ["2026-10-00"]])(
    "rejects %j: not a real date", (text) => {
      expect(asOfError(text)).toBe(`${text} isn't a real date.`);
    },
  );
});

describe("checklist: one line when fine, otherwise only the problems", () => {
  it("all fine", () => {
    expect(checklistView(result(true, allOk))).toEqual({
      summary: "✅ All files look good", message: null, problems: [], canApply: true,
    });
  });

  it("warnings: only those rows, and Apply still allowed", () => {
    const list = allOk.map((i) => i.slot === "hubspot"
      ? { ...i, status: "warn" as const, messages: ["This is the same as last run's HubSpot file."] } : i);
    expect(checklistView(result(true, list))).toEqual({
      summary: null,
      message: null,
      problems: [{ key: "hubspot", icon: "⚠️", tone: "warn", label: "HubSpot", messages: ["This is the same as last run's HubSpot file."] }],
      canApply: true,
    });
  });

  it("a stop: ❌ row, no Apply", () => {
    const list = allOk.map((i) => i.slot === "sf_current"
      ? { ...i, status: "stop" as const, messages: ["This looks like a HubSpot export. Put it in the HubSpot slot."] } : i);
    const view = checklistView(result(false, list));
    expect(view.problems.map((p) => [p.icon, p.label])).toEqual([["❌", "This week's Salesforce"]]);
    expect([view.summary, view.canApply]).toEqual([null, false]);
  });

  it("the as-of date warning shows like a file row", () => {
    const list = allOk.map((i) => i.slot === "as_of"
      ? { ...i, status: "warn" as const, messages: ["2026-10-01 is earlier than the last run's date (2026-10-15)."] } : i);
    expect(checklistView(result(true, list)).problems.map((p) => p.label)).toEqual(["As-of date"]);
  });

  it("a message from the server (no new files, first run) is shown and blocks Apply", () => {
    const view = checklistView(result(false, allOk, "No new files. Nothing to update."));
    expect([view.message, view.summary, view.canApply]).toEqual(["No new files. Nothing to update.", null, false]);
  });
});

describe("Undo (go back to last week's data)", () => {
  it("shown only when there is an update to undo; gone after use", () => {
    expect(canUndo(STATUS)).toBe(false);
    expect(canUndo({ ...STATUS, can_undo: true })).toBe(true);
    expect(canUndo({ ...STATUS, undone: true })).toBe(false);
    expect(canUndo(null)).toBe(false); // server not running
  });
});

it("server not running: says how to start it", () => {
  expect(SERVER_DOWN).toBe(
    "The update server isn't running. Start it from the project folder: .venv/bin/uvicorn server.app:app --port 8000",
  );
});
