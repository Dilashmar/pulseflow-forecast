import { describe, expect, it } from "vitest";

import { bannerView } from "./bannerView";
import { forecast } from "./data";
import { BASELINE, promote, setScore, setVpOverride } from "./forecast";
import type { ForecastFile } from "./types";

describe("banner, baseline (numbers recomputed from forecast.json's deals)", () => {
  const view = bannerView(forecast, BASELINE);

  it("header: one line, title and the data's date", () => {
    expect([view.title, view.quarter, view.asOf]).toEqual(["PulseFlow Forecast", "Q4-2026", "2026-10-15"]);
  });

  it("four cards, the brief's four items", () => {
    expect([view.totalLabel, view.total]).toEqual(["Total expected Q4 sales", "$13.18M"]);
    expect([view.varianceLabel, view.variance, view.onTarget, view.varianceStatus]).toEqual([
      "Variance vs. $12.00M board target", "+$1.18M", true, "Above target",
    ]);
    expect(view.top).toEqual({ label: "Top 8 strategic deals", value: "$7.84M" });
    expect(view.longtail).toEqual({
      label: "Forecasted Longtail",
      value: "$5.34M",
      split: [{ label: "Core Salesforce", value: "$4.35M" }, { label: "Acquired CareBridge", value: "$992K" }],
    });
  });

  it("only the brief's items: no past-due line or VP status text", () => {
    expect(view).not.toHaveProperty("pastDue");
    expect(view).not.toHaveProperty("vpOverride");
    expect(view.vpOverrideOn).toBe(false); // the switch in the Top 8 card
  });
});

describe("banner follows what-if changes", () => {
  const starlight = forecast.deals.find((d) => d.deal_id === "006PF000001T007YAC")!;

  it("Starlight Contractual 2 -> 3", () => {
    const view = bannerView(forecast, setScore(BASELINE, starlight, "contractual", 3));
    expect([view.total, view.top.value, view.variance]).toEqual(["$13.42M", "$8.08M", "+$1.42M"]);
  });

  it("VP override on", () => {
    const view = bannerView(forecast, setVpOverride(BASELINE, true));
    expect([view.total, view.variance]).toEqual(["$13.73M", "+$1.73M"]);
    expect(view.top.value).toBe("$8.39M");
    expect(view.vpOverrideOn).toBe(true);
  });

  it("below target: a minus sign, and said in words for screen readers", () => {
    // Drop every Top deal to 1/1/1 (10%): Top = $1.57M, total = $6,912,400.
    let scenario = BASELINE;
    for (const d of forecast.deals.filter((d) => d.bucket === "Top")) {
      scenario = setScore(scenario, d, "leadership", 1);
      scenario = setScore(scenario, d, "commercial", 1);
      scenario = setScore(scenario, d, "contractual", 1);
    }
    const view = bannerView(forecast, scenario);
    expect([view.total, view.variance, view.onTarget, view.varianceStatus]).toEqual([
      "$6.91M", "−$5.09M", false, "Below target",
    ]);
  });

  it("a product outside the known lines adds an Other line to the Longtail card", () => {
    const deals = forecast.deals.map((d) => (d.deal_id === "006PF000001L020YAC" ? { ...d, product: "Telehealth" } : d));
    const view = bannerView({ ...forecast, deals } as ForecastFile, BASELINE);
    // Borealis North Surgery Clinic: $300K x 80% = $240K moves from Core to Other.
    expect(view.longtail.split).toEqual([
      { label: "Core Salesforce", value: "$4.11M" },
      { label: "Acquired CareBridge", value: "$992K" },
      { label: "Other", value: "$240K" },
    ]);
    expect(view.longtail.value).toBe("$5.34M");
  });
});

describe("more-than-8 warning", () => {
  const kestrel = forecast.deals.find((d) => d.deal_id === "006PF000001L013YAC")!;

  it("none at baseline", () => {
    expect(bannerView(forecast, BASELINE).topWarning).toBeNull();
  });

  it("shown with 9 Top deals; the cards follow", () => {
    const view = bannerView(forecast, promote(BASELINE, kestrel, forecast.settings));
    expect(view.topWarning).toBe("9 Top deals: more than the usual 8. Allowed for what-if; review before presenting.");
    expect([view.total, view.top.value, view.longtail.value]).toEqual(["$13.13M", "$8.09M", "$5.04M"]);
    expect(view.longtail.split[0]).toEqual({ label: "Core Salesforce", value: "$4.05M" });
  });
});
