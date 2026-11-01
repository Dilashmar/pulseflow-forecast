// Forecast math for the dashboard's what-if changes. Mirrors pipeline/forecast.py
// (SPEC 3.3-3.6). Weights, cutoffs, product lines and the target all come from
// forecast.json, never from this file. Money is worked in whole cents so sums
// stay exact; the parity test checks the baseline against the pipeline's totals.

import type { Bucket, Deal, ForecastFile, Scores, Settings } from "./types";

export type Pillar = keyof Scores;

export interface Scenario {
  // deal_id -> scores that differ from the pipeline's. A promoted deal always has
  // an entry here (its scores start at settings.promote_scores).
  edits: Record<string, Scores>;
  vpOverride: boolean;
  // deal_id -> bucket, only for deals moved away from the pipeline's bucket (SPEC 3.6).
  moves?: Record<string, Bucket>;
}

export const BASELINE: Scenario = { edits: {}, vpOverride: false, moves: {} };

export type Moved = "promoted" | "demoted" | null;

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
  edited: boolean; // scores differ from where this deal's scoring started
  vpOverride: VpOverrideStatus;
  moved: Moved;
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
  const bucket = scenario.moves?.[deal.deal_id] ?? deal.bucket;
  const moved: Moved = bucket === deal.bucket ? null : bucket === "Top" ? "promoted" : "demoted";

  if (bucket === "Longtail") {
    // Longtail (or demoted from Top): its stage probability.
    return {
      deal, bucket: "Longtail", productLine: line, scores: null, gpaX100: null,
      probability: deal.stage_probability,
      evCents: expectedValueCents(deal.annual_acv, deal.stage_probability),
      edited: false, vpOverride: "none", moved,
    };
  }

  // Where this deal's scoring starts: the VP's scores, or the promote scores for a promoted deal.
  const original = moved === "promoted" ? settings.promote_scores : pipelineScores(deal)!;
  const edit = scenario.edits[deal.deal_id];
  const scores = edit ?? original;
  const edited = !sameScores(scores, original);
  const x100 = gpaX100(scores, settings.gpa_weights);
  const formulaProbability = winProbability(x100, settings.win_probability_cutoffs);

  // The VP's number is a judgment on the original scores: it applies only while they're
  // unedited. A promoted deal has no VP number.
  const originalProbability = winProbability(gpaX100(original, settings.gpa_weights), settings.win_probability_cutoffs);
  const sheetDiffers = moved === null && deal.vp_win_probability !== null && deal.vp_win_probability !== originalProbability;
  let vpOverride: VpOverrideStatus = "none";
  if (sheetDiffers) {
    if (!scenario.vpOverride) vpOverride = "available";
    else vpOverride = edited ? "not_applied_edited" : "applied";
  }
  const probability = vpOverride === "applied" ? deal.vp_win_probability! : formulaProbability;

  return {
    deal, bucket: "Top", productLine: line, scores, gpaX100: x100, probability,
    evCents: expectedValueCents(deal.annual_acv, probability),
    edited, vpOverride, moved,
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
  const promoted = scenario.moves?.[deal.deal_id] === "Top" && deal.bucket !== "Top";
  const original = pipelineScores(deal);
  const current = scenario.edits[deal.deal_id] ?? original;
  if (!current) throw new Error(`${deal.deal_id} has no scores to edit`);
  const scores = { ...current, [pillar]: value };
  const edits = { ...scenario.edits };
  // A promoted deal always keeps its scores here. For a pipeline Top deal, an edit
  // that puts every score back to the pipeline's value is no longer an edit.
  if (!promoted && original && sameScores(scores, original)) delete edits[deal.deal_id];
  else edits[deal.deal_id] = scores;
  return { ...scenario, edits };
}

/** Longtail -> Top at settings.promote_scores; or undo a demotion (back to the pipeline's scores). */
export function promote(scenario: Scenario, deal: Deal, settings: Settings): Scenario {
  const moves = { ...scenario.moves };
  const edits = { ...scenario.edits };
  if (deal.bucket === "Top") {
    delete moves[deal.deal_id];
    delete edits[deal.deal_id];
  } else {
    moves[deal.deal_id] = "Top";
    edits[deal.deal_id] = { ...settings.promote_scores };
  }
  return { ...scenario, moves, edits };
}

/** Top -> Longtail at its stage probability (score edits dropped); or undo a promotion. */
export function demote(scenario: Scenario, deal: Deal): Scenario {
  const moves = { ...scenario.moves };
  const edits = { ...scenario.edits };
  if (deal.bucket === "Top") moves[deal.deal_id] = "Longtail";
  else delete moves[deal.deal_id];
  delete edits[deal.deal_id];
  return { ...scenario, moves, edits };
}

/** More Top deals than the usual limit is allowed, but shows a warning (SPEC 3.6). */
export function overTopLimit(totals: TotalsCents, settings: Settings): boolean {
  return totals.topCount > settings.top_deal_limit;
}

export function setVpOverride(scenario: Scenario, on: boolean): Scenario {
  return { ...scenario, vpOverride: on };
}

export function reset(): Scenario {
  return BASELINE;
}

export function isChanged(scenario: Scenario): boolean {
  return scenario.vpOverride
    || Object.keys(scenario.edits).length > 0
    || Object.keys(scenario.moves ?? {}).length > 0;
}

function sameScores(a: Scores, b: Scores): boolean {
  return a.leadership === b.leadership && a.commercial === b.commercial && a.contractual === b.contractual;
}
