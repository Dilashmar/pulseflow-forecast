# PulseFlow Q4 Forecast — Spec

## 1. Goal and scope

**Goal:** Replace the 3-hour manual Monday spreadsheet process with a
repeatable pipeline and a dashboard the CEO, CRO, and CFO use live in the
Monday forecast meeting to answer: "How much new annual business will we
close in Q4-2026, and will we hit the $12M board target?"

**Users:** Non-technical executives. The dashboard must be clear at a glance.

**Settings (config, not hard-coded):**

- As-of date: 2026-10-15
- Board target: $12,000,000
- Forecast quarter: Q4-2026
- GPA weights: Leadership 0.20, Commercial 0.20, Contractual 0.60

**Inputs:** 4 raw files in `data/raw/` (never edited by hand or by code).

**Outputs:**

- `output/forecast.json`: every deal, cleaned, with its bucket and expected value
- `output/audit_log.json`: every data issue found, how it was resolved, and its dollar impact
- A React dashboard that reads these files

**Stack:** Python pipeline, React + TypeScript dashboard.

**Out of scope:** writing back to Salesforce or HubSpot, user logins,
forecasting other quarters.

## 2. Input files and standardization

| File | System | What it holds | Used for |
|---|---|---|---|
| `1_sfdc_pipeline_current.csv` | Salesforce | This week's deals | Forecast + week-over-week |
| `2_sfdc_pipeline_prior_week.csv` | Salesforce | Last week's deals | Week-over-week only |
| `3_vp_deal_scorecard.xlsx` | VP spreadsheet | Top 8 deals + VP scores | Bucket A scoring |
| `4_carebridge_hubspot_export.csv` | HubSpot | Acquired CareBridge deals | Longtail (Bucket B) |

### Standard deal fields (all deals are converted to this shape)

| Standard field | Salesforce column | HubSpot column |
|---|---|---|
| deal_id | Opportunity_ID | HubSpot_Deal_ID |
| match_key | first 15 chars of Opportunity_ID | HubSpot_Deal_ID |
| source | "Salesforce" | "HubSpot" |
| customer | Health_System | Company_Name |
| product | Product | Product |
| stage | Stage | Deal_Stage |
| stage_probability | Stage_Probability | Stage_Probability |
| amount_raw | Amount | Amount |
| billing_frequency | Billing_Frequency | Billing_Frequency |
| annual_acv | Amount × 12 if Monthly, else Amount | same rule |
| close_date | Close_Date | Expected_Close_Date |
| fiscal_period | Fiscal_Period | Fiscal_Period |
| sales_rep | Sales_Rep | AE_Owner |
| region | Region | (blank: not in HubSpot) |

Fields HubSpot doesn't have (Region, Created_Date, Days_In_Stage) stay
blank. Never invent values.

### VP scorecard

- The real header row is row 4 (rows 1–3 are a title, a note, and weights).
  Find it by column name, not position.
- Columns used: Rank, Opportunity_ID_15, Hospital_Shorthand_Name, Product,
  Sales_Rep, Leadership_Score, Commercial_Score, Contractual_Score.
- Composite_GPA and Win_Probability in the sheet are **recalculated, not
  trusted**. Any mismatch is logged.
- VP_Notes are kept and shown on the dashboard.

### General rules

- Read files by column name, so a new week's file with reordered columns
  still works.
- If an expected column is missing, stop with a clear error naming the file
  and column.

## 3. Business rules

### 3.1 Which deals count in the Q4 forecast ("active Q4 deals")

A deal is included only if:

- fiscal_period == "Q4-2026", AND
- stage is not "Closed Lost"

Excluded deals still appear in the audit log / week-over-week view, but add $0.

### 3.2 Annual value (ACV)

- Billing_Frequency == "Monthly" → annual_acv = amount × 12
- Billing_Frequency == "Annual" → annual_acv = amount
- Any other value, or blank → set that row aside, flag it "needs review" in
  the audit log, and continue the run.

### 3.3 Bucket A: Top Strategic Deals (from the VP scorecard)

1. Match each VP row to a current Salesforce deal (matching rules in section 4).
2. GPA = 0.20 × Leadership + 0.20 × Commercial + 0.60 × Contractual,
   rounded to 2 decimals (round half up) BEFORE comparing to cutoffs.
   Use exact decimal math so 3.20 / 2.40 / 1.60 never become 3.1999…
