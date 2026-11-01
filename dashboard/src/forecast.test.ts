import { describe, expect, it } from "vitest";

import { forecast } from "./data";
import {
  BASELINE,
  computeDeal,
  computeTotals,
  gpaX100,
  isChanged,
  reset,
  setScore,
  setVpOverride,
  winProbability,
  type Scenario,
} from "./forecast";
import type { ForecastFile } from "./types";

const cents = (dollars: number) => Math.round(dollars * 100);
const STARLIGHT = "006PF000001T007YAC";
const IRONWOOD = "006PF000001T005YAC";
const settings = forecast.settings;

function deal(id: string) {
  const found = forecast.deals.find((d) => d.deal_id === id);
  if (!found) throw new Error(id);
  return found;
}

// --- D3: parity with the pipeline (forecast.py), in cents ------------------------

describe("baseline matches the pipeline's totals exactly, in cents", () => {
  it.each([
    ["formula", BASELINE, forecast.totals.formula],
    ["VP override", { edits: {}, vpOverride: true }, forecast.totals.vp_override],
  ] as const)("%s totals", (_, scenario, pipeline) => {
    const t = computeTotals(forecast, scenario);
    expect(t.top).toBe(cents(pipeline.top));
    expect(t.coreLongtail).toBe(cents(pipeline.core_longtail));
    expect(t.carebridgeLongtail).toBe(cents(pipeline.carebridge_longtail));
    expect(t.otherLongtail).toBe(cents(pipeline.other_longtail));
    expect(t.longtail).toBe(cents(pipeline.longtail));
    expect(t.total).toBe(cents(pipeline.total));
    expect(t.target).toBe(cents(pipeline.target));
    expect(t.variance).toBe(cents(pipeline.variance));
    expect(t.percentOfTarget).toBe(pipeline.percent_of_target);
    expect(t.pastDueExposure).toBe(cents(pipeline.past_due_exposure));
    expect([t.topCount, t.coreCount, t.carebridgeCount, t.otherCount]).toEqual([
      pipeline.top_count, pipeline.core_count, pipeline.carebridge_count, pipeline.other_count,
    ]);
  });

  it("every deal's expected value matches", () => {
    const vpOn: Scenario = { edits: {}, vpOverride: true };
    for (const d of forecast.deals.filter((d) => d.bucket !== null)) {
      expect(computeDeal(d, BASELINE, settings).evCents, d.deal_id).toBe(cents(d.expected_value));
      const vpExpected = d.bucket === "Top" ? d.vp_expected_value! : d.expected_value;
      expect(computeDeal(d, vpOn, settings).evCents, d.deal_id).toBe(cents(vpExpected));
    }
  });

  it("baseline total is $13,182,400", () => {
    expect(computeTotals(forecast, BASELINE).total).toBe(cents(13_182_400));
  });
});

describe("GPA math reads its settings from forecast.json", () => {
  it("integer GPA: 20L + 20C + 60K", () => {
    expect(gpaX100({ leadership: 4, commercial: 4, contractual: 3 }, settings.gpa_weights)).toBe(340);
  });

  it.each([
    [400, 0.75], [320, 0.75], [300, 0.5], [240, 0.5], [220, 0.3], [160, 0.3], [140, 0.1], [100, 0.1],
  ])("win probability at GPA x100 %d is %d", (x100, probability) => {
    expect(winProbability(x100, settings.win_probability_cutoffs)).toBe(probability);
  });

  it("different weights in settings change the GPA (nothing hard-coded)", () => {
    const other = { leadership: 40, commercial: 40, contractual: 20 };
    expect(gpaX100({ leadership: 4, commercial: 4, contractual: 3 }, other)).toBe(380);
  });

  it("the target comes from meta.board_target", () => {
    const higher: ForecastFile = { ...forecast, meta: { ...forecast.meta, board_target: 15_000_000 } };
    const t = computeTotals(higher, BASELINE);
    expect(t.variance).toBe(cents(13_182_400 - 15_000_000));
    expect(t.percentOfTarget).toBe(87.9);
  });
});

// --- D4: what-if changes ----------------------------------------------------------

describe("what-if", () => {
  it("Starlight Contractual 2 -> 3: $600,000; total $13,422,400", () => {
    const scenario = setScore(BASELINE, deal(STARLIGHT), "contractual", 3);
    const starlight = computeDeal(deal(STARLIGHT), scenario, settings);
    expect(starlight.gpaX100).toBe(260);
    expect(starlight.probability).toBe(0.5);
    expect(starlight.evCents).toBe(cents(600_000));
    expect(starlight.edited).toBe(true);
    expect(computeTotals(forecast, scenario).total).toBe(cents(13_422_400));
  });

  it("VP override on: $13,732,400", () => {
    const scenario = setVpOverride(BASELINE, true);
    expect(computeTotals(forecast, scenario).total).toBe(cents(13_732_400));
    expect(computeDeal(deal(IRONWOOD), scenario, settings).vpOverride).toBe("applied");
  });

  it("Starlight edit and VP override together: $13,972,400", () => {
    const scenario = setVpOverride(setScore(BASELINE, deal(STARLIGHT), "contractual", 3), true);
    expect(computeTotals(forecast, scenario).total).toBe(cents(13_972_400));
  });

  it("Reset returns $13,182,400", () => {
    const changed = setVpOverride(setScore(BASELINE, deal(STARLIGHT), "contractual", 3), true);
    expect(isChanged(changed)).toBe(true);
    const back = reset();
    expect(isChanged(back)).toBe(false);
    expect(computeTotals(forecast, back).total).toBe(cents(13_182_400));
  });

  it("edited scores win over the VP override", () => {
    // Ironwood 4/2/2 (50%, sheet says 75%). Raise Contractual to 3: 4/2/3 = 300 -> still 50%.
    const scenario = setVpOverride(setScore(BASELINE, deal(IRONWOOD), "contractual", 3), true);
    const ironwood = computeDeal(deal(IRONWOOD), scenario, settings);
    expect(ironwood.vpOverride).toBe("not_applied_edited");
    expect(ironwood.probability).toBe(0.5);
    expect(ironwood.evCents).toBe(cents(1_100_000));
  });

  it("setting a score back to its original clears the edit", () => {
    const edited = setScore(BASELINE, deal(STARLIGHT), "contractual", 3);
    const back = setScore(edited, deal(STARLIGHT), "contractual", 2);
    expect(computeDeal(deal(STARLIGHT), back, settings).edited).toBe(false);
    expect(isChanged(back)).toBe(false);
  });

  it("Longtail deals use their stage probability and aren't editable", () => {
    const northClinic = computeDeal(deal("006PF000001L020YAC"), BASELINE, settings);
    expect(northClinic.bucket).toBe("Longtail");
    expect(northClinic.scores).toBeNull();
    expect(northClinic.probability).toBe(0.8);
    expect(northClinic.evCents).toBe(cents(240_000));
  });

  it("past-due exposure follows edits", () => {
    // None of the past-due deals are Top deals, so a Top edit leaves it unchanged.
    const scenario = setScore(BASELINE, deal(STARLIGHT), "contractual", 3);
    expect(computeTotals(forecast, scenario).pastDueExposure).toBe(cents(812_000));
  });
});
