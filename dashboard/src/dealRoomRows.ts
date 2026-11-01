// What each Deal Room row shows (SPEC 6.2), kept apart from the component so
// it can be tested without a browser.

import { computeDeal, forecastDeals, type Moved, type Scenario, type VpOverrideStatus } from "./forecast";
import { money } from "./format";
import type { Bucket, Deal, ForecastFile, Scores } from "./types";

export type ChipTone = "danger" | "info" | "vp" | "vp-applied" | "muted" | "warning" | "edited";

export interface Chip {
  label: string;
  tone: ChipTone;
}

// Keys for the sidebar's flag filter.
export type FlagKey = "past_due" | "duplicate_merged" | "vp_override" | "needs_review" | "edited";

export interface DealRoomRow {
  dealId: string;
  deal: Deal;
  isTop: boolean;
  bucket: Bucket;
  customer: string;
  product: string;
  salesRep: string;
  stage: string;
  annualAcv: string;
  scores: Scores | null; // Top deals: the dropdown values
  gpa: string;
  probability: string;
  expectedValue: string;
  chips: Chip[];
  vpNotes: string;
  edited: boolean; // scores changed
  moved: Moved; // promoted or demoted in this session
  vpOverride: VpOverrideStatus;
  flagKeys: FlagKey[];
  // Raw values for sorting and subtotals.
  acvValue: number;
  gpaX100: number | null;
  probabilityValue: number;
  evCents: number;
}

const BLANK = "—";

export function dealRoomRows(forecast: ForecastFile, scenario: Scenario): DealRoomRow[] {
  // forecast.json is already ordered: Top by VP rank, then Longtail. Score edits keep that
  // order; a promoted deal joins the end of the Top group, a demoted one the start of Longtail.
  const rows = forecastDeals(forecast).map((deal) => {
    const result = computeDeal(deal, scenario, forecast.settings);
    return {
      dealId: deal.deal_id,
      deal,
      isTop: result.bucket === "Top",
      bucket: result.bucket,
      customer: deal.customer ?? BLANK,
      product: deal.product,
      salesRep: deal.sales_rep ?? BLANK,
      stage: deal.stage ?? BLANK,
      annualAcv: money(deal.annual_acv),
      scores: result.scores,
      gpa: result.gpaX100 === null ? BLANK : (result.gpaX100 / 100).toFixed(2),
      probability: `${Math.round(result.probability * 100)}%`,
      expectedValue: money(result.evCents / 100),
      chips: chips(deal, result.vpOverride, result.moved),
      vpNotes: deal.vp_notes ?? "",
      edited: result.edited,
      moved: result.moved,
      vpOverride: result.vpOverride,
      flagKeys: flagKeys(deal, result.vpOverride, result.edited || result.moved !== null),
      acvValue: deal.annual_acv,
      gpaX100: result.gpaX100,
      probabilityValue: result.probability,
      evCents: result.evCents,
    };
  });
  return [...rows.filter((r) => r.isTop), ...rows.filter((r) => !r.isTop)];
}

function flagKeys(deal: Deal, vpOverride: VpOverrideStatus, changed: boolean): FlagKey[] {
  const keys: FlagKey[] = [];
  if (deal.flags.includes("past_due")) keys.push("past_due");
  if (deal.flags.includes("duplicate_merged")) keys.push("duplicate_merged");
  if (vpOverride !== "none") keys.push("vp_override");
  if (deal.flags.includes("needs_review")) keys.push("needs_review");
  if (changed) keys.push("edited"); // score edits, promotions and demotions
  return keys;
}

function chips(deal: Deal, vpOverride: VpOverrideStatus, moved: Moved): Chip[] {
  const list: Chip[] = [];
  if (moved === "promoted") list.push({ label: "Promoted", tone: "edited" });
  if (moved === "demoted") list.push({ label: "Moved to Longtail", tone: "edited" });
  if (deal.flags.includes("past_due")) list.push({ label: "Past due", tone: "danger" });
  if (deal.flags.includes("duplicate_merged")) list.push({ label: "Merged duplicate", tone: "info" });
  if (deal.flags.includes("needs_review")) list.push({ label: "Needs review", tone: "warning" });
  const vp = `${Math.round((deal.vp_win_probability ?? 0) * 100)}%`;
  if (vpOverride === "available") list.push({ label: `VP override: ${vp}`, tone: "vp" });
  if (vpOverride === "applied") list.push({ label: `VP override applied: ${vp}`, tone: "vp-applied" });
  if (vpOverride === "not_applied_edited") list.push({ label: "VP override (not applied: scores edited)", tone: "muted" });
  return list;
}
