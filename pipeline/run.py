"""Run the full pipeline and write output/*.json.

Usage: python pipeline/run.py --data data/raw [--out output]

A file-level problem (missing column, unreadable file) stops the run with a
clear error and writes nothing, so the dashboard never sees half-updated output.
"""

import argparse
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


@dataclass
class PipelineResult:
    deals: pd.DataFrame     # every current deal, cleaned, with bucket and expected value
    prior: pd.DataFrame     # prior-week Salesforce deals, cleaned (for week-over-week)
    audit: list             # AuditEntry for every data issue
    totals: Totals          # formula (default)
    totals_vp: Totals       # VP override applied
    week_over_week: WeekOverWeek


def run_pipeline(data_dir) -> PipelineResult:
    data_dir = Path(data_dir)
    files = {key: data_dir / name for key, name in config.FILES.items()}

    sf_current, current_issues = standardize_salesforce(load_salesforce(files["sf_current"]))
    sf_prior, prior_issues = standardize_salesforce(load_salesforce(files["sf_prior"]))
    hubspot, hubspot_issues = standardize_hubspot(load_hubspot(files["hubspot"]))
    vp_rows, vp_issues = standardize_vp(load_vp_scorecard(files["vp_scorecard"]))
    row_issues = current_issues + prior_issues + hubspot_issues + vp_issues

    checked = run_checks(sf_current, sf_prior, hubspot, row_issues)
    top = check_vp_scorecard(vp_rows, checked.deals, row_issues)
    forecast = build_forecast(checked.deals, top.matches)
    week_over_week = compare_weeks(forecast.deals, checked.prior, row_issues)

    audit = checked.audit + top.audit + week_over_week.audit
    update_past_due_at_risk(audit, forecast.deals)
    return PipelineResult(
        deals=forecast.deals,
        prior=checked.prior,
        audit=audit,
        totals=forecast.totals,
        totals_vp=forecast.totals_vp,
        week_over_week=week_over_week,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="PulseFlow Q4 forecast pipeline")
    parser.add_argument("--data", required=True, type=Path, help="folder holding the 4 input files")
    parser.add_argument("--out", default=Path("output"), type=Path, help="folder for the JSON output")
    args = parser.parse_args(argv)

    if not args.data.is_dir():
        print(f"Error: data folder not found: {args.data}", file=sys.stderr)
        return 1
    try:
        result = run_pipeline(args.data)
    except InputError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    write_outputs(build_outputs(result), args.out)
    print_summary(result, args.out)
    return 0


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
            "as_of": config.AS_OF_DATE,
            "forecast_quarter": config.FORECAST_QUARTER,
            "board_target": config.BOARD_TARGET,
            "input_files": config.FILES,
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
    print(f"PulseFlow {config.FORECAST_QUARTER} forecast, data as of {config.AS_OF_DATE}\n")
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


if __name__ == "__main__":
    sys.exit(main())
