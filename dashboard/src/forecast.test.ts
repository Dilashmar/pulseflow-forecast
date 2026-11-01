import { describe, expect, it } from "vitest";

import { forecast } from "./data";
import {
  BASELINE,
  computeDeal,
  demote,
  computeTotals,
  gpaX100,
  isChanged,
  overTopLimit,
  promote,
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

  it("past-due exposure follows edits (unchanged here)", () => {
    // None of the past-due deals are Top deals, so a Top edit leaves it unchanged.
    const scenario = setScore(BASELINE, deal(STARLIGHT), "contractual", 3);
    expect(computeTotals(forecast, scenario).pastDueExposure).toBe(cents(812_000));
  });
});

// --- D5: promote and demote -------------------------------------------------------

describe("promote and demote", () => {
  const KESTREL = "006PF000001L013YAC"; // Longtail BedFlow, $500K, Business Approval 60% -> $300K
  const HALCYON = "006PF000001T008YAC"; // Top, $2.0M, 1.20 -> 10% = $200K; stage Introduction 20%

  it("promote Kestrel: starts at 3/3/3, GPA 3.00, 50% = $250K; total $13,132,400", () => {
    const scenario = promote(BASELINE, deal(KESTREL), settings);
    const kestrel = computeDeal(deal(KESTREL), scenario, settings);
    expect(kestrel.bucket).toBe("Top");
    expect(kestrel.moved).toBe("promoted");
    expect(kestrel.scores).toEqual({ leadership: 3, commercial: 3, contractual: 3 });
    expect(kestrel.gpaX100).toBe(300);
    expect(kestrel.probability).toBe(0.5);
    expect(kestrel.evCents).toBe(cents(250_000));
    expect(kestrel.edited).toBe(false);
    const t = computeTotals(forecast, scenario);
    expect(t.top).toBe(cents(8_090_000));
    expect(t.coreLongtail).toBe(cents(4_050_000));
    expect(t.total).toBe(cents(13_132_400));
    expect(t.topCount).toBe(9);
    expect(isChanged(scenario)).toBe(true);
  });

  it("promote starts from settings.promote_scores, not hard-coded 3/3/3", () => {
    const other = { ...settings, promote_scores: { leadership: 4, commercial: 4, contractual: 4 } };
    const scenario = promote(BASELINE, deal(KESTREL), other);
    expect(computeDeal(deal(KESTREL), scenario, other).probability).toBe(0.75);
  });

  it("promote a HubSpot deal: HS-9006 $210K at 50% = $105K; CareBridge tile down $168K", () => {
    const scenario = promote(BASELINE, deal("HS-9006"), settings);
    expect(computeDeal(deal("HS-9006"), scenario, settings).evCents).toBe(cents(105_000));
    const t = computeTotals(forecast, scenario);
    expect(t.carebridgeLongtail).toBe(cents(992_400 - 168_000));
    expect(t.carebridgeCount).toBe(9);
    expect(t.top).toBe(cents(7_840_000 + 105_000));
  });

  it("change a promoted deal's score: Kestrel C -> 4 = 3.20 -> 75%, $375K, edited", () => {
    const scenario = setScore(promote(BASELINE, deal(KESTREL), settings), deal(KESTREL), "commercial", 4);
    const kestrel = computeDeal(deal(KESTREL), scenario, settings);
    expect(kestrel.gpaX100).toBe(320);
    expect(kestrel.probability).toBe(0.75);
    expect(kestrel.evCents).toBe(cents(375_000));
    expect(kestrel.edited).toBe(true);
  });

  it("demote Halcyon: back to its 20% stage probability = $400K; total $13,382,400", () => {
    const scenario = demote(BASELINE, deal(HALCYON));
    const halcyon = computeDeal(deal(HALCYON), scenario, settings);
    expect(halcyon.bucket).toBe("Longtail");
    expect(halcyon.moved).toBe("demoted");
    expect(halcyon.scores).toBeNull();
    expect(halcyon.probability).toBe(0.2);
    expect(halcyon.evCents).toBe(cents(400_000));
    const t = computeTotals(forecast, scenario);
    expect(t.total).toBe(cents(13_382_400));
    expect(t.topCount).toBe(7);
    expect(t.coreLongtail).toBe(cents(4_750_000));
  });

  it("demote Ironwood with VP override on: the override no longer applies ($13,842,400)", () => {
    const scenario = demote(setVpOverride(BASELINE, true), deal(IRONWOOD));
    expect(computeDeal(deal(IRONWOOD), scenario, settings).vpOverride).toBe("none");
    expect(computeTotals(forecast, scenario).total).toBe(cents(13_842_400));
  });

  it("demoting drops score edits; promoting back restores the pipeline scores, not 3/3/3", () => {
    const edited = setScore(BASELINE, deal(STARLIGHT), "contractual", 3);
    const back = promote(demote(edited, deal(STARLIGHT)), deal(STARLIGHT), settings);
    const starlight = computeDeal(deal(STARLIGHT), back, settings);
    expect(starlight.scores).toEqual({ leadership: 2, commercial: 2, contractual: 2 });
    expect(starlight.moved).toBeNull();
    expect(isChanged(back)).toBe(false);
    expect(computeTotals(forecast, back).total).toBe(cents(13_182_400));
  });

  it("promote then demote undoes the promotion", () => {
    const back = demote(promote(BASELINE, deal(KESTREL), settings), deal(KESTREL));
    expect(computeDeal(deal(KESTREL), back, settings).moved).toBeNull();
    expect(isChanged(back)).toBe(false);
  });

  it("Reset undoes promotions and demotions: $13,182,400, 8 Top deals", () => {
    let scenario = promote(BASELINE, deal(KESTREL), settings);
    scenario = promote(scenario, deal("HS-9006"), settings);
    scenario = demote(scenario, deal(HALCYON));
    expect(isChanged(scenario)).toBe(true);
    const t = computeTotals(forecast, reset());
    expect(t.total).toBe(cents(13_182_400));
    expect(t.topCount).toBe(8);
    expect(isChanged(reset())).toBe(false);
  });

  it("more than the Top deal limit (from settings) shows a warning", () => {
    expect(overTopLimit(computeTotals(forecast, BASELINE), settings)).toBe(false);
    const nine = promote(BASELINE, deal(KESTREL), settings);
    expect(overTopLimit(computeTotals(forecast, nine), settings)).toBe(true);
    expect(overTopLimit(computeTotals(forecast, nine), { ...settings, top_deal_limit: 10 })).toBe(false);
  });
});
