import { describe, expect, it } from "vitest";

import { bannerView } from "./bannerView";
import { forecast } from "./data";
import { BASELINE, promote, setScore, setVpOverride } from "./forecast";

describe("banner, baseline (numbers recomputed from forecast.json's deals)", () => {
  const view = bannerView(forecast, BASELINE);

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
    expect(view.vpOverrideOn).toBe(false);
    expect(view.vpOverride).toBe("Formula (default) · applying adds +$550K");
  });
});

describe("banner follows what-if changes", () => {
  const starlight = forecast.deals.find((d) => d.deal_id === "006PF000001T007YAC")!;

  it("Starlight Contractual 2 -> 3", () => {
    const view = bannerView(forecast, setScore(BASELINE, starlight, "contractual", 3));
    expect(view.total).toBe("$13.42M");
    expect(view.tiles[0].value).toBe("$8.08M");
  });

  it("VP override on", () => {
    const view = bannerView(forecast, setVpOverride(BASELINE, true));
    expect(view.total).toBe("$13.73M");
    expect(view.vpOverrideOn).toBe(true);
    expect(view.vpOverride).toBe("VP override applied · +$550K");
  });

  it("below target is shown as short", () => {
    // Drop every Top deal to 1/1/1 (10%): Top = $1.57M, total = $6,912,400.
    let scenario = BASELINE;
    for (const d of forecast.deals.filter((d) => d.bucket === "Top")) {
      scenario = setScore(scenario, d, "leadership", 1);
      scenario = setScore(scenario, d, "commercial", 1);
      scenario = setScore(scenario, d, "contractual", 1);
    }
    const view = bannerView(forecast, scenario);
    expect(view.total).toBe("$6.91M");
    expect(view.variance).toBe("−$5.09M");
    expect(view.percentOfTarget).toBe("57.6% of target");
    expect(view.onTarget).toBe(false);
  });
});

describe("more-than-8 warning, under the tiles", () => {
  const kestrel = forecast.deals.find((d) => d.deal_id === "006PF000001L013YAC")!;

  it("none at baseline", () => {
    expect(bannerView(forecast, BASELINE).topWarning).toBeNull();
  });

  it("shown with 9 Top deals; tiles follow", () => {
    const view = bannerView(forecast, promote(BASELINE, kestrel, forecast.settings));
    expect(view.topWarning).toBe("9 Top deals: more than the usual 8. Allowed for what-if; review before presenting.");
    expect(view.tiles[0]).toEqual({ label: "Top deals", value: "$8.09M", count: "9 deals" });
    expect(view.tiles[1]).toEqual({ label: "Core Longtail", value: "$4.05M", count: "19 deals" });
    expect(view.total).toBe("$13.13M");
  });
});
