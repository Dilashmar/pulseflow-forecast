"""Data quality rules (SPEC section 4); each issue becomes an audit entry.

run_checks: D1-D3 and D6-D13, plus the SPEC 4.1 missing/invalid value
issues found while reading (labelled "4.1").
check_vp_scorecard: D3 for VP IDs, D4 (match VP rows to deals) and D5
(sheet vs formula).
Every rule is general: no deal IDs or names appear in the logic.

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
from pipeline.forecast import (
    ACV_MULTIPLIERS,
    CLOSED_LOST,
    OTHER,
    expected_value,
    gpa,
    is_active_q4,
    product_line,
    round_gpa,
    stage_expected_value,
    vp_row_gpa_x100,
    win_probability,
)
from pipeline.standardize import (
    DEAL_FIELDS,
    HUBSPOT,
    HUBSPOT_COLUMNS,
    SALESFORCE,
    SALESFORCE_COLUMNS,
    SALESFORCE_MATCH_KEY_LENGTH,
    Action,
    quarter_of,
)

FIX = "Fix"
FLAG = "Flag"
DECISION = "Decision"
NEEDS_REVIEW = "Needs review"
NOTE = "Note"

ZERO = Decimal("0")
STATUS_FIELDS = ["in_forecast", "exclusion_reason", "duplicate_of", "flags"]

# Fields that may be blank in a row without setting the row aside (D13).
# A blank customer is a flag (D6 can't check it); the rest are minor notes.
OPTIONAL_FIELDS = ["customer", "sales_rep", "region", "created_date", "days_in_stage"]
SOURCE_COLUMNS = {SALESFORCE: SALESFORCE_COLUMNS, HUBSPOT: HUBSPOT_COLUMNS}

# SPEC 4.1 action -> audit kind.
ACTION_KINDS = {
    Action.SET_ASIDE: NEEDS_REVIEW,
    Action.FILLED: FIX,
    Action.NEEDS_REVIEW: NEEDS_REVIEW,
    Action.FLAGGED: FLAG,
    Action.LEFT_BLANK: NOTE,
}


@dataclass
class AuditEntry:
    check: str              # "D1".."D13", or "4.1" for a missing/invalid value found while reading
    kind: str               # FIX, FLAG, DECISION, NEEDS_REVIEW or NOTE
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
    audit = []

    sf_current = _remove_duplicate_rows(_as_deals(sf_current), audit, counts_in_forecast=True)
    prior = _remove_duplicate_rows(_as_deals(sf_prior), audit, counts_in_forecast=False)
    hubspot = _remove_duplicate_rows(_as_deals(hubspot), audit, counts_in_forecast=True)
    deals = sf_current + hubspot

    _check_short_ids(sf_current + prior, audit)
    _check_missing_fields(deals, audit, row_issues)
    _check_excluded(deals, audit)
    _check_cross_system_duplicates(deals, audit)
    _log_row_issues(row_issues, deals, audit)
    _check_product_line(deals, audit)
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


# --- SPEC 4.1: missing or invalid values found while reading --------------------

def _log_row_issues(row_issues, deals, audit):
    """A set-aside row gets one entry listing all its problems; a kept row gets
    one entry per problem. Filled values: impact = the expected value that
    would be missing if the row had been set aside instead. Kept-and-flagged
    rows: the deal's expected value is at risk."""
    by_row = {}
    for issue in row_issues:
        if issue.action != Action.NOT_COMPARED:  # VP sheet values are logged by D5
            by_row.setdefault((issue.source_file, issue.source_row), []).append(issue)
    deal_at = {(d["source_file"], d["source_row"]): d for d in deals}

    for (file, row), issues in by_row.items():
        deal = deal_at.get((file, row))
        record = _record(deal) if deal else {
            "source_file": file, "source_row": row, "deal_id": issues[0].record, "customer": None,
        }
        set_aside = [i for i in issues if i.row_excluded]
        if set_aside:
            audit.append(AuditEntry(
                check="4.1",
                kind=NEEDS_REVIEW,
                records=[record],
                what_was_wrong="; ".join(_describe(i) for i in issues),
                resolution=set_aside[0].resolution,
                impact=ZERO,
            ))
            continue

        counted = _counted_ev(deal) if deal and deal["in_forecast"] else ZERO
        for issue in issues:
            kind = ACTION_KINDS[issue.action]
            audit.append(AuditEntry(
                check="4.1",
                kind=kind,
                records=[record],
                what_was_wrong=_describe(issue),
                resolution=issue.resolution,
                impact=-counted if issue.action == Action.FILLED else ZERO,
                at_risk=counted if kind in (FLAG, NEEDS_REVIEW) else None,
            ))


