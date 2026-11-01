// The right-side detail panel for one deal: the GPA calculation written out,
// each flag in plain words, and this deal's audit log entries. Display logic
// only; every number comes from forecast.ts and the pipeline's files.

import type { Chip, ChipTone } from "./dealRoomRows";
import { computeDeal, expectedValueCents, gpaX100, pipelineScores, winProbability, type Scenario } from "./forecast";
import { money, signedMoney } from "./format";
import type { AuditEntry, AuditFile, Deal, ForecastFile, Scores } from "./types";

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
  isTop: boolean;
  edited: boolean;
  scores: Scores | null;
  gpaLine: string | null;
  probabilityLine: string;
  expectedValueLine: string;
  vpLine: string | null;
  vpNotes: string | null;
  flags: FlagExplained[];
  auditEntries: AuditLine[];
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const gpaText = (x100: number) => (x100 / 100).toFixed(2);

export function dealDetail(deal: Deal, scenario: Scenario, forecast: ForecastFile, audit: AuditFile): DealDetail {
  const { settings } = forecast;
  const result = computeDeal(deal, scenario, settings);
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
    isTop: result.bucket === "Top",
    edited: result.edited,
    scores: result.scores,
    gpaLine,
    probabilityLine,
    expectedValueLine,
    vpLine,
    vpNotes: deal.vp_notes,
    flags: flagsExplained(deal, forecast, vpLine, result.edited),
    auditEntries: auditFor(deal, audit),
  };
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

function flagsExplained(deal: Deal, forecast: ForecastFile, vpLine: string | null, edited: boolean): FlagExplained[] {
  const flags: FlagExplained[] = [];
  const add = (label: string, tone: ChipTone, text: string) => flags.push({ label, tone, text });

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
