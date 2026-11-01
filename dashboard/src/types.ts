// Shape of output/forecast.json, written by pipeline/run.py.

export interface Totals {
  top: number;
  core_longtail: number;
  carebridge_longtail: number;
  other_longtail: number;
  longtail: number;
  total: number;
  target: number;
  variance: number;
  percent_of_target: number;
  top_count: number;
  core_count: number;
  carebridge_count: number;
  other_count: number;
  past_due_exposure: number;
}

export type Bucket = "Top" | "Longtail";

export interface Deal {
  deal_id: string;
  match_key: string;
  source: "Salesforce" | "HubSpot";
  customer: string | null;
  product: string;
  stage: string | null;
  stage_probability: number;
  amount_raw: number;
  billing_frequency: "Monthly" | "Annual";
  annual_acv: number;
  close_date: string | null;
  fiscal_period: string;
  sales_rep: string | null;
  region: string | null;
  created_date: string | null;
  days_in_stage: number | null;
  source_file: string;
  source_row: number;
  in_forecast: boolean;
  exclusion_reason: string | null;
  duplicate_of: string | null;
  flags: string[];
  bucket: Bucket | null;
  product_line: string;
  win_probability: number | null;
  expected_value: number;
  leadership_score: number | null;
  commercial_score: number | null;
  contractual_score: number | null;
  gpa: number | null;
  vp_win_probability: number | null;
  vp_expected_value: number | null;
  vp_rank: number | null;
  vp_notes: string | null;
}

export interface Scores {
  leadership: number;
  commercial: number;
  contractual: number;
}

export interface Settings {
  gpa_weights: Scores;
  win_probability_cutoffs: { min_gpa_x100: number; probability: number }[];
  product_lines: Record<string, string>;
  other_product_line: string;
  promote_scores: Scores;
  top_deal_limit: number;
}

// Shape of output/audit_log.json.

export interface AuditRecord {
  source_file: string;
  source_row: number | null; // null = the whole file
  deal_id: string | null;
  customer: string | null;
}

export interface AuditEntry {
  check: string;
  title: string; // plain-English name shared by the rule's entries; the Data Hygiene & Audit Log tab groups by it
  action: string; // short resolution shared by the rule's entries (the line under the title)
  kind: "Fix" | "Flag" | "Decision" | "Needs review" | "Note";
  records: AuditRecord[];
  what_was_wrong: string;
  resolution: string;
  impact: number;
  at_risk: number | null;
  reasoning: string | null;
}

export interface AuditFile {
  summary: {
    entries: number;
    by_check: Record<string, number>;
    by_kind: Record<string, number>;
    total_impact_abs: number;
    total_impact_net: number;
    total_at_risk: number;
  };
  entries: AuditEntry[];
}

export interface ForecastFile {
  meta: {
    as_of: string;
    forecast_quarter: string;
    board_target: number;
    input_files: Record<string, string>;
    input_fingerprints: Record<string, string>; // SHA-256 per input file (pipeline's prior-week check)
    ev_basis: string;
  };
  settings: Settings;
  totals: {
    formula: Totals;
    vp_override: Totals;
    vp_override_difference: number;
  };
  deals: Deal[];
}

// Shape of output/week_over_week.json (Salesforce only, SPEC 5).

export interface WeekChange {
  category: string;
  label: string | null; // advanced / regressed / changed / expansion / contraction
  deal_id: string;
  customer: string | null;
  product: string | null;
  sales_rep: string | null;
  before: string | null;
  after: string | null;
  acv_change: number | null; // ACV Changes only
  ev_change: number;
  ev_basis: string;
  bucket: Bucket | null; // this week's bucket (null = not in the forecast)
  flags: string[];
}

export interface CouldntCompare {
  deal_id: string;
  customer: string | null;
  product: string | null;
  sales_rep: string | null;
  week: string;
  reason: string;
}

export interface WeekOverWeekFile {
  ev_basis: string;
  counts: Record<string, number>;
  changes: Record<string, WeekChange[]>;
  couldnt_compare: CouldntCompare[];
}
