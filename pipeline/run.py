"""Run the full pipeline and write output/*.json.

Usage:
  python pipeline/run.py --data data/raw [--out output] [--as-of 2026-10-22]
  python pipeline/run.py --current week_2_update.csv [--out output] [--as-of 2026-10-22]

--data reads the 4 files from a folder. --current takes only this week's
Salesforce export: the prior week, VP scorecard and HubSpot files come from
the copy of the last run's inputs kept in <out>/last_inputs/. Every run
refreshes that copy.

A file-level problem (missing column, unreadable file) stops the run with a
clear error and writes nothing, so the dashboard never sees half-updated output.

Before writing, the run checks that the prior-week file is the current file
from the last run in the output folder (by its SHA-256 fingerprint). If not,
it prints a warning, because week-over-week would compare the wrong weeks,
but still writes the output.
"""

import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

if __package__ in (None, ""):
    # Run as a script: make "from pipeline import ..." resolve from the project folder.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from pipeline import config  # noqa: E402
from pipeline.checks import check_vp_scorecard, run_checks, update_past_due_at_risk  # noqa: E402
from pipeline.forecast import LONGTAIL, OTHER, TOP, WIN_PROBABILITY_CUTOFFS, Totals, build_forecast  # noqa: E402
from pipeline.load import InputError, load_hubspot, load_salesforce, load_vp_scorecard  # noqa: E402
from pipeline.standardize import standardize_hubspot, standardize_salesforce, standardize_vp  # noqa: E402
from pipeline.week_over_week import CATEGORIES, EV_BASIS, WeekOverWeek, compare_weeks  # noqa: E402

OUTPUT_FILES = ["forecast.json", "audit_log.json", "week_over_week.json"]
LAST_INPUTS = "last_inputs"  # copy of the last run's 4 input files, under their standard names


@dataclass
class PipelineResult:
    deals: pd.DataFrame     # every current deal, cleaned, with bucket and expected value
    prior: pd.DataFrame     # prior-week Salesforce deals, cleaned (for week-over-week)
    audit: list             # AuditEntry for every data issue
    totals: Totals          # formula (default)
    totals_vp: Totals       # VP override applied
    week_over_week: WeekOverWeek
    as_of: date             # the date past-due is measured against
    fingerprints: dict      # input file key -> SHA-256 of the file (for the prior-week check)
    input_names: dict       # input file key -> the file name reported in the output


def run_pipeline(data_dir, as_of=None) -> PipelineResult:
    """The 4 files from one folder, under their standard names (config.FILES)."""
    data_dir = Path(data_dir)
    return run_files({key: data_dir / name for key, name in config.FILES.items()}, as_of)


