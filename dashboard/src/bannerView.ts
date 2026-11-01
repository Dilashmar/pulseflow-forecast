// What the top banner shows (SPEC 6.1). Totals are recomputed from
// forecast.json's deals for the current what-if scenario, so the banner
// updates instantly. Kept apart from the component so it can be tested.

import { computeTotals, overTopLimit, setVpOverride, type Scenario } from "./forecast";
import { money, percent, signedMoney } from "./format";
import type { ForecastFile } from "./types";

export interface BarSegment {
  key: "top" | "core" | "carebridge" | "other";
  label: string;
  value: string;
  widthPercent: number; // share of the bar's full width
}

export interface Tile {
  label: string;
  value: string;
  count: string;
}

export interface BannerView {
  title: string;
  asOf: string;
  total: string;
  target: string;
  variance: string;
  percentOfTarget: string;
  onTarget: boolean;
  segments: BarSegment[];
  targetMarkerPercent: number;
  tiles: Tile[];
  longtail: Tile; // all Longtail deals (Core, CareBridge and any Other), shown above their tiles
  pastDue: string;
  vpOverrideOn: boolean;
  vpOverride: string;
  topWarning: string | null; // more Top deals than the usual limit (SPEC 3.6)
}

// Leave room past the larger of total and target so the marker never sits on the edge.
const BAR_HEADROOM = 1.1;

const dollars = (cents: number) => cents / 100;

export function bannerView(forecast: ForecastFile, scenario: Scenario): BannerView {
  const totals = computeTotals(forecast, scenario);
  const scale = Math.max(totals.total, totals.target) * BAR_HEADROOM;
  const width = (cents: number) => (cents / scale) * 100;

  const parts: { key: BarSegment["key"]; label: string; cents: number; count: number }[] = [
    { key: "top", label: "Top deals", cents: totals.top, count: totals.topCount },
    { key: "core", label: "Core Longtail", cents: totals.coreLongtail, count: totals.coreCount },
    { key: "carebridge", label: "CareBridge Longtail", cents: totals.carebridgeLongtail, count: totals.carebridgeCount },
  ];
  // A product outside the known lines is counted under "Other": show it in the bar only when present.
  const barParts = totals.otherCount > 0
    ? [...parts, { key: "other" as const, label: forecast.settings.other_product_line, cents: totals.otherLongtail, count: totals.otherCount }]
    : parts;

  const pastDueDeals = forecast.deals.filter((d) => d.bucket !== null && d.flags.includes("past_due")).length;

  // What the VP override adds on top of the current edits.
  const vpDifference = computeTotals(forecast, setVpOverride(scenario, true)).total
    - computeTotals(forecast, setVpOverride(scenario, false)).total;
  const vpText = scenario.vpOverride
    ? `VP override applied · ${signedMoney(dollars(vpDifference))}`
    : `Formula (default) · applying adds ${signedMoney(dollars(vpDifference))}`;

  return {
    title: `PulseFlow ${forecast.meta.forecast_quarter} Forecast`,
    asOf: `Data as of ${forecast.meta.as_of}`,
    total: money(dollars(totals.total)),
    target: money(dollars(totals.target)),
    variance: signedMoney(dollars(totals.variance)),
    percentOfTarget: `${percent(totals.percentOfTarget)} of target`,
    onTarget: totals.variance >= 0,
    segments: barParts.map((p) => ({ key: p.key, label: p.label, value: money(dollars(p.cents)), widthPercent: width(p.cents) })),
    targetMarkerPercent: width(totals.target),
    tiles: parts.map((p) => ({ label: p.label, value: money(dollars(p.cents)), count: `${p.count} deals` })),
    longtail: {
      label: "Longtail",
      value: money(dollars(totals.longtail)),
      count: `${totals.coreCount + totals.carebridgeCount + totals.otherCount} deals`,
    },
    pastDue: `Past-due exposure: ${money(dollars(totals.pastDueExposure))} on ${pastDueDeals} deals`,
    vpOverrideOn: scenario.vpOverride,
    vpOverride: vpText,
    topWarning: overTopLimit(totals, forecast.settings)
      ? `${totals.topCount} Top deals: more than the usual ${forecast.settings.top_deal_limit}.`
        + " Allowed for what-if; review before presenting."
      : null,
  };
}
