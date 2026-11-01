"""Data quality rules (SPEC section 4); each issue becomes an audit entry.

D1-D3 and D6-D13 run here. D3 (15/18-char IDs) is handled by match_key and
logged with week-over-week; D4 and D5 run with the Top deal scoring. Every
rule is general: no deal IDs or names appear in the logic.

Excluded deals are not deleted: they stay in `deals` with in_forecast=False
and an exclusion_reason. Only extra copies of the same row (D1, D2) are
removed, and each one is logged.

Signed $ impact = the expected value that would be wrong if the issue were
not fixed: + means the forecast would be overstated, - understated.
Flag-only entries have $0 impact and say how much is "at risk".
"""

import re
from dataclasses import dataclass
from decimal import Decimal

import pandas as pd

from pipeline import config
from pipeline.forecast import ACV_MULTIPLIERS, CLOSED_LOST, is_active_q4, stage_expected_value
from pipeline.standardize import DEAL_FIELDS, HUBSPOT_COLUMNS, SALESFORCE_COLUMNS

FIX = "Fix"
FLAG = "Flag"
DECISION = "Decision"
NEEDS_REVIEW = "Needs review"

ZERO = Decimal("0")
STATUS_FIELDS = ["in_forecast", "exclusion_reason", "duplicate_of", "flags"]

# Standard fields that may be blank in a row without setting the row aside (D13).
OPTIONAL_FIELDS = ["customer", "sales_rep", "region", "created_date", "days_in_stage"]
SOURCE_COLUMNS = {"Salesforce": SALESFORCE_COLUMNS, "HubSpot": HUBSPOT_COLUMNS}


@dataclass
class AuditEntry:
    check: str              # "D1".."D13", or "Row" for a row set aside while reading
    kind: str               # FIX, FLAG, DECISION or NEEDS_REVIEW
    records: list           # [{source_file, source_row, deal_id, customer}]; source_row None = whole file
    what_was_wrong: str
    resolution: str
    impact: Decimal         # signed: + overstated, - understated, if not fixed
    at_risk: Decimal | None = None   # flag-only items: value that may be wrong
    reasoning: str | None = None     # decisions: why this call was made


@dataclass
class CheckResult:
    deals: pd.DataFrame     # current Salesforce + HubSpot, cleaned, with STATUS_FIELDS
    prior: pd.DataFrame     # prior-week Salesforce, cleaned (D1, D2)
    audit: list


def run_checks(sf_current, sf_prior, hubspot, row_issues):
    audit = _rows_set_aside(row_issues)

    sf_current = _remove_duplicate_rows(_as_deals(sf_current), audit, counts_in_forecast=True)
    prior = _remove_duplicate_rows(_as_deals(sf_prior), audit, counts_in_forecast=False)
    hubspot = _remove_duplicate_rows(_as_deals(hubspot), audit, counts_in_forecast=True)
    deals = sf_current + hubspot

    _check_missing_fields(deals, audit)
    _check_excluded(deals, audit)
    _check_cross_system_duplicates(deals, audit)
    _check_monthly_billing(deals, audit)
    _check_past_due(deals, audit)
    _check_stage_probability(deals, audit)
    _check_fiscal_period(deals, audit)

    return CheckResult(
        deals=pd.DataFrame(deals, columns=DEAL_FIELDS + STATUS_FIELDS, dtype=object),
        prior=pd.DataFrame(prior, columns=DEAL_FIELDS, dtype=object),
        audit=audit,
    )


def normalize_name(name):
    """Lowercase, drop "(AKA ...)" / "(FKA ...)" asides and punctuation, collapse spaces."""
    name = re.sub(r"\(.*?\)", " ", (name or "").lower())
    name = re.sub(r"[^\w\s]", " ", name)
    return " ".join(name.split())


# --- Rows set aside while reading ---------------------------------------------

