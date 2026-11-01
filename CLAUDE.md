# CLAUDE.md

## Project
PulseFlow Q4 forecast: a repeatable Python pipeline that cleans 4 raw sales
exports and a React dashboard executives use in the Monday forecast meeting.
Full rules, data issues, and expected results are in SPEC.md. Read it first.

## Stack
- Pipeline: Python 3, pandas, openpyxl, pytest
- Dashboard: React + TypeScript (Vite)

## Commands
- Run pipeline: `python pipeline/run.py --data data/raw`
- Run tests: `pytest`
- Start dashboard: `cd dashboard && npm run dev`
- Start update server (for the dashboard's Upload files): `.venv/bin/uvicorn server.app:app --port 8000`

## Structure
- `data/raw/`: original input files. NEVER modify.
- `pipeline/config.py`: settings (as-of date, target, weights, quarter)
- `pipeline/load.py`: read files, check required columns
- `pipeline/standardize.py`: map each source to standard deal fields
- `pipeline/checks.py`: data quality rules D1–D14, write audit entries
- `pipeline/forecast.py`: ALL forecast math (ACV, GPA, buckets, totals)
- `pipeline/week_over_week.py`: Salesforce change categories
- `pipeline/run.py`: runs everything, writes `output/*.json`
- `tests/`: pytest tests, including SPEC.md section 7 expected results
- `dashboard/src/forecast.ts`: mirrors the what-if math from forecast.py

## Rules
- Never hard-code deal IDs or names in pipeline logic. Every check is a general rule.
- Forecast math lives only in `pipeline/forecast.py` (mirrored in `forecast.ts`,
  with a test that both give the same baseline totals).
- Use Decimal for GPA, rounded half up to 2 decimals before comparing cutoffs.
- Every data fix must create an audit log entry with its $ impact.
- Never invent missing values; leave them blank.
- Don't add libraries without asking.
- Don't change SPEC.md without asking.

## How to work with me
- One step at a time. Before writing code, propose a plan and list any assumptions.
- Write tests first for anything with numbers.
- After each change, run the tests and the pipeline, and show me the totals.
- Never say "it works" without showing the output.
- Don't commit; I review and commit each step myself.