def run_files(files, as_of=None, names=None) -> PipelineResult:
    """files: input key -> path. names: input key -> name to report (default: the path's name)."""
    as_of = as_of or config.AS_OF_DATE
    names = {key: (names or {}).get(key) or Path(path).name for key, path in files.items()}

    sf_current, current_issues = standardize_salesforce(load_salesforce(files["sf_current"], names["sf_current"]))
    sf_prior, prior_issues = standardize_salesforce(load_salesforce(files["sf_prior"], names["sf_prior"]))
    hubspot, hubspot_issues = standardize_hubspot(load_hubspot(files["hubspot"]))
    vp_rows, vp_issues = standardize_vp(load_vp_scorecard(files["vp_scorecard"]))
    row_issues = current_issues + prior_issues + hubspot_issues + vp_issues

    checked = run_checks(sf_current, sf_prior, hubspot, row_issues, as_of=as_of)
    top = check_vp_scorecard(vp_rows, checked.deals, row_issues)
    forecast = build_forecast(checked.deals, top.matches)
    week_over_week = compare_weeks(forecast.deals, checked.prior, row_issues,
                                   current_file=names["sf_current"], prior_file=names["sf_prior"])

    audit = checked.audit + top.audit + week_over_week.audit
    update_past_due_at_risk(audit, forecast.deals)
    return PipelineResult(
        deals=forecast.deals,
        prior=checked.prior,
        audit=audit,
        totals=forecast.totals,
        totals_vp=forecast.totals_vp,
        week_over_week=week_over_week,
        as_of=as_of,
        fingerprints={key: hashlib.sha256(Path(path).read_bytes()).hexdigest() for key, path in files.items()},
        input_names=names,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="PulseFlow Q4 forecast pipeline")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--data", type=Path, help="folder holding the 4 input files")
    source.add_argument("--current", type=Path,
                        help="this week's Salesforce export only; the other 3 files come from the last run")
    parser.add_argument("--out", default=Path("output"), type=Path, help="folder for the JSON output")
    parser.add_argument("--as-of", help="export date, YYYY-MM-DD (default: AS_OF_DATE in config.py)")
    args = parser.parse_args(argv)

    if args.as_of is None:
        as_of, source = config.AS_OF_DATE, "config.py"
    else:
        try:
            as_of, source = date.fromisoformat(args.as_of), "--as-of"
        except ValueError:
            print(f"Error: --as-of must be a date like 2026-10-22 (got {args.as_of!r})", file=sys.stderr)
            return 1
    print(f"As of {as_of} (from {source})")

    if args.data is not None:
        if not args.data.is_dir():
            print(f"Error: data folder not found: {args.data}", file=sys.stderr)
            return 1
        files = {key: args.data / name for key, name in config.FILES.items()}
        names = None
    else:
        last = args.out / LAST_INPUTS
        if not all((last / name).is_file() for name in config.FILES.values()):
            print(f"Error: no previous run in {args.out}/ to take last week's files from; "
                  f"run with --data first", file=sys.stderr)
            return 1
        if not args.current.is_file():
            print(f"Error: {args.current.name}: file not found", file=sys.stderr)
            return 1
        # Last run's current file is this run's prior week; VP and HubSpot carry over.
        files = {
            "sf_current": args.current,
            "sf_prior": last / config.FILES["sf_current"],
            "vp_scorecard": last / config.FILES["vp_scorecard"],
            "hubspot": last / config.FILES["hubspot"],
        }
        names = {"sf_prior": config.FILES["sf_prior"]}

    try:
        result = run_files(files, as_of=as_of, names=names)
    except InputError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if args.data is not None:  # with --current the prior week is last run's file by design
        warning = prior_week_warning(args.out, result.fingerprints)
        if warning:
            print(f"Warning: {warning}", file=sys.stderr)
    write_outputs(build_outputs(result), args.out)
    save_inputs(files, args.out)
    print_summary(result, args.out)
    return 0


def save_inputs(files, out_dir):
    """Keep a copy of this run's 4 inputs under their standard names, for the next --current run.
    Read in full first: with --current, some inputs are the old copies being replaced."""
    contents = {config.FILES[key]: Path(path).read_bytes() for key, path in files.items()}
    last = out_dir / LAST_INPUTS
    last.mkdir(parents=True, exist_ok=True)
    for name, data in contents.items():
        temp = last / f".{name}.tmp"
        temp.write_bytes(data)
        os.replace(temp, last / name)


def prior_week_warning(out_dir, fingerprints):
    """None if the prior-week file is the current file from the last run in out_dir.
    No check on a first run, or when the same week is run again."""
    previous_file = Path(out_dir) / "forecast.json"
    if not previous_file.exists():
        return None
    previous = json.loads(previous_file.read_text())["meta"]
    last = previous.get("input_fingerprints")
    if not last or last["sf_current"] == fingerprints["sf_current"]:
        return None  # older output without fingerprints, or a re-run of the same week
    if fingerprints["sf_prior"] == last["sf_current"]:
        return None
    return (f"the prior-week file ({config.FILES['sf_prior']}) is not the current file from the last run "
            f"(as of {previous['as_of']}). Week-over-week may be comparing the wrong weeks. Did you rename last "
            f"week's {config.FILES['sf_current']} to {config.FILES['sf_prior']}?")


# --- JSON output ------------------------------------------------------------------

def build_outputs(result):
    """{file name: JSON text}. Built in full before anything is written."""
    return {
        "forecast.json": _dump(_forecast_json(result)),
        "audit_log.json": _dump(_audit_json(result.audit)),
        "week_over_week.json": _dump(_week_over_week_json(result.week_over_week)),
    }