def _rows_set_aside(row_issues):
    """One "needs review" entry per row that standardize.py left out."""
    by_row = {}
    for issue in row_issues:
        if issue.row_excluded:  # kept-row notes (VP sheet values) are logged by D5
            by_row.setdefault((issue.source_file, issue.source_row), []).append(issue)
    return [
        AuditEntry(
            check="Row",
            kind=NEEDS_REVIEW,
            records=[{"source_file": file, "source_row": row,
                      "deal_id": issues[0].record, "customer": None}],
            what_was_wrong="; ".join(f"{i.column} {i.value!r}: {i.problem}" for i in issues),
            resolution="Row left out of the forecast until it is fixed in the source system",
            impact=ZERO,
        )
        for (file, row), issues in by_row.items()
    ]


# --- D1, D2: duplicates within one file ---------------------------------------

def _remove_duplicate_rows(deals, audit, counts_in_forecast):
    def impact(deal):
        return _counted_ev(deal) if counts_in_forecast else ZERO

    # D1: exact duplicate rows within one file. Keep the first; log the rest.
    unique, first_seen = [], {}
    for deal in deals:
        key = tuple(deal[f] for f in DEAL_FIELDS if f != "source_row")
        if key not in first_seen:
            first_seen[key] = deal
            unique.append(deal)
            continue
        first = first_seen[key]
        audit.append(AuditEntry(
            check="D1",
            kind=FIX,
            records=[_record(first), _record(deal)],
            what_was_wrong=f"Row {deal['source_row']} is an exact copy of row {first['source_row']}",
            resolution=f"Kept row {first['source_row']}; dropped the copy",
            impact=impact(deal),
        ))

    # D2: same deal ID with different values. Keep the most recent update (lowest Days_In_Stage).
    versions_by_key = {}
    for deal in unique:
        versions_by_key.setdefault(deal["match_key"], []).append(deal)

    kept = []
    for deal in unique:
        versions = versions_by_key[deal["match_key"]]
        if len(versions) == 1:
            kept.append(deal)
            continue
        if deal is not versions[0]:
            continue  # handled with the first version

        days = [v["days_in_stage"] for v in versions]
        lowest = min((d for d in days if d is not None), default=None)
        clear_latest = None not in days and days.count(lowest) == 1
        keep = versions[days.index(lowest)] if clear_latest else versions[0]
        dropped = [v for v in versions if v is not keep]
        kept.append(keep)

        rows = ", ".join(str(v["source_row"]) for v in versions)
        differing = [f for f in DEAL_FIELDS if f != "source_row" and len({v[f] for v in versions}) > 1]
        if clear_latest:
            kind = FIX
            resolution = (f"Kept row {keep['source_row']} (lowest Days_In_Stage, {lowest}: "
                          f"most recent update); dropped the other version(s)")
        else:
            kind = NEEDS_REVIEW
            keep["flags"].append("needs_review")
            resolution = (f"Days_In_Stage doesn't show which version is latest; kept row "
                          f"{keep['source_row']} (first in file) for now")
        audit.append(AuditEntry(
            check="D2",
            kind=kind,
            records=[_record(v) for v in versions],
            what_was_wrong=(f"{len(versions)} versions of deal {deal['deal_id']} (rows {rows}) "
                            f"with different {', '.join(differing)}"),
            resolution=resolution,
            impact=sum((impact(v) for v in dropped), ZERO),
        ))
    return kept


# --- D13: fields missing in a source ------------------------------------------

def _check_missing_fields(deals, audit):
    # D13: a column the source system doesn't have. Leave blank; never invent.
    for source, columns in SOURCE_COLUMNS.items():
        source_deals = [d for d in deals if d["source"] == source]
        if not source_deals:
            continue
        file = source_deals[0]["source_file"]
        for field, column in columns.items():
            if column is None:
                audit.append(AuditEntry(
                    check="D13",
                    kind=FLAG,
                    records=[{"source_file": file, "source_row": None, "deal_id": None, "customer": None}],
                    what_was_wrong=f"{source} has no {SALESFORCE_COLUMNS[field]} column",
                    resolution="Left blank for all rows; no value invented",
                    impact=ZERO,
                    at_risk=ZERO,
                ))

    # D13: an optional cell left blank in one row.
    for deal in deals:
        columns = SOURCE_COLUMNS[deal["source"]]
        blank = [columns[f] for f in OPTIONAL_FIELDS if columns[f] is not None and deal[f] is None]
        if blank:
            audit.append(AuditEntry(
                check="D13",
                kind=FLAG,
                records=[_record(deal)],
                what_was_wrong=f"Blank {', '.join(blank)}",
                resolution="Left blank; no value invented",
                impact=ZERO,
                at_risk=ZERO,
            ))