3. Win probability:
   - GPA ≥ 3.20 → 0.75
   - 2.40 ≤ GPA < 3.20 → 0.50
   - 1.60 ≤ GPA < 2.40 → 0.30
   - GPA < 1.60 → 0.10
4. Expected value = annual_acv (from Salesforce) × win probability.

**VP overrides:** if the sheet's Win_Probability differs from the formula,
the formula is the default. The dashboard has a toggle to apply the VP's
number. Both values and the dollar difference are shown.
(Confirmed approach with Dan.)

### 3.4 Bucket B: Longtail

- Every other active Q4 deal from Salesforce and HubSpot, after
  deduplication, that is NOT in Bucket A.
- Expected value = annual_acv × stage_probability.
- Split for the KPI banner by product:
  - Core Salesforce = PulseOR, BedFlow, InfusionIQ
  - Acquired CareBridge = CareBridge

  (So Aethelgard Post-Acute Care counts under CareBridge, once.)

### 3.5 Totals

- Total expected Q4 = sum(Bucket A) + sum(Bucket B)
- Variance = Total − $12,000,000 (negative = short of target)
- No deal can be in both buckets.

### 3.6 What-if changes (dashboard)

- Changing a Top deal's scores (1–4) recalculates GPA, probability, and totals.
- Promoting a Longtail deal to Bucket A starts it at scores 3/3/3
  (GPA 3.00 → 50%).
- Demoting a Bucket A deal returns it to the Longtail at its stage probability.
- More than 8 Top deals is allowed but shows a warning. (Design decision.)
- "Reset to Baseline" restores the pipeline's original results.

## 4. Data quality rules

### 4.1 Missing or invalid values

Principle: calculate when there's a clear formula; fill + log only when
near-certain; never guess money, IDs, or probabilities.

