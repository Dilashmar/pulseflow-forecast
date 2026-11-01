// The one dashboard test that reads the live output/ folder, so it runs against
// whatever week was last processed: forecast.ts must give the pipeline's totals,
// to the cent, on any week's data. Every other test uses test-fixtures/output.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BASELINE, computeDeal, computeTotals, type Scenario } from "./forecast";
import type { ForecastFile } from "./types";

const live = JSON.parse(
  readFileSync(new URL("../../output/forecast.json", import.meta.url), "utf8"),
) as ForecastFile;
const cents = (dollars: number) => Math.round(dollars * 100);
const VP_ON: Scenario = { edits: {}, vpOverride: true };

describe(`live output (data as of ${live.meta.as_of}): forecast.ts matches the pipeline`, () => {
  it.each([
    ["formula", BASELINE, live.totals.formula],
    ["VP override", VP_ON, live.totals.vp_override],
  ] as const)("%s totals", (_, scenario, pipeline) => {
    const t = computeTotals(live, scenario);
    expect([t.top, t.longtail, t.total, t.pastDueExposure]).toEqual([
      cents(pipeline.top), cents(pipeline.longtail), cents(pipeline.total), cents(pipeline.past_due_exposure),
    ]);
    expect([t.topCount, t.coreCount, t.carebridgeCount, t.otherCount]).toEqual([
      pipeline.top_count, pipeline.core_count, pipeline.carebridge_count, pipeline.other_count,
    ]);
  });

  it("every deal's expected value", () => {
    for (const d of live.deals) {
      expect(computeDeal(d, BASELINE, live.settings).evCents, d.deal_id).toBe(cents(d.expected_value));
    }
  });
});