def _describe(issue):
    shown = "blank" if issue.value in (None, "") else repr(issue.value)
    return f"{issue.column} {shown}: {issue.problem}"


def _check_product_line(deals, audit):
    # SPEC 3.4 / 4.1: a product outside the known product lines is still counted,
    # under "Other", and flagged rather than guessed into Core or CareBridge.
    for deal in deals:
        if deal["in_forecast"] and product_line(deal["product"]) == OTHER:
            audit.append(AuditEntry(
                check="4.1",
                kind=FLAG,
                records=[_record(deal)],
                what_was_wrong=f"Product {deal['product']!r} is not in a known product line",
                resolution=f"Counted in the total under {OTHER}",
                impact=ZERO,
                at_risk=stage_expected_value(deal),
            ))


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


# --- D3: 15-character Salesforce IDs --------------------------------------------

def _check_short_ids(salesforce_deals, audit):
    # D3: Salesforce IDs come in 15- and 18-character forms; records are matched
    # on the first 15 (match_key). Only week-over-week uses these, so $0.
    for deal in salesforce_deals:
        if len(deal["deal_id"]) == SALESFORCE_MATCH_KEY_LENGTH:
            audit.append(AuditEntry(
                check="D3",
                kind=NOTE,
                records=[_record(deal)],
                what_was_wrong=f"15-character ID {deal['deal_id']} (other files use the 18-character form)",
                resolution="Matched to other records on the first 15 characters",
                impact=ZERO,
            ))


# --- D13: fields missing in a source ------------------------------------------

