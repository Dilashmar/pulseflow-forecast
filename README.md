# PulseFlow Q4-2026 Forecast

A Python pipeline cleans the four weekly sales exports (Salesforce this week and last week, the VP's
Top-deal scorecard, and the CareBridge HubSpot export), works out the Q4 forecast, and logs every data
problem it fixes. A dashboard shows the result for the Monday forecast meeting.

**This week (as of 2026-10-15):** forecast **$13.18M** against the **$12M** target: **+$1.18M (109.9%)**.

## Quick start

Tested with Python 3.14 and Node 23.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
(cd dashboard && npm install)

python pipeline/run.py --data data/raw     # writes output/*.json and prints the totals
pytest                                     # pipeline tests
(cd dashboard && npm test)                 # dashboard tests (Vitest)
(cd dashboard && npm run dev)              # dashboard at http://localhost:5173
.venv/bin/uvicorn server.app:app --port 8000   # update server, for Update data (second terminal)
```

## Running on a new week's data

**From the dashboard** (dashboard and update server both running): click **Update data** in the
sidebar, drop the new files in their slots (empty slots reuse last run's files), check the as-of date,
then **Check files** → **Apply update**. **Go back to last week's data** undoes the last update.

**From the command line**, when only the Salesforce export is new:

```bash
python pipeline/run.py --current week_2_update.csv --as-of 2026-10-22
```

The new file is this week's Salesforce export. Last week's is used as the prior week, and the VP
scorecard and HubSpot files carry over from the last run. Every run keeps a copy of its four input files
in `output/last_inputs/`, so this works however many weeks you run in a row.

**All four files new:** put them in a folder (e.g. `data/2026-10-22/`) under the same names as in
`data/raw/`, with last week's `1_sfdc_pipeline_current.csv` as this week's
`2_sfdc_pipeline_prior_week.csv`, then run `python pipeline/run.py --data data/2026-10-22 --as-of 2026-10-22`.
Never edit the files in `data/raw/`.

Then:
- **Check the first line:** it shows the as-of date and where it came from. Without `--as-of`, the date
  comes from `pipeline/config.py`.
- **Warning about the prior-week file** (`--data` only): it isn't last run's current file, so
  week-over-week may compare the wrong weeks. Check the rename.
- **Error naming a file and column:** a file is missing a column or can't be read. Nothing is written,
  and last week's output stays as it was.
- **Refresh the dashboard.** To keep this week's result, commit `output/`.

The tests keep passing on new weeks: they use frozen copies of the 2026-10-15 files. One dashboard test
also checks the new week's output, confirming the dashboard and the pipeline give the same totals.
At a quarter change, update `FORECAST_QUARTER` (and `BOARD_TARGET` if needed) in `pipeline/config.py`.

## How it works

`load` reads the four files and checks the columns → `standardize` maps each source to the same deal
fields → `checks` applies the data rules D1–D14 and writes the audit log → `forecast` does all the
forecast math → `week_over_week` compares this week's Salesforce file with last week's → `run` writes
`output/forecast.json`, `audit_log.json` and `week_over_week.json`.

The dashboard (`dashboard/`, React) reads those three files. Its what-if math (`forecast.ts`) mirrors
`pipeline/forecast.py`, and a parity test checks that both give the same totals to the cent.
Full rules are in `SPEC.md`.

## Data issues found

From `output/audit_log.json`. **+** = the forecast would have been that much too high without the fix;
**−** = too low.

| Rule | Issue | Resolution | $ impact |
|---|---|---|---:|
| D1 | 2 rows copied exactly | Kept one copy | +$512,000 |
| D2 | Caledonia listed twice with different values | Kept the most recent version (see below) | +$240,000 |
| D3 | 6 IDs in last week's export and 4 in the VP scorecard use the short 15-character form | Matched on the first 15 characters | +$600,000 (VP scorecard matches) |
| D4 | 4 VP scorecard rows with no deal ID | Matched by customer name, product and rep | +$1,380,000 |
| D5 | VP's win probability differs from the formula (Ironwood) | Judgment call (below) | $550,000 difference |
| D6 | Same deal in Salesforce and HubSpot (Aethelgard Post-Acute Care) | Judgment call (below) | +$144,000 |
| D7 | 7 HubSpot deals billed monthly | Converted to annual (× 12) | −$491,700 |
| D8 | 2 Closed Lost deals still carrying a probability | Counted as $0, left out | +$303,200 |
| D9 | 4 open deals past their close date | Judgment call (below) | $812,000 at risk |
| D10 | 5 deals outside Q4-2026 | Left out | +$838,000 |
| D13 | HubSpot has no Region, Created Date or Days in Stage | Left blank, nothing invented | $0 |

D11, D12 and D14 found nothing this week.

## Judgment calls and assumptions

- **VP override (Ironwood):** the formula (50%) is the default so every Top deal is scored the same way;
  a dashboard toggle applies the VP's 75% (+$550K). *Confirmed with Dan.*
- **Cross-system duplicate (Aethelgard Post-Acute Care):** counted once, from HubSpot, which holds the
  CareBridge deals. The Salesforce copy isn't shown as a new deal. *Confirmed with Dan.*
- **Past-due deals:** kept in the forecast and flagged, with $812K shown as at risk.
  *Confirmed with Dan.*
- **Most recent version of a deal (D2):** the row with the lowest Days_In_Stage is treated as the latest.
  Days_In_Stage isn't defined in the brief, and in this data it doesn't reset when other deals change
  stage (e.g., Alabaster, Solaris), so this is an assumption. Caledonia confirms it here: last week it
  was in Business Approval at 12 days; this week one row says Business Approval at 19 days (12 + 7, not
  updated) and the other says Contract Negotiations at $550K with 2 days (the update).
- **CareBridge split by product:** the CareBridge product counts as "Acquired CareBridge"; PulseOR,
  BedFlow and InfusionIQ as "Core Salesforce", whichever system the deal is in.
- **More than 8 Top deals:** allowed in the dashboard's what-if view, with a warning.

## Next steps

- **Pull data directly** from the Salesforce and HubSpot APIs on a Monday schedule, instead of file drops.
- **Smarter upload:** drop all files in one place and have them sorted into slots automatically; warn
  when a new week is uploaded with last week's as-of date.
- **History across weeks:** keep each week's output to show how the forecast moves over time.
- **Run the data checks in the warehouse** as dbt tests, with CI running the test suites on every push.