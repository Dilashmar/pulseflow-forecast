// The deal drawer (SPEC 6.2): who, what it's worth, and only the extra
// sections that have something to say (needs attention, VP notes, this week).
// Editing stays in the table; data fixes are on the audit tab. Display logic
// only; every number comes from forecast.ts and the pipeline's files.

import { fileLabel } from "./auditView";
import { computeDeal, expectedValueCents, gpaX100, pipelineScores, winProbability, type Scenario } from "./forecast";
import { money, signedMoney } from "./format";
import type { Deal, ForecastFile, WeekOverWeekFile } from "./types";
import { dealChanges, type ChangeRow } from "./whatChangedView";

export interface DealDetail {
  deal: Deal;
  name: string;
  idLine: string; // "006PF000001T005YAC · Salesforce (this week)"
  rep: string;
  status: string | null; // why a deal isn't in the forecast
  figures: { expectedValue: string; winPercent: string; annualValue: string; closeDate: string };
  attention: string[];
  vpNotes: string | null;
  changes: ChangeRow[]; // this week's changes (Salesforce only)
}

const BLANK = "—";
const pct = (p: number) => `${Math.round(p * 100)}%`;

export function dealDetail(deal: Deal, scenario: Scenario, forecast: ForecastFile, weekOverWeek: WeekOverWeekFile): DealDetail {
  const result = computeDeal(deal, scenario, forecast.settings);
  const changes = dealChanges(weekOverWeek, deal.deal_id);
  return {
    deal,
    name: deal.customer ?? deal.deal_id,
    idLine: `${deal.deal_id} · ${fileLabel(forecast, deal.source_file)}`,
    rep: deal.sales_rep ?? BLANK,
    status: result.inForecast ? null : statusLine(deal, forecast, changes),
    figures: {
      expectedValue: money(result.evCents / 100),
      winPercent: result.inForecast ? pct(result.probability) : BLANK,
      annualValue: money(deal.annual_acv),
      closeDate: deal.close_date ?? BLANK,
    },
    attention: result.inForecast ? attention(deal, result, forecast) : [],
    vpNotes: deal.vp_notes,
    changes,
  };
}

/** The few things worth a second look, in plain words. Empty for most deals. */
function attention(deal: Deal, result: ReturnType<typeof computeDeal>, forecast: ForecastFile): string[] {
  const lines: string[] = [];
  if (deal.flags.includes("past_due")) {
    lines.push(`Past its close date (${deal.close_date}) but still open. ${money(result.evCents / 100)} at risk.`);
  }
  if (result.vpOverride !== "none") {
    // The VP's number against the formula on the pipeline's (unedited) scores.
    const { settings } = forecast;
    const formula = winProbability(gpaX100(pipelineScores(deal)!, settings.gpa_weights), settings.win_probability_cutoffs);
    const vp = deal.vp_win_probability!;
    const difference = signedMoney((expectedValueCents(deal.annual_acv, vp) - expectedValueCents(deal.annual_acv, formula)) / 100);
    if (result.vpOverride === "available") lines.push(`The VP thinks ${pct(vp)}. Using it adds ${difference}.`);
    if (result.vpOverride === "applied") lines.push(`VP override applied: ${pct(vp)} instead of the formula's ${pct(formula)} (${difference}).`);
    if (result.vpOverride === "not_applied_edited") lines.push(`The VP thinks ${pct(vp)}, but the scores were edited, so the formula is used.`);
  }
  if (deal.flags.includes("duplicate_merged")) {
    const copies = forecast.deals.filter((d) => d.duplicate_of === deal.deal_id);
    lines.push(`Also in ${copies[0]?.source ?? "another system"} as ${copies.map((d) => d.deal_id).join(", ")}; counted once, here.`);
  }
  if (deal.flags.includes("needs_review")) {
    lines.push("A data problem needs a person to check it. See the Data Hygiene & Audit Log tab.");
  }
  return lines;
}

/** "Not in Q4 forecast: slipped to Q1-2027", "...: Closed Lost", "...: copy of HubSpot deal HS-9001 (counted there)". */
function statusLine(deal: Deal, forecast: ForecastFile, changes: ChangeRow[]): string {
  const quarter = forecast.meta.forecast_quarter;
  const head = `Not in ${quarter.split("-")[0]} forecast`;
  if (deal.duplicate_of) {
    const kept = forecast.deals.find((d) => d.deal_id === deal.duplicate_of);
    return `${head}: copy of ${kept?.source ?? "another"} deal ${deal.duplicate_of} (counted there)`;
  }
  if (deal.fiscal_period !== quarter) {
    // "Slipped" only when last week's file had it in this quarter; otherwise it just closes later.
    const slipped = changes.some((c) => c.before === quarter && c.after === deal.fiscal_period);
    return `${head}: ${slipped ? "slipped to" : "closes in"} ${deal.fiscal_period}`;
  }
  return `${head}: ${deal.exclusion_reason ?? "excluded"}`;
}
