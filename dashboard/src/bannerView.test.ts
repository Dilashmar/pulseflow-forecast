import { describe, expect, it } from "vitest";

import { bannerView } from "./bannerView";
import { forecast } from "./data";
import type { ForecastFile } from "./types";

describe("banner reads every number from forecast.json", () => {
  const view = bannerView(forecast);

  it("header", () => {
    expect(view.title).toBe("PulseFlow Q4-2026 Forecast");
    expect(view.asOf).toBe("Data as of 2026-10-15");
  });

  it("progress bar", () => {
    expect(view.total).toBe("$13.18M");
    expect(view.target).toBe("$12.00M");
    expect(view.variance).toBe("+$1.18M");
    expect(view.percentOfTarget).toBe("109.9% of target");
    expect(view.onTarget).toBe(true);
  });

  it("bar segments add up to the total and the marker sits at the target", () => {
    expect(view.segments.map((s) => [s.label, s.value])).toEqual([
      ["Top deals", "$7.84M"],
      ["Core Longtail", "$4.35M"],
      ["CareBridge Longtail", "$992K"],
    ]);
    const filled = view.segments.reduce((sum, s) => sum + s.widthPercent, 0);
    expect(filled / view.targetMarkerPercent).toBeCloseTo(13_182_400 / 12_000_000, 10);
  });

  it("tiles", () => {
    expect(view.tiles).toEqual([
      { label: "Top deals", value: "$7.84M", count: "8 deals" },
      { label: "Core Longtail", value: "$4.35M", count: "20 deals" },
      { label: "CareBridge Longtail", value: "$992K", count: "10 deals" },
    ]);
  });

  it("warnings line", () => {
    expect(view.pastDue).toBe("Past-due exposure: $812K on 4 deals");
    expect(view.vpOverride).toBe("VP override: Formula (default) · applying it adds +$550K");
  });

  it("variance below target is shown as short", () => {
    const short: ForecastFile = {
      ...forecast,
      totals: {
        ...forecast.totals,
        formula: { ...forecast.totals.formula, total: 11_500_000, variance: -500_000, percent_of_target: 95.8 },
      },
    };
    const shortView = bannerView(short);
    expect(shortView.variance).toBe("−$500K");
    expect(shortView.percentOfTarget).toBe("95.8% of target");
    expect(shortView.onTarget).toBe(false);
  });
});
