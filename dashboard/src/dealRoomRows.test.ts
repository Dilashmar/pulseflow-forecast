import { describe, expect, it } from "vitest";

import { forecast } from "./data";
import { dealRoomRows } from "./dealRoomRows";
import { BASELINE, setScore, setVpOverride } from "./forecast";

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
});