def write_outputs(outputs, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, text in outputs.items():
        temp = out_dir / f".{name}.tmp"
        temp.write_text(text)
        os.replace(temp, out_dir / name)


def _forecast_json(result):
    deals = sorted(result.deals.to_dict("records"), key=_deal_order)
    return {
        "meta": {
            "as_of": result.as_of,
            "forecast_quarter": config.FORECAST_QUARTER,
            "board_target": config.BOARD_TARGET,
            "input_files": result.input_names,
            "input_fingerprints": result.fingerprints,
            "ev_basis": "formula",
        },
        # What the dashboard's what-if math needs, so forecast.ts doesn't keep its own copy.
        "settings": {
            "gpa_weights": config.GPA_WEIGHTS,
            "win_probability_cutoffs": [
                {"min_gpa_x100": cutoff, "probability": probability}
                for cutoff, probability in WIN_PROBABILITY_CUTOFFS
            ],
            "product_lines": config.PRODUCT_LINES,
            "other_product_line": OTHER,
            "promote_scores": config.PROMOTE_SCORES,
            "top_deal_limit": config.TOP_DEAL_LIMIT,
        },
        "totals": {
            "formula": asdict(result.totals),
            "vp_override": asdict(result.totals_vp),
            "vp_override_difference": result.totals_vp.total - result.totals.total,
        },
        "deals": deals,
    }


def _audit_json(audit):
    by_check = Counter(e.check for e in audit)
    return {
        "summary": {
            "entries": len(audit),
            "by_check": {check: by_check[check] for check in sorted(by_check, key=_check_order)},
            "by_kind": dict(sorted(Counter(e.kind for e in audit).items())),
            "total_impact_abs": sum((abs(e.impact) for e in audit), Decimal(0)),
            "total_impact_net": sum((e.impact for e in audit), Decimal(0)),
            "total_at_risk": sum((e.at_risk or 0 for e in audit), Decimal(0)),
        },
        "entries": [asdict(e) for e in audit],
    }


def _week_over_week_json(week_over_week):
    return {
        "ev_basis": EV_BASIS,
        "counts": {category: len(week_over_week.changes[category]) for category in CATEGORIES},
        "changes": {category: [asdict(c) for c in week_over_week.changes[category]] for category in CATEGORIES},
        "couldnt_compare": week_over_week.couldnt_compare,
    }


def _deal_order(deal):
    """Top deals by VP rank, then Longtail by expected value, then excluded deals."""
    if deal["bucket"] == TOP:
        return (0, deal["vp_rank"] or 0, deal["deal_id"])
    if deal["bucket"] == LONGTAIL:
        return (1, -deal["expected_value"], deal["deal_id"])
    return (2, 0, deal["deal_id"])


def _check_order(check):
    """D1..D13 in number order, then other labels."""
    return (0, int(check[1:]), "") if check[0] == "D" and check[1:].isdigit() else (1, 0, check)


def _dump(data):
    return json.dumps(_plain(data), indent=2, ensure_ascii=False) + "\n"


def _plain(value):
    """Convert to JSON-ready values: Decimal -> number, date -> "YYYY-MM-DD"."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


# --- Console summary --------------------------------------------------------------

def print_summary(result, out_dir):
    print(f"PulseFlow {config.FORECAST_QUARTER} forecast, data as of {result.as_of}\n")
    for label, t in [("Formula (default)", result.totals), ("VP override on", result.totals_vp)]:
        print(label)
        print(f"  Top Strategic Deals             ${t.top:>14,.0f}  ({t.top_count} deals)")
        print(f"  Longtail - Core Salesforce      ${t.core_longtail:>14,.0f}  ({t.core_count} deals)")
        print(f"  Longtail - Acquired CareBridge  ${t.carebridge_longtail:>14,.0f}  ({t.carebridge_count} deals)")
        if t.other_count:
            print(f"  Longtail - {OTHER:<20} ${t.other_longtail:>14,.0f}  ({t.other_count} deals)")
        print(f"  Total Expected Q4               ${t.total:>14,.0f}")
        print(f"  Variance vs ${config.BOARD_TARGET:,.0f}       {t.variance:>+15,.0f}  ({t.percent_of_target}% of target)")
        print(f"  Past-due exposure               ${t.past_due_exposure:>14,.0f}\n")

    by_check = Counter(e.check for e in result.audit)
    print("Audit log: " + ", ".join(f"{c} {by_check[c]}" for c in sorted(by_check, key=_check_order)))
    wow = result.week_over_week
    print("Week over week: " + ", ".join(f"{c} {len(wow.changes[c])}" for c in CATEGORIES))
    if wow.couldnt_compare:
        print(f"  Couldn't compare (set aside): {len(wow.couldnt_compare)}")
    print("\nWrote " + ", ".join(str(out_dir / name) for name in OUTPUT_FILES))
    print(f"Kept a copy of this run's input files in {out_dir / LAST_INPUTS}/ for the next --current run")


if __name__ == "__main__":
    sys.exit(main())