| Field | If missing or invalid |
|---|---|
| Amount | Set row aside, flag "needs review" |
| Billing frequency | Set row aside, flag "needs review" |
| Stage probability (Salesforce) | Fill from the standard value for its stage, log it; if stage also missing, set aside |
| Stage probability (HubSpot) | Set row aside (no standard mapping for HubSpot stages) |
| Stage | Flag "needs review" (can't tell if Closed Lost) |
| Fiscal period | Calculate from close date, log it; if both missing, set aside |
| Close date | Flag (affects past-due, quarter, and D6 matching) |
| Product (HubSpot) | Fill "CareBridge", log it |
| Product (Salesforce) | Set row aside, flag |
| Customer name | Keep deal, flag (can't check D6) |
| Deal ID | Set row aside, flag (can't dedupe or track week to week) |
| Sales rep, region, created date | Leave blank, minor note |
| VP scores (any missing or not 1–4) | Can't calculate GPA: not a Top deal; count in Longtail at stage probability; flag |
| VP sheet GPA / win probability | Not used for the forecast; if blank, log "couldn't compare" |
| VP row product blank | If the row has an ID: match by ID and use the Salesforce product. If no ID either: not a Top deal; count in Longtail at stage probability; flag |
| VP row matches no deal, or product differs | Flag "needs review"; not a Top deal |
| VP row: ID matches but rep differs | Trust the ID; note the rep mismatch |

Every check is a general rule. Never hard-code deal IDs or names.
Every issue found is written to the audit log with: source file, record(s),
issue type, what was wrong, how it was resolved, and forecast $ impact
(the expected value that would be wrong if the issue were not fixed).

| # | Check | Resolution |
|---|---|---|
| D1 | Exact duplicate rows within one file | Keep one; log the rest |
| D2 | Same deal ID with different values within one file | Keep the row with the lowest Days_In_Stage (most recent update); log all versions |
| D3 | Salesforce IDs in 15- and 18-character forms | Match on the first 15 characters |
| D4 | VP scorecard row with no ID | Match on customer name (first word) + product + sales rep. Must match exactly one current Salesforce deal; otherwise flag "needs review" and leave out of Bucket A |
| D5 | VP sheet GPA or win probability differs from the formula | Recalculate from scores. Formula is default; dashboard toggle applies the VP's value; log both and the $ difference |
| D6 | Same deal in Salesforce and HubSpot (same normalized customer name, product, annual ACV, and close date) | Count once, using the HubSpot record. Mark the Salesforce copy as a duplicate; exclude it from "New Deals" |
| D7 | Monthly billing amounts | annual_acv = amount × 12 |
| D8 | Closed Lost deal with probability > 0 | Treat as $0; excluded from forecast |
| D9 | Open Q4 deal with close date before the as-of date | Keep in forecast; flag "past due"; show total past-due expected value on the dashboard |
| D10 | Deal outside the forecast quarter | Exclude from forecast |
| D11 | Stage probability doesn't match the standard for its Salesforce stage | Flag only |
| D12 | Fiscal period doesn't match the close date's quarter | Flag only |
| D13 | Field missing in a source (e.g. HubSpot has no Region) | Leave blank; never invent values |
| D14 | File-level problem: missing required column or unreadable file | Stop with a clear error naming the file and column |

### Not a duplicate

Records for related organizations with a **different product** are separate
deals and must NOT be merged (e.g. a hospital system's BedFlow deal and its
post-acute facility's CareBridge deal). Matching must use product, not
just name.

## 5. Week-over-week Salesforce changes

Compare the current Salesforce file to the prior-week file, after applying
the data quality rules (duplicates removed, conflicting rows resolved).
Match deals on match_key (first 15 characters of the ID).
HubSpot is not included (there is no prior-week HubSpot file).

| Category | Rule |
|---|---|
| New Deals Added | In current, not in prior. Exclude Salesforce records marked as copies of HubSpot deals (D6); list them separately as "copied from HubSpot, not new" |
| Slipped (out of Q4) | Prior fiscal_period = Q4-2026 AND current fiscal_period = Q1-2027 (or any later quarter) |
| Closed Lost | Prior stage was open (not Closed Lost) AND current stage = Closed Lost |
| Stage Moves | Active Q4 deals whose stage changed. Label "advanced" or "regressed" using this order: Introduction (0.20) → Technical Validation (0.40) → Business Approval (0.60) → Contract Negotiations (0.80) |
| ACV Changes | Active Q4 deals whose annual_acv changed. Label "expansion" (increase) or "contraction" (decrease) and show the $ change |
| Missing from current | In prior, not in current. Flag for review (should not happen; may mean a deleted record or broken export) |

For each change, show: customer, product, sales rep, before → after, and the
change in expected value where it applies.

A deal can appear in more than one category (e.g. a stage move AND an ACV
change in the same week).

## 6. Dashboard

Audience: CEO, CRO, CFO in a live meeting. Plain language, big numbers,
no jargon. Money shown as $1.10M style. Every number traceable to deals.
Header shows "Data as of 2026-10-15".

### 6.1 KPI banner (always visible at top)

- Total Expected Q4 Sales
- Top Strategic Deals expected value
- Longtail expected value, split: Core Salesforce | Acquired CareBridge
- Variance vs $12.0M target (green if ≥ 0, red if < 0), plus % of target
- Small notes under the banner:
  - Past-due exposure: $ of expected value on deals past their close date
  - VP override: "Formula (default)" or "VP override applied" and the $ difference
- Recalculates instantly on any what-if change.

### 6.2 Tab 1: Deal Room (what-if)

- Table of all active Q4 deals, grouped: Top Strategic Deals, then Longtail.
- Columns: customer, product, sales rep, stage, annual ACV, win probability,
  expected value, flags (past due, duplicate merged, override), VP notes.
- Top deals: editable Leadership / Commercial / Contractual scores (1–4
  dropdowns); GPA and probability update live.
- Promote (Longtail → Top, starts at 3/3/3) and Demote (Top → Longtail)
  buttons. Warning banner if more than 8 Top deals.
- Toggle: "Apply VP overrides".
- "Reset to Baseline" button restores pipeline results and clears all edits.
- Filters: Product, Sales Rep. Filters narrow the table and show a filtered
  subtotal; the KPI banner always shows the full company forecast.
- Edited rows are visibly marked.

### 6.3 Tab 2: What Changed This Week

- Summary counts for the five categories (+ "copied from HubSpot").
- One table per category: customer, product, rep, before → after,
  change in expected value.

### 6.4 Tab 3: Data Hygiene & Audit Log

- Summary at top: number of issues by type, and total $ impact protected.
- Table: issue type, source file, record(s), what was wrong, how it was
  resolved, $ impact. Sortable; filter by issue type.
- Judgment calls (VP override, cross-system duplicate, past-due deals)
  marked separately as "Decision" with the reasoning.

### 6.5 Charts (keep to two)

- Progress to target: Top + Longtail (Core, CareBridge) stacked against
  the $12M line.
- Expected value by product line.

## 7. Definition of done

### 7.1 General

- One command runs the pipeline on a data folder:
  `python pipeline/run.py --data data/raw` → writes output/*.json
- All tests pass, including the expected results below.
- Running on a modified copy of the files (new deal, changed score) works
  without code changes.
- No deal IDs or names hard-coded in pipeline logic.
- README: how to run, how to run on a new week's files, assumptions,
  data issues found with $ impact, how AI was used.

### 7.2 Expected results for this week's files (used as tests)

#### Top Strategic Deals (formula default)

| Deal | Scores (L/C/K) | GPA | Prob | ACV | Expected value |
|---|---|---|---|---|---|
| Aethelgard Health System | 4/4/3 | 3.40 | 75% | $2,400,000 | $1,800,000 |
| Solaris Medical System | 4/3/3 | 3.20 | 75% | $3,000,000 | $2,250,000 |
| Vanguard Meridian | 3/3/3 | 3.00 | 50% | $1,800,000 | $900,000 |
| Zephyr Valley System | 3/3/2 | 2.40 | 50% | $1,500,000 | $750,000 |
| Ironwood Clinical Center | 4/2/2 | 2.40 | 50% | $2,200,000 | $1,100,000 |
| Borealis – Main Campus | 3/2/1 | 1.60 | 30% | $1,600,000 | $480,000 |
| Starlight Oncology | 2/2/2 | 2.00 | 30% | $1,200,000 | $360,000 |
| Halcyon Medical Group | 2/1/1 | 1.20 | 10% | $2,000,000 | $200,000 |
| **Total** | | | | | **$7,840,000** |

#### Forecast totals

| | Formula (default) | VP override on |
|---|---|---|
| Top Strategic Deals | $7,840,000 | $8,390,000 |
| Longtail – Core Salesforce (20 deals) | $4,350,000 | $4,350,000 |
| Longtail – Acquired CareBridge (10 deals) | $992,400 | $992,400 |
| **Total Expected Q4** | **$13,182,400** | **$13,732,400** |
| **Variance vs $12M** | **+$1,182,400 (109.9%)** | **+$1,732,400 (114.4%)** |

#### Data issues the checks must find

- D1: Cascadia Crest (SF, duplicate row); HS-9002 Solaris Transitions (HS)
- D2: Caledonia (SF): keep $550K Contract Negotiations row
- D3: 6 short IDs in prior week (Obsidian, Caledonia, Polaris, Briarwood,
  Solaris, Zephyr); all VP IDs are 15 characters
- D4: Ironwood → T005, Borealis → T006 (Main Campus, not L020),
  Starlight → T007, Halcyon → T008
- D5: Ironwood, sheet 75% vs formula 50% ($550,000 difference)
- D6: Aethelgard Post-Acute Care, SF M001 = HS-9001 ($144,000 avoided)
- D7: HS-9001, 9002, 9003, 9004, 9005, 9011, 9013 converted ×12
- D8: Coral Reef (0.40), HS-9013 Celestial Skilled Nursing (0.30)
- D9: Hyperion, Obsidian, Valkyrie (SF); HS-9004 Zephyr Valley Senior Care
  → past-due exposure $812,000
- D10: Fjordland, Timberline, Greystone (SF); HS-9011, HS-9012
- Not merged: Aethelgard Health System (PulseOR) ≠ Aethelgard Post-Acute Care

#### Week-over-week

- New Deals: Solstice Surgical, Celestial Cancer Institute, Verdant Valley,
  Nebula Health Alliance. Copied from HubSpot: Aethelgard Post-Acute Care.
- Slipped to Q1-2027: Fjordland, Timberline, Greystone
- Closed Lost: Sycamore River, Coral Reef
- Stage moves: advanced: Caledonia, Alabaster, Solaris, Zephyr Valley System;
  regressed: Mirage State, Borealis Main Campus
- ACV changes: Caledonia +$150K, Polaris +$100K, Solaris +$400K,
  Windward −$100K
- Missing from current: none
