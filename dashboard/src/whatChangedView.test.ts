import { describe, expect, it } from "vitest";

import { weekOverWeek } from "./data";
import { dealChanges, whatChangedView } from "./whatChangedView";
import type { WeekOverWeekFile } from "./types";

const view = whatChangedView(weekOverWeek);
const section = (title: string) => view.sections.find((s) => s.title === title)!;
const customers = (title: string) => section(title).rows.map((r) => r.customer.split(" ")[0]);

describe("chart: change in stage-based value by category", () => {
  it("one bar per category, largest increase first, with signed labels and counts", () => {
    expect(view.bars.map((b) => [b.label, b.count, b.valueText])).toEqual([
      ["New deals", 4, "+$630K"],
      ["Stage moves", 6, "+$560K"],
      ["Amount changes", 4, "+$460K"],
      ["Closed Lost", 2, "−$460K"],
      ["Slipped out of Q4", 3, "−$740K"],
    ]);
    expect(view.bars.map((b) => b.tone)).toEqual(["up", "up", "up", "down", "down"]);
  });

  it("no Other changes bar while it is $0", () => {
    expect(view.bars.map((b) => b.label)).not.toContain("Other changes");
  });

  it("net change is the sum of the bars: +$450K", () => {
    expect(view.bars.reduce((sum, b) => sum + b.valueCents, 0)).toBe(45_000_000);
    expect(view.net).toBe("Net change: +$450K");
  });

  it("caption and a text summary for screen readers", () => {
    expect(view.caption).toBe("Change in stage-based pipeline value (Salesforce only)");
    expect(view.summary).toBe(
      "New deals +$630K (4 deals); Stage moves +$560K (6 deals); Amount changes +$460K (4 deals); "
      + "Closed Lost −$460K (2 deals); Slipped out of Q4 −$740K (3 deals). Net change: +$450K.",
    );
  });

  it("Other changes appears when Pulled into Q4, Quarter changed or Missing add up to non-zero", () => {
    const pulled = {
      ...weekOverWeek.changes["New Deals"][0], category: "Pulled into Q4", before: "Q1-2027", after: "Q4-2026", ev_change: 75_000,
    };
    const wow: WeekOverWeekFile = { ...weekOverWeek, changes: { ...weekOverWeek.changes, "Pulled into Q4": [pulled] } };
    const other = whatChangedView(wow).bars.find((b) => b.label === "Other changes")!;
    expect([other.count, other.valueText]).toEqual([1, "+$75K"]);
    expect(whatChangedView(wow).sections.map((s) => s.title)).toContain("Pulled into Q4");
  });
});

