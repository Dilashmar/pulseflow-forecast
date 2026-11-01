// What the top banner shows (SPEC 6.1): four KPI cards, the brief's banner
// items, in Salesforce "Metric" style: total expected Q4 sales, variance to the
// board target, Top 8 strategic deals, and Forecasted Longtail split by Core
// Salesforce and Acquired CareBridge. Totals are recomputed from forecast.json's
// deals for the current what-if scenario, so the banner updates instantly.
// Past due and the VP override's $ difference live in the Deal Room and the
// audit tab, not here. Kept apart from the component so it can be tested.

import { computeTotals, overTopLimit, type Scenario } from "./forecast";
import { money, signedMoney } from "./format";
import type { ForecastFile } from "./types";

export interface Figure {
  label: string;
  value: string;
}

export interface BannerView {
  title: string;
  quarter: string;
  asOf: string;
  totalLabel: string;
  total: string;
  varianceLabel: string;
  variance: string; // signed: "+$1.18M" or "−$0.50M"
  varianceStatus: string; // the icon's meaning, for screen readers
  onTarget: boolean;
  top: Figure;
  longtail: Figure & { split: Figure[] };
  vpOverrideOn: boolean; // the switch in the Top 8 card
  topWarning: string | null; // more Top deals than the usual limit (SPEC 3.6)
}

const dollars = (cents: number) => cents / 100;

export function bannerView(forecast: ForecastFile, scenario: Scenario): BannerView {
  const totals = computeTotals(forecast, scenario);
  const onTarget = totals.variance >= 0;
  const quarter = forecast.meta.forecast_quarter;

  // A product outside the known lines is counted under "Other": listed only when present.
  const split: Figure[] = [
    { label: "Core Salesforce", value: money(dollars(totals.coreLongtail)) },
    { label: "Acquired CareBridge", value: money(dollars(totals.carebridgeLongtail)) },
  ];
  if (totals.otherCount > 0) {
    split.push({ label: forecast.settings.other_product_line, value: money(dollars(totals.otherLongtail)) });
  }

  return {
    title: "PulseFlow Forecast",
    quarter,
    asOf: forecast.meta.as_of,
    totalLabel: `Total expected ${quarter.split("-")[0]} sales`,
    total: money(dollars(totals.total)),
    varianceLabel: `Variance vs. ${money(dollars(totals.target))} board target`,
    variance: signedMoney(dollars(totals.variance)),
    varianceStatus: onTarget ? "Above target" : "Below target",
    onTarget,
    top: { label: "Top 8 strategic deals", value: money(dollars(totals.top)) },
    longtail: { label: "Forecasted Longtail", value: money(dollars(totals.longtail)), split },
    vpOverrideOn: scenario.vpOverride,
    topWarning: overTopLimit(totals, forecast.settings)
      ? `${totals.topCount} Top deals: more than the usual ${forecast.settings.top_deal_limit}.`
        + " Allowed for what-if; review before presenting."
      : null,
  };
}
