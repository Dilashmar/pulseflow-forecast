import { describe, expect, it } from "vitest";

import { audit, forecast, weekOverWeek } from "./data";
import { dealDetail } from "./dealDetail";
import { dealRoomRows } from "./dealRoomRows";
import { BASELINE, demote, promote, setScore, setVpOverride } from "./forecast";

const row = (rows: ReturnType<typeof dealRoomRows>, id: string) => rows.find((r) => r.dealId === id)!;

describe("Deal Room rows", () => {
  const rows = dealRoomRows(forecast, BASELINE);

  it("all forecast deals, Top first in VP rank order, then Longtail", () => {
    expect(rows).toHaveLength(38);
    expect(rows.slice(0, 8).every((r) => r.isTop)).toBe(true);
    expect(rows.slice(8).every((r) => !r.isTop)).toBe(true);
    expect(rows[0].customer).toMatch(/^Aethelgard Health System/);
  });

  it("display values", () => {
    const ironwood = row(rows, "006PF000001T005YAC");
    expect(ironwood.annualAcv).toBe("$2.20M");
    expect(ironwood.gpa).toBe("2.40");
    expect(ironwood.probability).toBe("50%");
    expect(ironwood.expectedValue).toBe("$1.10M");
    expect(ironwood.vpNotes).toMatch(/^COO verbally committed/);
    const longtail = row(rows, "006PF000001L020YAC");
    expect(longtail.gpa).toBe("—");
    expect(longtail.scores).toBeNull();
  });

  it("flag chips", () => {
    expect(row(rows, "006PF000001L001YAC").chips.map((c) => c.label)).toEqual(["Past due"]);
    expect(row(rows, "HS-9001").chips.map((c) => c.label)).toEqual(["Merged duplicate"]);
    expect(row(rows, "006PF000001T005YAC").chips.map((c) => c.label)).toEqual(["VP override: 75%"]);
    expect(row(rows, "006PF000001T001YAC").chips).toEqual([]);
  });

  it("VP override chip follows the toggle and edits", () => {
    const on = dealRoomRows(forecast, setVpOverride(BASELINE, true));
    expect(row(on, "006PF000001T005YAC").chips.map((c) => c.label)).toEqual(["VP override applied: 75%"]);
    expect(row(on, "006PF000001T005YAC").probability).toBe("75%");

    const ironwood = forecast.deals.find((d) => d.deal_id === "006PF000001T005YAC")!;
    const edited = dealRoomRows(forecast, setVpOverride(setScore(BASELINE, ironwood, "contractual", 3), true));
    expect(row(edited, "006PF000001T005YAC").chips.map((c) => c.label)).toEqual([
      "VP override (not applied: scores edited)",
    ]);
  });

  it("edited rows are marked, and the order doesn't change", () => {
    const starlight = forecast.deals.find((d) => d.deal_id === "006PF000001T007YAC")!;
    const edited = dealRoomRows(forecast, setScore(BASELINE, starlight, "contractual", 3));
    expect(row(edited, "006PF000001T007YAC").edited).toBe(true);
    expect(row(edited, "006PF000001T007YAC").expectedValue).toBe("$600K");
    expect(edited.filter((r) => r.edited)).toHaveLength(1);
    expect(edited.map((r) => r.dealId)).toEqual(rows.map((r) => r.dealId));
  });

  it("table and detail panel show the same scores after an edit (kept in sync)", () => {
    const starlight = forecast.deals.find((d) => d.deal_id === "006PF000001T007YAC")!;
    const scenario = setScore(BASELINE, starlight, "contractual", 3);
    const tableScores = row(dealRoomRows(forecast, scenario), "006PF000001T007YAC").scores;
    const panelScores = dealDetail(starlight, scenario, forecast, audit, weekOverWeek).scores;
    expect(tableScores).toEqual({ leadership: 2, commercial: 2, contractual: 3 });
    expect(panelScores).toEqual(tableScores);
  });

  it("only Top deals have scores to edit", () => {
    expect(rows.filter((r) => r.scores !== null).map((r) => r.isTop)).toEqual(Array(8).fill(true));
  });
});

describe("promoted and demoted rows", () => {
  const kestrel = forecast.deals.find((d) => d.deal_id === "006PF000001L013YAC")!;
  const halcyon = forecast.deals.find((d) => d.deal_id === "006PF000001T008YAC")!;

  it("a promoted deal gets inline scores and a Promoted chip, and moves into the Top group", () => {
    const moved = dealRoomRows(forecast, promote(BASELINE, kestrel, forecast.settings));
    const k = row(moved, "006PF000001L013YAC");
    expect(k.isTop).toBe(true);
    expect(k.scores).toEqual({ leadership: 3, commercial: 3, contractual: 3 });
    expect(k.chips.map((c) => c.label)).toContain("Promoted");
    expect(k.flagKeys).toContain("edited");
    expect(moved.slice(0, 9).map((r) => r.isTop)).toEqual(Array(9).fill(true));
    expect(moved[8].dealId).toBe("006PF000001L013YAC"); // after the 8 ranked Top deals
  });

  it("a demoted deal loses its scores, gets a Moved to Longtail chip, and moves into Longtail", () => {
    const moved = dealRoomRows(forecast, demote(BASELINE, halcyon));
    const h = row(moved, "006PF000001T008YAC");
    expect(h.isTop).toBe(false);
    expect(h.scores).toBeNull();
    expect(h.chips.map((c) => c.label)).toContain("Moved to Longtail");
    expect(moved.slice(0, 7).every((r) => r.isTop)).toBe(true);
    expect(moved.slice(7).every((r) => !r.isTop)).toBe(true);
  });
});