describe("tables: one per category", () => {
  it("in chart order, then copies; empty ones hidden", () => {
    expect(view.sections.map((s) => s.title)).toEqual([
      "New deals", "Stage moves", "Amount changes", "Closed Lost", "Slipped out of Q4", "Copied from HubSpot (not new)",
    ]);
  });

  it("headings show the count and net change", () => {
    expect(section("Stage moves").heading).toBe("Stage moves · 6 deals · net +$560K");
    expect(section("Closed Lost").heading).toBe("Closed Lost · 2 deals · net −$460K");
    expect(section("Copied from HubSpot (not new)").heading).toBe("Copied from HubSpot (not new) · 1 deal");
  });

  it("rows sorted by the largest change either way", () => {
    expect(customers("Stage moves")).toEqual(["Solaris", "Borealis", "Zephyr", "Mirage", "Caledonia", "Alabaster"]);
    expect(customers("Slipped out of Q4")).toEqual(["Timberline", "Fjordland", "Greystone"]);
  });

  it("new deal: not in last week's export → stage and amount", () => {
    const nebula = section("New deals").rows[0];
    expect(nebula.customer).toBe("Nebula Health Alliance");
    expect([nebula.before, nebula.after, nebula.change, nebula.tone]).toEqual([
      "Not in last week's export", "Business Approval · $600K", "+$360K", "up",
    ]);
  });

  it("stage move: direction as an arrow and a word", () => {
    const [solaris, borealis] = section("Stage moves").rows;
    expect([solaris.before, solaris.after, solaris.change]).toEqual(["Business Approval", "Contract Negotiations", "+$520K"]);
    expect(solaris.direction).toEqual({ symbol: "▲", word: "Advanced" });
    expect(borealis.direction).toEqual({ symbol: "▼", word: "Regressed" });
    expect(borealis.tone).toBe("down");
  });

  it("amount change: ACV before → after, the ACV difference as a note, the change in value", () => {
    const caledonia = section("Amount changes").rows.find((r) => r.customer.startsWith("Caledonia"))!;
    expect([caledonia.before, caledonia.after, caledonia.acvNote, caledonia.change]).toEqual([
      "$400K", "$550K", "+$150K ACV", "+$120K",
    ]);
    expect(caledonia.direction).toEqual({ symbol: "▲", word: "Increase" });
    const windward = section("Amount changes").rows.find((r) => r.customer.startsWith("Windward"))!;
    expect([windward.acvNote, windward.change, windward.direction?.word]).toEqual(["−$100K ACV", "−$60K", "Decrease"]);
  });

  it("slipped and Closed Lost", () => {
    const timberline = section("Slipped out of Q4").rows[0];
    expect([timberline.before, timberline.after, timberline.change]).toEqual(["Q4-2026", "Q1-2027", "−$450K"]);
    const coral = section("Closed Lost").rows[0];
    expect([coral.before, coral.after, coral.change]).toEqual(["Technical Validation", "Closed Lost", "−$260K"]);
  });

  it("a copy of a HubSpot deal is $0, already counted", () => {
    const [copy] = section("Copied from HubSpot (not new)").rows;
    expect([copy.after, copy.change, copy.tone]).toEqual(["Copy of HubSpot deal HS-9001", "$0 · already counted", "zero"]);
  });

  it("Top deals are marked, with a note that changes here are stage-based", () => {
    expect(section("Stage moves").rows.filter((r) => r.isTop).map((r) => r.customer.split(" ")[0])).toEqual([
      "Solaris", "Borealis", "Zephyr",
    ]);
    expect(view.topNote).toBe(
      "Top deals are forecast from VP scores. Changes here use stage probability, so they won't match the forecast's change for those deals.",
    );
  });

  it("a deal in two tables says where else it is", () => {
    const stageCaledonia = section("Stage moves").rows.find((r) => r.customer.startsWith("Caledonia"))!;
    const amountCaledonia = section("Amount changes").rows.find((r) => r.customer.startsWith("Caledonia"))!;
    expect(stageCaledonia.alsoIn).toBe("Also in Amount changes");
    expect(amountCaledonia.alsoIn).toBe("Also in Stage moves");
    expect(section("New deals").rows[0].alsoIn).toBeNull();
  });

  it("Couldn't compare is listed when it isn't empty", () => {
    const wow: WeekOverWeekFile = {
      ...weekOverWeek,
      couldnt_compare: [{
        deal_id: "X", customer: "Example Health", product: "PulseOR", sales_rep: "A Rep", week: "this week",
        reason: "Row set aside this week (needs review); see the audit log",
      }],
    };
    const s = whatChangedView(wow).sections.at(-1)!;
    expect(s.heading).toBe("Couldn't compare · 1 deal");
    expect([s.rows[0].after, s.rows[0].change]).toEqual(["Row set aside this week (needs review); see the audit log", "—"]);
  });
});

describe("one deal's changes, for the detail panel", () => {
  it("Caledonia: stage move and amount change", () => {
    expect(dealChanges(weekOverWeek, "006PF000001L008YAC").map((r) => [r.category, r.change])).toEqual([
      ["Stage moves", "+$80K"],
      ["Amount changes", "+$120K"],
    ]);
  });

  it("a deal with no change has none", () => {
    expect(dealChanges(weekOverWeek, "006PF000001L020YAC")).toEqual([]);
  });
});
