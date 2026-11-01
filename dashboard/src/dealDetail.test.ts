import { describe, expect, it } from "vitest";

import { forecast, weekOverWeek } from "./data";
import { dealDetail } from "./dealDetail";
import { BASELINE, promote, setScore, setVpOverride } from "./forecast";

const deal = (id: string) => forecast.deals.find((d) => d.deal_id === id)!;
const detail = (id: string, scenario = BASELINE) => dealDetail(deal(id), scenario, forecast, weekOverWeek);

const IRONWOOD = "006PF000001T005YAC";

describe("every drawer starts the same: name, ID and source file, rep, four numbers", () => {
  it("Ironwood", () => {
    const d = detail(IRONWOOD);
    expect([d.name, d.idLine, d.rep]).toEqual([
      "Ironwood Clinical Center & Health System", "006PF000001T005YAC · Salesforce (this week)", "Victor Vonnegut",
    ]);
    expect(d.figures).toEqual({ expectedValue: "$1.10M", winPercent: "50%", annualValue: "$2.20M", closeDate: "2026-12-22" });
    expect(d.status).toBeNull();
  });

  it("a HubSpot deal names HubSpot as its source", () => {
    expect(detail("HS-9001").idLine).toBe("HS-9001 · HubSpot");
  });

  it("the numbers follow the what-if: a promoted Kestrel at 3/3/3 is 50% of $500K", () => {
    const kestrel = "006PF000001L013YAC";
    expect(detail(kestrel, promote(BASELINE, deal(kestrel), forecast.settings)).figures)
      .toMatchObject({ expectedValue: "$250K", winPercent: "50%" });
  });

  it("a plain deal has nothing else: no attention, notes or changes", () => {
    const d = detail("006PF000001L020YAC");
    expect([d.attention, d.vpNotes, d.changes]).toEqual([[], null, []]);
  });
});

describe("Needs attention: only when something applies, in plain words", () => {
  it("the VP disagrees with the formula", () => {
    expect(detail(IRONWOOD).attention).toEqual(["The VP thinks 75%. Using it adds +$550K."]);
  });

  it("…and once the VP override is on", () => {
    const d = detail(IRONWOOD, setVpOverride(BASELINE, true));
    expect(d.attention).toEqual(["VP override applied: 75% instead of the formula's 50% (+$550K)."]);
    expect(d.figures).toMatchObject({ expectedValue: "$1.65M", winPercent: "75%" });
  });

  it("…but not after the scores were edited", () => {
    const edited = setVpOverride(setScore(BASELINE, deal(IRONWOOD), "contractual", 3), true);
    expect(detail(IRONWOOD, edited).attention).toEqual(["The VP thinks 75%, but the scores were edited, so the formula is used."]);
  });

  it("past due, with the amount at risk", () => {
    expect(detail("006PF000001L001YAC").attention).toEqual(["Past its close date (2026-10-05) but still open. $360K at risk."]);
  });

  it("a merged duplicate names its Salesforce copy", () => {
    expect(detail("HS-9001").attention).toEqual(["Also in Salesforce as 006PF000001M001YAC; counted once, here."]);
  });

  it("a deal that needs review points to the audit tab", () => {
    const flagged = { ...deal("006PF000001L020YAC"), flags: ["needs_review"] };
    expect(dealDetail(flagged, BASELINE, forecast, weekOverWeek).attention).toEqual([
      "A data problem needs a person to check it. See the Data Hygiene & Audit Log tab.",
    ]);
  });
});

describe("VP notes and this week's changes, only when there are any", () => {
  it("Ironwood has VP notes", () => {
    expect(detail(IRONWOOD).vpNotes).toMatch(/^COO verbally committed/);
  });

  it("Solaris changed twice this week", () => {
    expect(detail("006PF000001T002YAC").changes.map((c) => [c.before, c.after, c.change])).toEqual([
      ["Business Approval", "Contract Negotiations", "+$520K"],
      ["Annual value $2.60M", "$3.00M", "+$320K"],
    ]);
  });
});

describe("deals not in the forecast: a status line instead", () => {
  it("slipped: $0 and no win %", () => {
    const d = detail("006PF000001X002YAC"); // Timberline
    expect(d.status).toBe("Not in Q4 forecast: slipped to Q1-2027");
    expect(d.figures).toEqual({ expectedValue: "$0", winPercent: "—", annualValue: "$750K", closeDate: "2027-02-10" });
    expect(d.changes.map((c) => [c.category, c.change])).toEqual([["Slipped out of Q4", "−$450K"]]);
    expect(d.attention).toEqual([]);
  });

  it("Closed Lost", () => {
    expect(detail("006PF000001X004YAC").status).toBe("Not in Q4 forecast: Closed Lost");
  });

  it("a Salesforce copy of a HubSpot deal", () => {
    const d = detail("006PF000001M001YAC");
    expect(d.status).toBe("Not in Q4 forecast: copy of HubSpot deal HS-9001 (counted there)");
    expect(d.changes.map((c) => c.change)).toEqual(["$0 · already counted"]);
  });

  it("a HubSpot deal outside Q4 closes later; it didn't slip", () => {
    expect(detail("HS-9011").status).toBe("Not in Q4 forecast: closes in Q1-2027");
  });
});
