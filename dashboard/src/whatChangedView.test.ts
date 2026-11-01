import { describe, expect, it } from "vitest";

import { weekOverWeek } from "./data";
import { dealChanges, whatChangedView } from "./whatChangedView";
import type { WeekOverWeekFile } from "./types";

const view = whatChangedView(weekOverWeek);
const category = (label: string) => view.categories.find((c) => c.label === label)!;
const firstWords = (label: string) => category(label).rows.map((r) => r.customer.split(" ")[0]);

describe("column chart: one column per category, in the brief's order", () => {
  it("the five categories with their counts and signed values", () => {
    expect(view.categories.map((c) => [c.label, c.countText, c.valueText, c.tone])).toEqual([
      ["New deals", "4 deals", "+$630K", "up"],
      ["Slipped out of Q4", "3 deals", "−$740K", "down"],
      ["Closed Lost", "2 deals", "−$460K", "down"],
      ["Stage moves", "6 deals", "+$560K", "up"],
      ["Amount changes", "4 deals", "+$460K", "up"],
    ]);
  });

  it("net change is the sum of the columns: +$450K", () => {
    expect(view.categories.reduce((sum, c) => sum + c.valueCents, 0)).toBe(45_000_000);
    expect([view.net, view.netTone]).toEqual(["+$450K", "up"]);
  });

  it("opens on the first category that has deals", () => {
    expect(view.defaultKey).toBe("New Deals");
  });

  it("the chart in words, for screen readers; the stage-based note", () => {
    expect(view.summary).toBe(
      "New deals +$630K (4 deals); Slipped out of Q4 −$740K (3 deals); Closed Lost −$460K (2 deals); "
      + "Stage moves +$560K (6 deals); Amount changes +$460K (4 deals). Net change +$450K.",
    );
    expect(view.note).toBe("Values use stage probability, so Top deals here won't match their VP-scored forecast.");
  });

  it("an Other changes column only when Pulled into Q4, Quarter changed or Missing add up to non-zero", () => {
    const pulled = {
      ...weekOverWeek.changes["New Deals"][0], category: "Pulled into Q4", before: "Q1-2027", after: "Q4-2026", ev_change: 75_000,
    };
    const wow: WeekOverWeekFile = { ...weekOverWeek, changes: { ...weekOverWeek.changes, "Pulled into Q4": [pulled] } };
    const other = whatChangedView(wow).categories.at(-1)!;
    expect([other.label, other.countText, other.valueText]).toEqual(["Other changes", "1 deal", "+$75K"]);
    expect(other.rows[0].category).toBe("Pulled into Q4");
  });
});

describe("the list under the chart: one category's deals", () => {
  it("largest change first, either way", () => {
    expect(firstWords("Stage moves")).toEqual(["Solaris", "Borealis", "Zephyr", "Mirage", "Caledonia", "Alabaster"]);
    expect(firstWords("Slipped out of Q4")).toEqual(["Timberline", "Fjordland", "Greystone"]);
  });

  it("what changed, in one line per deal", () => {
    const [nebula] = category("New deals").rows;
    expect([nebula.customer, nebula.before, nebula.after, nebula.change, nebula.tone]).toEqual([
      "Nebula Health Alliance", null, "New · Business Approval · $600K", "+$360K", "up",
    ]);
    const [solaris] = category("Stage moves").rows;
    expect([solaris.before, solaris.after, solaris.change]).toEqual(["Business Approval", "Contract Negotiations", "+$520K"]);
    const caledonia = category("Amount changes").rows.find((r) => r.customer.startsWith("Caledonia"))!;
    expect([caledonia.before, caledonia.after, caledonia.change]).toEqual(["Annual value $400K", "$550K", "+$120K"]);
    const [timberline] = category("Slipped out of Q4").rows;
    expect([timberline.before, timberline.after, timberline.change, timberline.tone]).toEqual(["Q4-2026", "Q1-2027", "−$450K", "down"]);
  });

  it("Couldn't compare is listed only when it isn't empty", () => {
    expect(view.couldntCompare).toEqual([]);
    const wow: WeekOverWeekFile = {
      ...weekOverWeek,
      couldnt_compare: [{
        deal_id: "X", customer: "Example Health", product: "PulseOR", sales_rep: "A Rep", week: "this week",
        reason: "Row set aside this week (needs review); see the audit log",
      }],
    };
    const [row] = whatChangedView(wow).couldntCompare;
    expect([row.customer, row.after, row.change]).toEqual(["Example Health", "Row set aside this week (needs review); see the audit log", "—"]);
  });
});

describe("one deal's changes, for the detail panel", () => {
  it("Caledonia: stage move and amount change", () => {
    expect(dealChanges(weekOverWeek, "006PF000001L008YAC").map((r) => [r.category, r.change])).toEqual([
      ["Stage moves", "+$80K"],
      ["Amount changes", "+$120K"],
    ]);
  });

  it("a Salesforce copy of a HubSpot deal: $0, already counted (not a chart column)", () => {
    expect(view.categories.map((c) => c.label)).not.toContain("Copied from HubSpot (not new)");
    expect(dealChanges(weekOverWeek, "006PF000001M001YAC").map((r) => [r.category, r.change])).toEqual([
      ["Copied from HubSpot (not new)", "$0 · already counted"],
    ]);
  });

  it("a deal with no change has none", () => {
    expect(dealChanges(weekOverWeek, "006PF000001L020YAC")).toEqual([]);
  });
});
