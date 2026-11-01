import { describe, expect, it } from "vitest";

import { forecast } from "./data";
import { dealRoomRows } from "./dealRoomRows";
import { NO_FILTERS, changeCount, dealSections, filterOptions, resetLabel, visibleRows, type Filters } from "./tableView";
import { BASELINE, promote, setScore, setVpOverride } from "./forecast";

const rows = dealRoomRows(forecast, BASELINE);
const ids = (list: { dealId: string }[]) => list.map((r) => r.dealId);
const show = (filters: Partial<Filters> = {}, search = "") => visibleRows(rows, { ...NO_FILTERS, ...filters }, search);
const deal = (id: string) => forecast.deals.find((d) => d.deal_id === id)!;
const STARLIGHT = "006PF000001T007YAC";
const KESTREL = "006PF000001L013YAC";

describe("filters: product and rep (the brief's two)", () => {
  it("no filters: all 38 deals", () => {
    expect(show()).toHaveLength(38);
  });

  it("one product", () => {
    const bedFlow = show({ product: "BedFlow" });
    expect(bedFlow.length).toBeGreaterThan(0);
    expect(bedFlow.every((r) => r.product === "BedFlow")).toBe(true);
    expect(show({ product: "CareBridge" })).toHaveLength(10);
  });

  it("product and rep together: both must match", () => {
    const clara = show({ product: "PulseOR", rep: "Clara Oswald" });
    expect(clara.length).toBeGreaterThan(0);
    expect(clara.every((r) => r.salesRep === "Clara Oswald" && r.product === "PulseOR")).toBe(true);
  });

  it("filter options come from the data", () => {
    const options = filterOptions(rows);
    expect(options.products).toEqual(["BedFlow", "CareBridge", "InfusionIQ", "PulseOR"]);
    expect(options.reps).toContain("Clara Oswald");
    expect(options.reps).toContain("Dax Shepherdson");
  });
});

describe("search", () => {
  it("matches the full customer name, case-insensitive (including AKA / FKA names)", () => {
    expect(ids(show({}, "borealis")).sort()).toEqual(["006PF000001L020YAC", "006PF000001T006YAC", "HS-9006"]);
    expect(ids(show({}, "aethelgard regional"))).toEqual(["006PF000001T001YAC"]);
  });

  it("matches a deal ID, rep, product or stage", () => {
    expect(ids(show({}, "hs-9006"))).toEqual(["HS-9006"]);
    expect(show({}, "nora valkyrie").length).toBeGreaterThan(0);
    expect(show({}, "carebridge")).toHaveLength(10);
  });

  it("works with the filters", () => {
    expect(ids(show({ rep: "Clara Oswald" }, "borealis"))).toEqual(["006PF000001T006YAC"]);
  });
});

describe("two sections: Top 8 strategic deals, then Forecasted Longtail", () => {
  it("Top 8 in VP rank order; Longtail by expected value, largest first", () => {
    const [top, longtail] = dealSections(rows);
    expect([top.title, top.rows.length, top.total]).toEqual(["Top 8 strategic deals", 8, "$7.84M"]);
    expect(top.rows[0].customer).toMatch(/^Aethelgard Health System/);
    expect([longtail.title, longtail.rows.length, longtail.total]).toEqual(["Forecasted Longtail", 30, "$5.34M"]);
    expect(longtail.rows.slice(0, 2).map((r) => r.customer)).toEqual(["Caledonia General Health", "Polaris Community Hospitals"]);
    for (let i = 1; i < longtail.rows.length; i++) {
      expect(longtail.rows[i - 1].evCents).toBeGreaterThanOrEqual(longtail.rows[i].evCents);
    }
  });

  it("sections and their totals follow the filters", () => {
    const [top, longtail] = dealSections(show({ rep: "Clara Oswald" }));
    expect(top.rows.map((r) => r.customer)).toEqual([
      "Solaris Medical System (FKA Solaris Health Group)", "Borealis Health Alliance - Main Campus",
    ]);
    expect(top.total).toBe("$2.73M"); // $2.25M + $480K
    expect(longtail.rows.every((r) => r.salesRep === "Clara Oswald")).toBe(true);
  });

  it("a promoted deal moves into the Top 8 section; totals follow", () => {
    const moved = dealRoomRows(forecast, promote(BASELINE, deal(KESTREL), forecast.settings));
    const [top, longtail] = dealSections(moved);
    expect(top.rows.map((r) => r.dealId)).toContain(KESTREL);
    expect(longtail.rows.map((r) => r.dealId)).not.toContain(KESTREL);
    expect([top.rows.length, top.total, longtail.rows.length]).toEqual([9, "$8.09M", 29]);
  });
});

describe("Reset to baseline: shown only after a change, with a count", () => {
  it("counts edited and moved deals, and the VP override switch", () => {
    expect(changeCount(rows, BASELINE)).toBe(0);
    let scenario = setScore(BASELINE, deal(STARLIGHT), "contractual", 3);
    expect(changeCount(dealRoomRows(forecast, scenario), scenario)).toBe(1);
    scenario = promote(scenario, deal(KESTREL), forecast.settings);
    expect(changeCount(dealRoomRows(forecast, scenario), scenario)).toBe(2);
    scenario = setVpOverride(scenario, true);
    expect(changeCount(dealRoomRows(forecast, scenario), scenario)).toBe(3);
  });

  it("label", () => {
    expect(resetLabel(1)).toBe("Reset to baseline (1 change)");
    expect(resetLabel(3)).toBe("Reset to baseline (3 changes)");
  });
});
