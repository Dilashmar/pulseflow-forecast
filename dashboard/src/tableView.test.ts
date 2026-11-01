import { describe, expect, it } from "vitest";

import { forecast } from "./data";
import { dealRoomRows } from "./dealRoomRows";
import { NO_FILTERS, filterOptions, summary, visibleRows, type Filters } from "./tableView";
import { BASELINE, setScore } from "./forecast";

const rows = dealRoomRows(forecast, BASELINE);
const ids = (list: { dealId: string }[]) => list.map((r) => r.dealId);
const show = (filters: Partial<Filters> = {}, search = "", sort = null as Parameters<typeof visibleRows>[3]) =>
  visibleRows(rows, { ...NO_FILTERS, ...filters }, search, sort);

describe("filters", () => {
  it("no filters: all 38 deals in pipeline order", () => {
    expect(ids(show())).toEqual(ids(rows));
    expect(show()).toHaveLength(38);
  });

  it("bucket Top -> 8", () => {
    expect(show({ buckets: ["Top"] })).toHaveLength(8);
  });

  it("flag Past due -> 4", () => {
    expect(ids(show({ flags: ["past_due"] })).sort()).toEqual([
      "006PF000001L001YAC", "006PF000001L002YAC", "006PF000001L003YAC", "HS-9004",
    ]);
  });

  it("within a group any ticked option counts; across groups all must pass", () => {
    const pulseOr = show({ products: ["PulseOR"] });
    const bedFlow = show({ products: ["BedFlow"] });
    expect(show({ products: ["PulseOR", "BedFlow"] })).toHaveLength(pulseOr.length + bedFlow.length);
    const clara = show({ products: ["PulseOR", "BedFlow"], rep: "Clara Oswald" });
    expect(clara.length).toBeGreaterThan(0);
    expect(clara.every((r) => r.salesRep === "Clara Oswald" && ["PulseOR", "BedFlow"].includes(r.product))).toBe(true);
  });

  it("Edited flag follows the scenario", () => {
    const starlight = forecast.deals.find((d) => d.deal_id === "006PF000001T007YAC")!;
    const edited = dealRoomRows(forecast, setScore(BASELINE, starlight, "contractual", 3));
    expect(ids(visibleRows(edited, { ...NO_FILTERS, flags: ["edited"] }, "", null))).toEqual(["006PF000001T007YAC"]);
  });

  it("filter options come from the data", () => {
    const options = filterOptions(rows);
    expect(options.products).toEqual(["BedFlow", "CareBridge", "InfusionIQ", "PulseOR"]);
    expect(options.reps).toContain("Clara Oswald");
    expect(options.reps).toContain("Dax Shepherdson");
  });
});

describe("search", () => {
  it("matches customer, case-insensitive", () => {
    expect(ids(show({}, "borealis")).sort()).toEqual(["006PF000001L020YAC", "006PF000001T006YAC", "HS-9006"]);
  });

  it("matches a deal ID", () => {
    expect(ids(show({}, "hs-9006"))).toEqual(["HS-9006"]);
  });

  it("matches rep, product and stage", () => {
    expect(show({}, "nora valkyrie").length).toBeGreaterThan(0);
    expect(show({}, "carebridge")).toHaveLength(10);
    expect(show({}, "contract negotiations").every((r) => r.stage === "Contract Negotiations")).toBe(true);
  });
});

describe("sort", () => {
  it("by expected value, high to low", () => {
    const sorted = show({}, "", { key: "expectedValue", direction: "desc" });
    expect(sorted[0].dealId).toBe("006PF000001T002YAC"); // Solaris $2.25M
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1].evCents).toBeGreaterThanOrEqual(sorted[i].evCents);
  });

  it("by customer, A to Z", () => {
    const sorted = show({}, "", { key: "customer", direction: "asc" });
    const names = sorted.map((r) => r.customer);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("GPA: Longtail deals (no GPA) go last either way", () => {
    for (const direction of ["asc", "desc"] as const) {
      const sorted = show({}, "", { key: "gpa", direction });
      expect(sorted.slice(0, 8).every((r) => r.isTop)).toBe(true);
    }
  });
});

describe("record count and subtotal", () => {
  it("bucket Top: 8 of 38, $7.84M", () => {
    expect(summary(show({ buckets: ["Top"] }), rows.length)).toBe("Showing 8 of 38 deals · $7.84M expected value");
  });

  it("subtotal follows edits: Starlight 2 -> 3 makes Top $8.08M", () => {
    const starlight = forecast.deals.find((d) => d.deal_id === "006PF000001T007YAC")!;
    const edited = dealRoomRows(forecast, setScore(BASELINE, starlight, "contractual", 3));
    const top = visibleRows(edited, { ...NO_FILTERS, buckets: ["Top"] }, "", null);
    expect(summary(top, edited.length)).toBe("Showing 8 of 38 deals · $8.08M expected value");
  });

  it("all deals: the full $13.18M", () => {
    expect(summary(show(), rows.length)).toBe("Showing 38 of 38 deals · $13.18M expected value");
  });
});
