// The right-side detail panel for one deal: the GPA calculation written out,
// each flag in plain words, this week's changes and this deal's audit log
// entries. Deals not in the forecast are shown read-only. Display logic
// only; every number comes from forecast.ts and the pipeline's files.

import type { Chip, ChipTone } from "./dealRoomRows";
import {
  computeDeal, expectedValueCents, gpaX100, pipelineScores, winProbability, type Moved, type Scenario,
} from "./forecast";
import { money, signedMoney } from "./format";
import type { AuditEntry, AuditFile, Deal, ForecastFile, Scores, WeekOverWeekFile } from "./types";
import { dealChanges, type ChangeRow } from "./whatChangedView";

export interface FlagExplained extends Chip {
  text: string;
}

export interface AuditLine {
  check: string;
  kind: AuditEntry["kind"];
  whatWasWrong: string;
  resolution: string;
  impact: string;
  atRisk: string | null;
  reasoning: string | null;
}

export interface DealDetail {
  deal: Deal;
  inForecast: boolean;
  statusLine: string | null; // why a deal isn't in the forecast
  isTop: boolean;
  edited: boolean;
  scores: Scores | null;
  gpaLine: string | null;
  probabilityLine: string | null;
  expectedValueLine: string;
  vpLine: string | null;
  vpNotes: string | null;
  flags: FlagExplained[];
  auditEntries: AuditLine[];
  changes: ChangeRow[]; // this week's changes (Salesforce only)
  moveAction: MoveAction | null; // null: not in the forecast, so it can't be moved
}

