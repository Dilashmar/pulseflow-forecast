// What the top banner shows (SPEC 6.1), read from forecast.json. Kept apart
// from the component so the numbers can be tested without a browser.

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
  pastDue: string;
  vpOverride: string;
}

// Leave room past the larger of total and target so the marker never sits on the edge.
const BAR_HEADROOM = 1.1;

export function bannerView(forecast: ForecastFile): BannerView {
  const totals = forecast.totals.formula;
  const scale = Math.max(totals.total, totals.target) * BAR_HEADROOM;
  const width = (value: number) => (value / scale) * 100;

  const parts: { key: BarSegment["key"]; label: string; value: number; count: number }[] = [
    { key: "top", label: "Top deals", value: totals.top, count: totals.top_count },
    { key: "core", label: "Core Longtail", value: totals.core_longtail, count: totals.core_count },
    { key: "carebridge", label: "CareBridge Longtail", value: totals.carebridge_longtail, count: totals.carebridge_count },
  ];
  // A product outside the known lines is counted under "Other": show it in the bar only when present.
  const barParts = totals.other_count > 0
    ? [...parts, { key: "other" as const, label: forecast.settings.other_product_line, value: totals.other_longtail, count: totals.other_count }]
    : parts;

  const pastDueDeals = forecast.deals.filter((d) => d.bucket !== null && d.flags.includes("past_due")).length;

  return {
    title: `PulseFlow ${forecast.meta.forecast_quarter} Forecast`,
    asOf: `Data as of ${forecast.meta.as_of}`,
    total: money(totals.total),
    target: money(totals.target),
    variance: signedMoney(totals.variance),
    percentOfTarget: `${percent(totals.percent_of_target)} of target`,
    onTarget: totals.variance >= 0,
    segments: barParts.map((p) => ({ key: p.key, label: p.label, value: money(p.value), widthPercent: width(p.value) })),
    targetMarkerPercent: width(totals.target),
    tiles: parts.map((p) => ({ label: p.label, value: money(p.value), count: `${p.count} deals` })),
    pastDue: `Past-due exposure: ${money(totals.past_due_exposure)} on ${pastDueDeals} deals`,
    vpOverride: `VP override: Formula (default) · applying it adds ${signedMoney(forecast.totals.vp_override_difference)}`,
  };
}
