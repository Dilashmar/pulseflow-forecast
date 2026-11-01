"""Run the full pipeline and write output/*.json."""

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from pipeline import config
from pipeline.checks import check_vp_scorecard, run_checks, update_past_due_at_risk
from pipeline.forecast import Totals, build_forecast
from pipeline.load import load_hubspot, load_salesforce, load_vp_scorecard
from pipeline.standardize import standardize_hubspot, standardize_salesforce, standardize_vp
from pipeline.week_over_week import WeekOverWeek, compare_weeks


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