// The panel's Promote to Top / Move to Longtail button and what it will do.
export interface MoveAction {
  kind: "promote" | "demote";
  label: string;
  note: string;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const gpaText = (x100: number) => (x100 / 100).toFixed(2);
const scoresText = (s: Scores) => `${s.leadership} / ${s.commercial} / ${s.contractual}`;

export function dealDetail(
  deal: Deal, scenario: Scenario, forecast: ForecastFile, audit: AuditFile, weekOverWeek: WeekOverWeekFile,
): DealDetail {
  const { settings } = forecast;
  const result = computeDeal(deal, scenario, settings);
  const changes = dealChanges(weekOverWeek, deal.deal_id);

  if (!result.inForecast) {
    return {
      deal,
      inForecast: false,
      statusLine: statusLine(deal, forecast, changes),
      isTop: false,
      edited: false,
      scores: null,
      gpaLine: null,
      probabilityLine: null,
      expectedValueLine: "Expected value: $0 (not in forecast)",
      vpLine: null,
      vpNotes: deal.vp_notes,
      flags: flagsExplained(deal, forecast, null, false, null),
      auditEntries: auditFor(deal, audit),
      changes,
      moveAction: null,
    };
  }

  const ev = money(result.evCents / 100);
  const expectedValueLine = `Expected value = ${money(deal.annual_acv)} × ${pct(result.probability)} = ${ev}`;

  let gpaLine: string | null = null;
  let probabilityLine: string;
  let vpLine: string | null = null;

  if (result.bucket === "Top") {
    const s = result.scores!;
    const w = settings.gpa_weights;
    const weight = (x: number) => (x / 100).toFixed(2);
    gpaLine = `GPA = ${weight(w.leadership)} × ${s.leadership} + ${weight(w.commercial)} × ${s.commercial}`
      + ` + ${weight(w.contractual)} × ${s.contractual} = ${gpaText(result.gpaX100!)}`;
    probabilityLine = bandLine(result.gpaX100!, settings.win_probability_cutoffs);
    if (result.vpOverride === "applied") probabilityLine += ` (VP override applied: ${pct(result.probability)})`;
    vpLine = vpExplanation(deal, result.vpOverride, forecast);
  } else {
    probabilityLine = `${pct(result.probability)} win probability: the stage probability for ${deal.stage ?? "an unknown stage"}`;
  }

  return {
    deal,
    inForecast: true,
    statusLine: null,
    isTop: result.bucket === "Top",
    edited: result.edited,
    scores: result.scores,
    gpaLine,
    probabilityLine,
    expectedValueLine,
    vpLine,
    vpNotes: deal.vp_notes,
    flags: flagsExplained(deal, forecast, vpLine, result.edited, result.moved),
    auditEntries: auditFor(deal, audit),
    changes,
    moveAction: moveAction(deal, result.bucket!, result.moved, forecast),
  };
}

function moveAction(deal: Deal, bucket: "Top" | "Longtail", moved: Moved, forecast: ForecastFile): MoveAction {
  const { settings } = forecast;
  if (bucket === "Top") {
    return {
      kind: "demote",
      label: "Move to Longtail",
      note: `Goes back to its stage probability (${pct(deal.stage_probability)} for ${deal.stage ?? "its stage"})`,
    };
  }
  // A demoted Top deal goes back to its VP scores; any other Longtail deal starts at the promote scores.
  const start = moved === "demoted" ? pipelineScores(deal)! : settings.promote_scores;
  const x100 = gpaX100(start, settings.gpa_weights);
  const band = `GPA ${gpaText(x100)} → ${pct(winProbability(x100, settings.win_probability_cutoffs))}`;
  return {
    kind: "promote",
    label: "Promote to Top",
    note: moved === "demoted"
      ? `Goes back to its VP scores ${scoresText(start)} (${band})`
      : `Starts at scores ${scoresText(start)} (${band})`,
  };
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

/** "2.40 is at least 2.40 → 50% win probability", or "1.20 is below 1.60 → 10% ..." for the lowest band. */
function bandLine(x100: number, cutoffs: ForecastFile["settings"]["win_probability_cutoffs"]): string {
  const highestFirst = [...cutoffs].sort((a, b) => b.min_gpa_x100 - a.min_gpa_x100);
  const probability = winProbability(x100, cutoffs);
  const band = highestFirst.find((c) => x100 >= c.min_gpa_x100) ?? highestFirst[highestFirst.length - 1];
  const nextUp = highestFirst[highestFirst.indexOf(band) - 1];
  if (band.min_gpa_x100 > 0 || !nextUp) {
    return `${gpaText(x100)} is at least ${gpaText(band.min_gpa_x100)} → ${pct(probability)} win probability`;
  }
  const lowestPositive = highestFirst.filter((c) => c.min_gpa_x100 > 0).at(-1)!;
  return `${gpaText(x100)} is below ${gpaText(lowestPositive.min_gpa_x100)} → ${pct(probability)} win probability`;
}

function vpExplanation(deal: Deal, status: ReturnType<typeof computeDeal>["vpOverride"], forecast: ForecastFile): string | null {
  if (status === "none") return null;
  // The difference the VP's number makes against the formula on the pipeline's (unedited) scores.
  const { settings } = forecast;
  const original = winProbability(gpaX100(pipelineScores(deal)!, settings.gpa_weights), settings.win_probability_cutoffs);
  const difference = expectedValueCents(deal.annual_acv, deal.vp_win_probability!) - expectedValueCents(deal.annual_acv, original);
  const head = `VP sheet says ${pct(deal.vp_win_probability!)} (${signedMoney(difference / 100)}).`;
  if (status === "applied") return `${head} Applied.`;
  if (status === "not_applied_edited") return `${head} Not applied: the scores were edited.`;
  return `${head} Not applied: the formula is the default.`;
}

function flagsExplained(
  deal: Deal, forecast: ForecastFile, vpLine: string | null, edited: boolean, moved: Moved,
): FlagExplained[] {
  const flags: FlagExplained[] = [];
  const add = (label: string, tone: ChipTone, text: string) => flags.push({ label, tone, text });

  if (moved === "promoted") {
    add("Promoted", "edited", "You moved this deal into the Top deals in this session; it is scored like a Top deal."
      + " Move to Longtail or Reset to Baseline undoes it.");
  }
  if (moved === "demoted") {
    add("Moved to Longtail", "edited", "You moved this deal out of the Top deals in this session; it now uses its"
      + " stage probability. Promote to Top or Reset to Baseline undoes it.");
  }

  if (deal.flags.includes("past_due")) {
    add("Past due", "danger", `Close date ${deal.close_date} is before ${forecast.meta.as_of} but the deal is still open.`
      + " It's still counted, but its value is at risk.");
  }
  if (deal.flags.includes("duplicate_merged")) {
    const copies = forecast.deals.filter((d) => d.duplicate_of === deal.deal_id).map((d) => d.deal_id);
    add("Merged duplicate", "info", `This deal also appears in Salesforce as ${copies.join(", ")}. It's counted once, here.`);
  }
  if (deal.flags.includes("needs_review")) {
    add("Needs review", "warning", "A data problem needs a person to check it; see the audit entries below.");
  }
  if (vpLine) add("VP override", "vp", vpLine);
  if (edited) add("Edited", "edited", "You changed this deal's scores in this session. Reset to Baseline undoes it.");
  return flags;
}

/** Audit entries naming this deal, by full ID or by its 15-character match key (D3, VP rows). */
function auditFor(deal: Deal, audit: AuditFile): AuditLine[] {
  return audit.entries
    .filter((e) => e.records.some((r) => r.deal_id !== null && (r.deal_id === deal.deal_id || r.deal_id === deal.match_key)))
    .map((e) => ({
      check: e.check,
      kind: e.kind,
      whatWasWrong: e.what_was_wrong,
      resolution: e.resolution,
      impact: e.impact === 0 ? "$0" : signedMoney(e.impact),
      atRisk: e.at_risk ? money(e.at_risk) : null,
      reasoning: e.reasoning,
    }));
}