# --- D8, D10: deals that don't count in the forecast ---------------------------

def _check_excluded(deals, audit):
    for deal in deals:
        if deal["stage"] == CLOSED_LOST:
            _exclude(deal, "Closed Lost")
            # D8: Closed Lost but still carrying a probability. Treat as $0.
            if deal["stage_probability"] > 0:
                in_quarter = deal["fiscal_period"] == config.FORECAST_QUARTER
                audit.append(AuditEntry(
                    check="D8",
                    kind=FIX,
                    records=[_record(deal)],
                    what_was_wrong=f"Closed Lost but stage probability is {deal['stage_probability']:.0%}",
                    resolution="Counted as $0 and left out of the forecast",
                    impact=stage_expected_value(deal) if in_quarter else ZERO,
                ))
        elif deal["fiscal_period"] != config.FORECAST_QUARTER:
            # D10: outside the forecast quarter. Exclude.
            _exclude(deal, f"Outside {config.FORECAST_QUARTER} ({deal['fiscal_period']})")
            audit.append(AuditEntry(
                check="D10",
                kind=FIX,
                records=[_record(deal)],
                what_was_wrong=f"Fiscal period is {deal['fiscal_period']}, not {config.FORECAST_QUARTER}",
                resolution=f"Left out of the {config.FORECAST_QUARTER} forecast",
                impact=stage_expected_value(deal),
            ))


# --- D6: same deal in Salesforce and HubSpot ------------------------------------

def _check_cross_system_duplicates(deals, audit):
    # D6: same normalized customer, product, annual ACV and close date in both
    # systems. Count it once, from HubSpot. Product is part of the key, so related
    # organizations buying different products are never merged.
    def key(deal):
        return (normalize_name(deal["customer"]), deal["product"], deal["annual_acv"], deal["close_date"])

    hubspot_by_key = {}
    for deal in deals:
        if deal["source"] == "HubSpot":
            hubspot_by_key.setdefault(key(deal), deal)

    for deal in deals:
        hubspot = hubspot_by_key.get(key(deal)) if deal["source"] == "Salesforce" else None
        if hubspot is None:
            continue
        impact = _counted_ev(deal)
        _exclude(deal, f"Copy of HubSpot deal {hubspot['deal_id']}")
        deal["duplicate_of"] = hubspot["deal_id"]
        hubspot["flags"].append("duplicate_merged")
        audit.append(AuditEntry(
            check="D6",
            kind=DECISION,
            records=[_record(deal), _record(hubspot)],
            what_was_wrong=(f"Same deal in Salesforce ({deal['deal_id']}) and HubSpot "
                            f"({hubspot['deal_id']}): same customer, product, annual value "
                            f"{_money(deal['annual_acv'])} and close date {deal['close_date']}"),
            resolution="Counted once using the HubSpot record; Salesforce copy marked duplicate",
            impact=impact,
            reasoning=("Counting both would double-count one deal. HubSpot is used because it is "
                       "the acquired CareBridge team's system; the Salesforce copy is not a new deal."),
        ))


# --- D7: monthly billing ------------------------------------------------------

def _check_monthly_billing(deals, audit):
    # D7: monthly amount converted to annual value. Impact is the expected value
    # that would be missing (negative) if the monthly amount were used as annual.
    for deal in deals:
        multiplier = ACV_MULTIPLIERS[deal["billing_frequency"]]
        if multiplier == 1:
            continue
        missing = (deal["annual_acv"] - deal["amount_raw"]) * deal["stage_probability"]
        audit.append(AuditEntry(
            check="D7",
            kind=FIX,
            records=[_record(deal)],
            what_was_wrong=f"Amount {_money(deal['amount_raw'])} is billed {deal['billing_frequency'].lower()}",
            resolution=(f"Annual value = {_money(deal['amount_raw'])} x {multiplier} = "
                        f"{_money(deal['annual_acv'])}"),
            impact=-missing if deal["in_forecast"] else ZERO,
        ))


