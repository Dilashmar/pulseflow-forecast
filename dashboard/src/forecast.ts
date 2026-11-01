// Forecast math for the dashboard's what-if changes. Mirrors pipeline/forecast.py
// (SPEC 3.3-3.6). Weights, cutoffs, product lines and the target all come from
// forecast.json, never from this file. Money is worked in whole cents so sums
// stay exact; the parity test checks the baseline against the pipeline's totals.

import type { Bucket, Deal, ForecastFile, Scores, Settings } from "./types";

export type Pillar = keyof Scores;

export interface Scenario {
  edits: Record<string, Scores>; // deal_id -> edited scores (only deals that differ from the pipeline)
  vpOverride: boolean;
}

export const BASELINE: Scenario = { edits: {}, vpOverride: false };

// none: the sheet agrees with the formula. available: it differs, toggle off.
// applied: toggle on, sheet's probability used. not_applied_edited: toggle on,
// but the scores were edited, so the formula on the new scores wins.
export type VpOverrideStatus = "none" | "available" | "applied" | "not_applied_edited";

export interface DealResult {
  deal: Deal;
  bucket: Bucket;
  productLine: string;
  scores: Scores | null; // Top deals only
  gpaX100: number | null;
  probability: number; // the one used for expected value
  evCents: number;
  edited: boolean;
  vpOverride: VpOverrideStatus;
}

export interface TotalsCents {
  top: number;
  coreLongtail: number;
  carebridgeLongtail: number;
  otherLongtail: number;
  longtail: number;
  total: number;
  target: number;
  variance: number; // total - target; negative = short of target
  percentOfTarget: number; // 1 decimal, half up
  topCount: number;
  coreCount: number;
  carebridgeCount: number;
  otherCount: number;
  pastDueExposure: number;
}

const CORE = "Core Salesforce";
const CAREBRIDGE = "Acquired CareBridge";
const PAST_DUE = "past_due";

// --- GPA (SPEC 3.3) -----------------------------------------------------------------

export function gpaX100(scores: Scores, weights: Scores): number {
  return weights.leadership * scores.leadership
    + weights.commercial * scores.commercial
    + weights.contractual * scores.contractual;
}

export function winProbability(x100: number, cutoffs: Settings["win_probability_cutoffs"]): number {
  const highestFirst = [...cutoffs].sort((a, b) => b.min_gpa_x100 - a.min_gpa_x100);
  const match = highestFirst.find((c) => x100 >= c.min_gpa_x100);
  return (match ?? highestFirst[highestFirst.length - 1]).probability;
}

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function expectedValueCents(annualAcv: number, probability: number): number {
  return Math.round(toCents(annualAcv) * probability);
}

export function productLine(product: string, settings: Settings): string {
  return settings.product_lines[product] ?? settings.other_product_line;
}

// --- One deal ---------------------------------------------------------------------

export function pipelineScores(deal: Deal): Scores | null {
  if (deal.leadership_score === null || deal.commercial_score === null || deal.contractual_score === null) {
    return null;
  }
  return { leadership: deal.leadership_score, commercial: deal.commercial_score, contractual: deal.contractual_score };
}

export function computeDeal(deal: Deal, scenario: Scenario, settings: Settings): DealResult {
  if (deal.bucket === null) throw new Error(`${deal.deal_id} is not in the forecast`);
  const line = productLine(deal.product, settings);

  if (deal.bucket === "Longtail") {
    return {
      deal, bucket: "Longtail", productLine: line, scores: null, gpaX100: null,
      probability: deal.stage_probability,
      evCents: expectedValueCents(deal.annual_acv, deal.stage_probability),
      edited: false, vpOverride: "none",
    };
  }

  const original = pipelineScores(deal)!;
  const edit = scenario.edits[deal.deal_id];
  const scores = edit ?? original;
  const x100 = gpaX100(scores, settings.gpa_weights);
  const formulaProbability = winProbability(x100, settings.win_probability_cutoffs);

  // The VP's number is a judgment on the original scores: it applies only while they're unedited.
  const originalProbability = winProbability(gpaX100(original, settings.gpa_weights), settings.win_probability_cutoffs);
  const sheetDiffers = deal.vp_win_probability !== null && deal.vp_win_probability !== originalProbability;
  let vpOverride: VpOverrideStatus = "none";
  if (sheetDiffers) {
    if (!scenario.vpOverride) vpOverride = "available";
    else vpOverride = edit ? "not_applied_edited" : "applied";
  }
  const probability = vpOverride === "applied" ? deal.vp_win_probability! : formulaProbability;

  return {
    deal, bucket: "Top", productLine: line, scores, gpaX100: x100, probability,
    evCents: expectedValueCents(deal.annual_acv, probability),
    edited: edit !== undefined, vpOverride,
  };
}

// --- Totals (SPEC 3.5) ------------------------------------------------------------

export function forecastDeals(forecast: ForecastFile): Deal[] {
  return forecast.deals.filter((d) => d.bucket !== null);
}

export function computeTotals(forecast: ForecastFile, scenario: Scenario): TotalsCents {
  const results = forecastDeals(forecast).map((d) => computeDeal(d, scenario, forecast.settings));
  const sum = (rows: DealResult[]) => rows.reduce((total, r) => total + r.evCents, 0);

  const top = results.filter((r) => r.bucket === "Top");
  const longtail = results.filter((r) => r.bucket === "Longtail");
  const core = longtail.filter((r) => r.productLine === CORE);
  const carebridge = longtail.filter((r) => r.productLine === CAREBRIDGE);
  const other = longtail.filter((r) => r.productLine !== CORE && r.productLine !== CAREBRIDGE);

  const total = sum(top) + sum(longtail);
  const target = toCents(forecast.meta.board_target);
  return {
    top: sum(top),
    coreLongtail: sum(core),
    carebridgeLongtail: sum(carebridge),
    otherLongtail: sum(other),
    longtail: sum(longtail),
    total,
    target,
    variance: total - target,
    percentOfTarget: Math.round((total * 1000) / target) / 10,
    topCount: top.length,
    coreCount: core.length,
    carebridgeCount: carebridge.length,
    otherCount: other.length,
    pastDueExposure: sum(results.filter((r) => r.deal.flags.includes(PAST_DUE))),
  };
}

// --- What-if changes (SPEC 3.6) ---------------------------------------------------

export function setScore(scenario: Scenario, deal: Deal, pillar: Pillar, value: number): Scenario {
  const original = pipelineScores(deal);
  if (!original) throw new Error(`${deal.deal_id} has no scores to edit`);
  const scores = { ...(scenario.edits[deal.deal_id] ?? original), [pillar]: value };
  const edits = { ...scenario.edits };
  // An edit that puts every score back to the pipeline's value is no longer an edit.
  if (sameScores(scores, original)) delete edits[deal.deal_id];
  else edits[deal.deal_id] = scores;
  return { ...scenario, edits };
}

export function setVpOverride(scenario: Scenario, on: boolean): Scenario {
  return { ...scenario, vpOverride: on };
}

export function reset(): Scenario {
  return BASELINE;
}

export function isChanged(scenario: Scenario): boolean {
  return scenario.vpOverride || Object.keys(scenario.edits).length > 0;
}

function sameScores(a: Scores, b: Scores): boolean {
  return a.leadership === b.leadership && a.commercial === b.commercial && a.contractual === b.contractual;
}