def _check_missing_fields(deals, audit, row_issues):
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
                    kind=NOTE,
                    records=[{"source_file": file, "source_row": None, "deal_id": None, "customer": None}],
                    what_was_wrong=f"{source} has no {SALESFORCE_COLUMNS[field]} column",
                    resolution="Left blank for all rows; no value invented",
                    impact=ZERO,
                ))

    # D13: an optional cell left blank in one row. Cells that held something
    # unreadable are already logged under SPEC 4.1, so they are skipped here.
    already_logged = {(i.source_file, i.source_row, i.column) for i in row_issues}
    for deal in deals:
        columns = SOURCE_COLUMNS[deal["source"]]
        for field in OPTIONAL_FIELDS:
            column = columns[field]
            if column is None or deal[field] is not None:
                continue
            if (deal["source_file"], deal["source_row"], column) in already_logged:
                continue
            if field == "customer":
                kind, resolution = FLAG, "Kept; can't check whether it is a cross-system duplicate (D6)"
            else:
                kind, resolution = NOTE, "Left blank; no value invented"
            audit.append(AuditEntry(
                check="D13",
                kind=kind,
                records=[_record(deal)],
                what_was_wrong=f"Blank {column}",
                resolution=resolution,
                impact=ZERO,
                at_risk=ZERO if kind == FLAG else None,
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
    # A blank name or close date is no evidence of a match, so those deals are skipped.
    def key(deal):
        return (normalize_name(deal["customer"]), deal["product"], deal["annual_acv"], deal["close_date"])

    def comparable(deal):
        return normalize_name(deal["customer"]) != "" and deal["close_date"] is not None

    hubspot_by_key = {}
    for deal in deals:
        if deal["source"] == HUBSPOT and comparable(deal):
            hubspot_by_key.setdefault(key(deal), deal)

    for deal in deals:
        if deal["source"] != SALESFORCE or not comparable(deal):
            continue
        hubspot = hubspot_by_key.get(key(deal))
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
        if deal["in_forecast"] and deal["close_date"] is not None and deal["close_date"] < config.AS_OF_DATE:
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
        if deal["source"] != SALESFORCE or deal["stage"] is None:  # missing stage: logged under 4.1
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
        if deal["close_date"] is None:  # logged under 4.1
            continue
        close_quarter = quarter_of(deal["close_date"])
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


# --- D4, D5: VP scorecard ---------------------------------------------------------

NOT_TOP_REVIEW = "Not a Top deal; any matching deal stays in the Longtail at its stage probability"


@dataclass
class TopDealMatches:
    matches: dict           # deal_id -> VP row, for matched, active Q4 deals (the Top bucket)
    audit: list


def check_vp_scorecard(vp_rows, deals, row_issues):
    """Match each VP row to a current Salesforce deal (D4) and compare the
    sheet's own GPA / win probability to the formula (D5).

    Rows are matched against all current Salesforce deals, including excluded
    ones, so "no longer active" can be told apart from "no match"."""
    audit = []
    salesforce = [d for d in deals.to_dict("records") if d["source"] == SALESFORCE]
    by_match_key = {d["match_key"]: d for d in salesforce}
    matches, matched_from = {}, {}

    for vp in vp_rows.to_dict("records"):
        deal = _match_vp_row(vp, salesforce, by_match_key, audit)
        if deal is None:
            continue

        if deal["deal_id"] in matches:
            audit.append(_vp_needs_review(
                vp, f"Points at the same deal as VP row {matched_from[deal['deal_id']]} ({deal['deal_id']})",
                [deal], resolution=f"The first row is used; this row is {NOT_TOP_REVIEW[0].lower()}{NOT_TOP_REVIEW[1:]}",
            ))
            continue

        top_value = expected_value(deal["annual_acv"], win_probability(vp_row_gpa_x100(vp)))
        if not deal["in_forecast"]:
            # D4: the VP still ranks it, but the deal doesn't count this quarter.
            audit.append(AuditEntry(
                check="D4",
                kind=FIX,
                records=[_vp_record(vp), _record(deal)],
                what_was_wrong=(f"VP row matches {deal['deal_id']}, which is not in the "
                                f"{config.FORECAST_QUARTER} forecast ({deal['exclusion_reason']})"),
                resolution="Top deal no longer active in Q4: left out of the Top deals",
                impact=top_value,
            ))
            continue

        if vp["match_key"] is None:
            # D4: no ID in the sheet, matched by name + product + rep.
            audit.append(AuditEntry(
                check="D4",
                kind=FIX,
                records=[_vp_record(vp), _record(deal)],
                what_was_wrong="VP row has no Opportunity ID",
                resolution=(f"Matched by name, product and rep to {deal['deal_id']} "
                            f"({deal['customer']}); scored as a Top deal"),
                impact=stage_expected_value(deal) - top_value,
            ))

        if vp["opportunity_id"] is not None and len(vp["opportunity_id"]) < len(deal["deal_id"]):
            # D3: the sheet's short ID only matches on the first 15 characters. Unmatched,
            # the deal would sit in the Longtail at its stage probability.
            audit.append(AuditEntry(
                check="D3",
                kind=FIX,
                records=[_vp_record(vp), _record(deal)],
                what_was_wrong=(f"VP sheet ID {vp['opportunity_id']} is the 15-character form of "
                                f"{deal['deal_id']}"),
                resolution="Matched on the first 15 characters; scored as a Top deal",
                impact=stage_expected_value(deal) - top_value,
            ))

        matches[deal["deal_id"]] = vp
        matched_from[deal["deal_id"]] = vp["source_row"]
        _compare_to_sheet(vp, deal, audit)

    _log_sheet_notes(row_issues, audit)
    return TopDealMatches(matches=matches, audit=audit)


def update_past_due_at_risk(audit, forecast_deals):
    """D9 at-risk was stage-based; restate it with each deal's final expected
    value, so a past-due Top deal uses its GPA-based value."""
    values = dict(zip(forecast_deals["deal_id"], forecast_deals["expected_value"]))
    for entry in audit:
        if entry.check == "D9":
            entry.at_risk = values[entry.records[0]["deal_id"]]


def _match_vp_row(vp, salesforce, by_match_key, audit):
    """D4 and SPEC 4.1: return the matched deal, or None (logged) if there isn't exactly one."""
    if vp["match_key"] is not None:
        deal = by_match_key.get(vp["match_key"])
        if deal is None:
            audit.append(_vp_needs_review(vp, f"ID {vp['match_key']} matches no current Salesforce deal"))
            return None
        if vp["product"] is not None and not _same_text(vp["product"], deal["product"]):
            audit.append(_vp_needs_review(
                vp, f"Product {vp['product']} differs from Salesforce product {deal['product']} "
                    f"for {deal['deal_id']}", [deal]))
            return None
        if vp["sales_rep"] is not None and not _same_text(vp["sales_rep"], deal["sales_rep"]):
            audit.append(AuditEntry(
                check="D4",
                kind=NOTE,
                records=[_vp_record(vp), _record(deal)],
                what_was_wrong=f"Rep {vp['sales_rep']} differs from Salesforce rep {deal['sales_rep']}",
                resolution="Matched by ID; the ID is trusted",
                impact=ZERO,
            ))
        return deal

    # No ID: first word of the name + product + rep must match exactly one deal.
    candidates = [
        d for d in salesforce
        if _first_word(d["customer"]) == _first_word(vp["customer"])
        and _same_text(d["product"], vp["product"])
        and _same_text(d["sales_rep"], vp["sales_rep"])
    ]
    if len(candidates) != 1:
        audit.append(_vp_needs_review(
            vp, f"No ID; name, product and rep match {len(candidates)} Salesforce deals (need exactly 1)",
            candidates))
        return None
    return candidates[0]


def _compare_to_sheet(vp, deal, audit):
    # D5: the sheet's Composite_GPA and Win_Probability are recalculated, not trusted.
    x100 = vp_row_gpa_x100(vp)
    formula_gpa, formula_probability = gpa(x100), win_probability(x100)
    sheet_gpa, sheet_probability = vp["sheet_gpa"], vp["sheet_win_probability"]

    problems = []
    if sheet_gpa is not None and round_gpa(sheet_gpa) != formula_gpa:
        problems.append(f"sheet GPA {round_gpa(sheet_gpa)} vs formula {formula_gpa}")
    probability_differs = sheet_probability is not None and sheet_probability != formula_probability
    if probability_differs:
        problems.append(f"sheet win probability {sheet_probability:.0%} vs formula {formula_probability:.0%}")
    if not problems:
        return

    records = [_vp_record(vp), _record(deal)]
    if probability_differs:
        difference = (expected_value(deal["annual_acv"], sheet_probability)
                      - expected_value(deal["annual_acv"], formula_probability))
        audit.append(AuditEntry(
            check="D5",
            kind=DECISION,
            records=records,
            what_was_wrong="; ".join(problems).capitalize(),
            resolution=(f"Formula used by default ({_money(expected_value(deal['annual_acv'], formula_probability))}); "
                        f"the dashboard toggle applies the VP's number ({_money(difference)} difference)"),
            impact=difference,
            reasoning=("Every Top deal is scored by the same formula so the forecast is consistent; "
                       "the VP's judgment is kept visible as an override the meeting can apply."),
        ))
    else:
        audit.append(AuditEntry(
            check="D5",
            kind=FLAG,
            records=records,
            what_was_wrong="; ".join(problems).capitalize(),
            resolution="GPA recalculated from the scores; the win probability is unchanged",
            impact=ZERO,
            at_risk=ZERO,
        ))


def _log_sheet_notes(row_issues, audit):
    # D5: the sheet's own GPA / win probability was blank or unreadable.
    for issue in row_issues:
        if issue.action == Action.NOT_COMPARED:
            audit.append(AuditEntry(
                check="D5",
                kind=FLAG,
                records=[{"source_file": issue.source_file, "source_row": issue.source_row,
                          "deal_id": issue.record, "customer": None}],
                what_was_wrong=_describe(issue),
                resolution=issue.resolution,
                impact=ZERO,
                at_risk=ZERO,
            ))


def _vp_needs_review(vp, what_was_wrong, deals=(), resolution=NOT_TOP_REVIEW):
    return AuditEntry(
        check="D4",
        kind=NEEDS_REVIEW,
        records=[_vp_record(vp)] + [_record(d) for d in deals],
        what_was_wrong=what_was_wrong,
        resolution=resolution,
        impact=ZERO,
    )


def _vp_record(vp):
    return {"source_file": vp["source_file"], "source_row": vp["source_row"],
            "deal_id": vp["match_key"], "customer": vp["customer"]}


def _first_word(name):
    words = normalize_name(name).split()
    return words[0] if words else None


def _same_text(a, b):
    return a is not None and b is not None and a.strip().casefold() == b.strip().casefold()


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


def _money(amount):
    return f"${amount:,.0f}" if amount == amount.to_integral_value() else f"${amount:,.2f}"
