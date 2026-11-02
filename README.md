# PulseFlow Q4-2026 Forecast

Replaces the Monday spreadsheet drill. A Python pipeline cleans the four weekly exports (Salesforce this
week and last week, the VP's Top-deal scorecard, the CareBridge HubSpot export), works out the Q4
forecast and logs every data problem it fixed. A dashboard shows the result for the Monday meeting.

**This week (data as of 2026-10-15):** $13.18M expected against the $12M board target, **+$1.18M (109.9%)**.

## Quick start

**You need:** Git, Python 3.11 or newer (tested on 3.14) and Node.js 18 or newer (tested on 23).

```bash
git clone https://github.com/Dilashmar/pulseflow-forecast.git
cd pulseflow-forecast
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd dashboard && npm install && npm run dev
```

Open **http://localhost:5173**. This week's results are already in the repo, so the dashboard opens
straight away. To load new weeks from the dashboard, also start the update server in a second terminal,
from the project folder:

```bash
.venv/bin/uvicorn server.app:app --port 8000      # Windows: .venv\Scripts\uvicorn server.app:app --port 8000
```

## Data bugs caught

Every fix is logged in `output/audit_log.json` and shown on the dashboard's **Data Hygiene & Audit Log** tab.

| Bug | Example | What the pipeline did | Effect if left unfixed |
|---|---|---|---|
| VP scorecard rows with no deal ID | Ironwood, Borealis, Starlight, Halcyon | Matched on customer name, product and rep | Forecast $1.38M too high |
| Deals outside Q4 | Timberline closes in Q1-2027 | Left out of the Q4 forecast | $838K too high |
| VP scorecard uses short 15-character IDs | 4 Top deals | Matched on the first 15 characters | $600K too high |
| Exact duplicate rows | Cascadia Crest, rows 17 and 18 | Kept one copy | $512K too high |
| HubSpot amounts billed monthly | $15,000/month for Aethelgard Post-Acute | Converted to annual (× 12) | $492K too **low** |
| Closed Lost deals still carrying a probability | Coral Reef at 40% | Counted as $0 | $303K too high |
| Same deal listed twice with different values | Caledonia, rows 10 and 11 | Kept the latest version | $240K too high |
| Short IDs in last week's Salesforce file | 6 deals | Matched on the first 15 characters | None (affects What Changed only) |
| Columns missing from HubSpot | No Region, Created Date or Days in Stage | Left blank; nothing invented | None |

The three judgment calls below are also logged. Checks for non-standard stage probabilities, quarters
that don't match the close date, and unreadable files ran and found nothing this week.

## Judgment calls and assumptions

- **VP override (Ironwood):** the VP's sheet says 75%; the scoring formula says 50%. The formula is the
  default so every Top deal is scored the same way; the dashboard's **VP overrides** switch applies the
  VP's number (+$550K). *Confirmed with Dan.*
- **Same deal in Salesforce and HubSpot (Aethelgard Post-Acute Care):** counted once, from HubSpot,
  which holds the CareBridge deals; otherwise $144K would be counted twice. *Confirmed with Dan.*
- **Past-due deals (4):** kept in the forecast and flagged, with $812K shown as at risk. *Confirmed with Dan.*
- **Latest version of a deal:** the row with the fewest days in its stage is treated as the latest.
  The brief doesn't define Days_In_Stage, but Caledonia supports it: 12 days last week, so the row at 19
  is stale and the row at 2 (Contract Negotiations, $550K) is the update.
- **CareBridge split:** by product (CareBridge = Acquired CareBridge; PulseOR, BedFlow and InfusionIQ =
  Core Salesforce), whichever system the deal is in.
- **What Changed** values changes at stage probability, because there are no last-week VP scores, so
  Top 8 deals there won't match their VP-scored forecast.
- **More than 8 Top deals** is allowed in the what-if view, with a warning.

## Every Monday

1. Start the dashboard and the update server (see Quick start).
2. Click **Upload** (top right). Drop the new files into their slots: usually just **This week's
   Salesforce**. Empty slots reuse last week's files, and last week's Salesforce is picked automatically.
3. Type the export date (YYYY-MM-DD), click **Check files**, then **Apply update**. The dashboard reloads
   with the new numbers.
4. Something looks wrong? **Undo** (next to Upload) goes back to last week's data.

Prefer the command line? `python pipeline/run.py --current week_2_update.csv --as-of 2026-10-22`
does the same with one new Salesforce file. To keep a week's result, commit the `output/` folder.

## What you're looking at

- **Banner:** total expected Q4 sales, the variance to the $12M target, Top 8 strategic deals (with the
  VP overrides switch) and the Forecasted Longtail (Core and CareBridge).
- **Deal Room:** the Top 8 and Longtail deals. Change a Top deal's scores, or move a deal between the two
  with one click; the banner updates instantly. **Reset to baseline** undoes your changes.
- **What Changed:** this week against last week by category. Click a column to see its deals.
- **Data Hygiene & Audit Log:** every issue the pipeline caught, by source file and type.
- Click any customer to see its details.

## How it works and tests

`pipeline/` reads the four files, checks the columns, applies the data rules (full list in `SPEC.md`),
works out the forecast and the week-over-week changes, and writes three JSON files to `output/`. The
dashboard (`dashboard/`, React) reads them; its what-if math mirrors the pipeline's, and a test checks
both give the same totals to the cent. `server/` is the small local server behind Upload.
Run the tests with `pytest` and `cd dashboard && npm test`.

## How I used AI

I built this with Claude Code as a pair programmer: I wrote the spec and the business rules, reviewed
every step, and made the judgment calls. Tests were written before the code, and every total was checked
against numbers worked out by hand from the raw files.

## Next steps

- Pull the data straight from the Salesforce and HubSpot APIs instead of file exports.
- Keep each week's results to show how the forecast moves over time.
- Run the data checks automatically on every change (CI).

## Troubleshooting

- **"The update server isn't running":** start it (Quick start, second command).
- **"command not found" or "No module named …":** the project's Python isn't active. Run
  `source .venv/bin/activate` (or `conda deactivate` first if you use Anaconda), or use the
  `.venv/bin/…` path as shown above.
- **"Address already in use" for the update server:** another copy is already running on port 8000;
  close it (the dashboard expects the server on 8000).
- **Upload says "This looks like a HubSpot export":** the file is in the wrong slot; move it.