# --- D9: past due -------------------------------------------------------------

def _check_past_due(deals, audit):
    # D9: open Q4 deal whose close date is before the as-of date. Keep; flag.
    for deal in deals:
        if deal["in_forecast"] and deal["close_date"] < config.AS_OF_DATE:
            deal["flags"].append("past_due")
            audit.append(AuditEntry(
                check="D9",
                kind=DECISION,
                records=[_record(deal)],
                what_was_wrong=f"Close date {deal['close_date']} is before {config.AS_OF_DATE} but the deal is still open",
                resolution="Kept in the forecast and flagged past due",
                impact=ZERO,
                at_risk=stage_expected_value(deal),
                reasoning=("The deal hasn't been closed or moved, so it is still counted, "
                           "but its value is at risk until the rep updates it."),
            ))


# --- D11: stage probability ---------------------------------------------------

def _check_stage_probability(deals, audit):
    # D11: Salesforce stage probability differs from the standard for its stage. Flag only.
    for deal in deals:
        if deal["source"] != "Salesforce":
            continue
        if deal["stage"] == CLOSED_LOST and deal["stage_probability"] > 0:
            continue  # logged as D8
        standard = config.STAGE_PROBABILITIES.get(deal["stage"])
        if standard is None:
            wrong = f"Unknown Salesforce stage {deal['stage']!r}"
            at_risk = ZERO
        elif deal["stage_probability"] != standard:
            wrong = (f"Stage probability {deal['stage_probability']:.0%} differs from the "
                     f"standard {standard:.0%} for {deal['stage']}")
            at_risk = deal["annual_acv"] * (deal["stage_probability"] - standard) if deal["in_forecast"] else ZERO
        else:
            continue
        deal["flags"].append("stage_probability_mismatch")
        audit.append(AuditEntry(
            check="D11",
            kind=FLAG,
            records=[_record(deal)],
            what_was_wrong=wrong,
            resolution="Flagged only; the file's probability is used",
            impact=ZERO,
            at_risk=at_risk,
        ))


# --- D12: fiscal period vs close date -----------------------------------------

def _check_fiscal_period(deals, audit):
    # D12: fiscal period doesn't match the close date's quarter. Flag only.
    for deal in deals:
        close_quarter = _quarter_of(deal["close_date"])
        if deal["fiscal_period"] == close_quarter:
            continue
        if deal["in_forecast"]:
            at_risk = stage_expected_value(deal)       # counted, but may close later
        elif close_quarter == config.FORECAST_QUARTER and deal["exclusion_reason"].startswith("Outside"):
            at_risk = -stage_expected_value(deal)      # not counted, but may close this quarter
        else:
            at_risk = ZERO
        deal["flags"].append("fiscal_period_mismatch")
        audit.append(AuditEntry(
            check="D12",
            kind=FLAG,
            records=[_record(deal)],
            what_was_wrong=(f"Fiscal period {deal['fiscal_period']} doesn't match close date "
                            f"{deal['close_date']} ({close_quarter})"),
            resolution="Flagged only; the fiscal period decides whether it counts",
            impact=ZERO,
            at_risk=at_risk,
        ))


# --- Helpers ------------------------------------------------------------------

def _as_deals(df):
    return [
        {**row, "in_forecast": True, "exclusion_reason": None, "duplicate_of": None, "flags": []}
        for row in df.to_dict("records")
    ]


def _exclude(deal, reason):
    if deal["in_forecast"]:
        deal["in_forecast"] = False
        deal["exclusion_reason"] = reason


def _counted_ev(deal):
    """Expected value this record would add to the forecast if it were counted."""
    return stage_expected_value(deal) if is_active_q4(deal) else ZERO


def _record(deal):
    return {
        "source_file": deal["source_file"],
        "source_row": deal["source_row"],
        "deal_id": deal["deal_id"],
        "customer": deal["customer"],
    }


def _quarter_of(day):
    return f"Q{(day.month - 1) // 3 + 1}-{day.year}"


def _money(amount):
    return f"${amount:,.0f}" if amount == amount.to_integral_value() else f"${amount:,.2f}"
