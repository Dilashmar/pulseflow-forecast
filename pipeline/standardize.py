"""Map each source to the standard deal fields (SPEC section 2).

Missing or invalid values follow SPEC 4.1: calculate when there's a clear
formula, fill only when near-certain, never guess money, IDs or
probabilities. Every problem is returned as a RowIssue saying what was done
(set aside, filled, kept and flagged, ...); the checks turn each one into an
audit entry. The run always continues.
"""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

import pandas as pd

from pipeline import config
from pipeline.forecast import annual_acv, normalize_billing_frequency

SALESFORCE = "Salesforce"
HUBSPOT = "HubSpot"

DEAL_FIELDS = [
    "deal_id", "match_key", "source", "customer", "product", "stage",
    "stage_probability", "amount_raw", "billing_frequency", "annual_acv",
    "close_date", "fiscal_period", "sales_rep", "region", "created_date",
    "days_in_stage", "source_file", "source_row",
]

VP_FIELDS = [
    "rank", "opportunity_id", "match_key", "customer", "product", "sales_rep",
    "leadership_score", "commercial_score", "contractual_score",
    "sheet_gpa", "sheet_win_probability", "vp_notes", "source_file", "source_row",
]

# Standard field -> source column. None = not in this source; left blank (D13).
SALESFORCE_COLUMNS = {
    "deal_id": "Opportunity_ID",
    "customer": "Health_System",
    "product": "Product",
    "stage": "Stage",
    "stage_probability": "Stage_Probability",
    "amount_raw": "Amount",
    "billing_frequency": "Billing_Frequency",
    "close_date": "Close_Date",
    "fiscal_period": "Fiscal_Period",
    "sales_rep": "Sales_Rep",
    "region": "Region",
    "created_date": "Created_Date",
    "days_in_stage": "Days_In_Stage",
}
HUBSPOT_COLUMNS = {
    "deal_id": "HubSpot_Deal_ID",
    "customer": "Company_Name",
    "product": "Product",
    "stage": "Deal_Stage",
    "stage_probability": "Stage_Probability",
    "amount_raw": "Amount",
    "billing_frequency": "Billing_Frequency",
    "close_date": "Expected_Close_Date",
    "fiscal_period": "Fiscal_Period",
    "sales_rep": "AE_Owner",
    "region": None,
    "created_date": None,
    "days_in_stage": None,
}

SALESFORCE_MATCH_KEY_LENGTH = 15  # D3: 15- and 18-character IDs match on the first 15
FISCAL_PERIOD_PATTERN = re.compile(r"Q[1-4]-\d{4}")
MISSING = "missing value"

SET_ASIDE_RESOLUTION = "Row set aside until it is fixed in the source system"
NOT_TOP = "not a Top deal; the deal stays in the Longtail at its stage probability"


class Action:
    """What was done about a missing or invalid value (SPEC 4.1)."""

    SET_ASIDE = "set aside"        # row left out; needs review
    FILLED = "filled"              # calculated or filled from a clear rule; logged
    NEEDS_REVIEW = "needs review"  # row kept; a person should check it
    FLAGGED = "flagged"            # row kept; flag only
    LEFT_BLANK = "left blank"      # unreadable minor field left blank; minor note
    NOT_COMPARED = "not compared"  # VP sheet's own GPA / win probability unusable (D5)


@dataclass(frozen=True)
class RowIssue:
    source_file: str
    source_row: int
    record: str | None
    column: str
    value: object
    problem: str
    action: str
    resolution: str
    filled_value: object = None

    @property
    def row_excluded(self):
        return self.action == Action.SET_ASIDE


def standardize_salesforce(df):
    return _standardize_deals(df, SALESFORCE_COLUMNS, SALESFORCE, SALESFORCE_MATCH_KEY_LENGTH)


def standardize_hubspot(df):
    return _standardize_deals(df, HUBSPOT_COLUMNS, HUBSPOT, None)


def standardize_vp(df):
    rows, issues = [], []
    for raw in df.to_dict("records"):
        row = _RowReader(raw, raw["Opportunity_ID_15"] or raw["Hospital_Shorthand_Name"])
        opportunity_id = row.optional("Opportunity_ID_15", _text)
        # With an ID the row is matched by ID and the deal's name, product and rep
        # come from Salesforce. Without one it is matched on name + product + rep
        # (D4), so all three are needed.
        no_id = opportunity_id is None
        cant_match = f"Can't match without an ID: {NOT_TOP}"
        cant_score = f"Can't calculate GPA: {NOT_TOP}"

        def match_field(column):
            return row.required(column, _text, cant_match) if no_id else row.optional(column, _text)

        vp_row = {
            "rank": row.optional("Rank", _whole_number),
            "opportunity_id": opportunity_id,
            "match_key": opportunity_id[:SALESFORCE_MATCH_KEY_LENGTH] if opportunity_id else None,
            "customer": match_field("Hospital_Shorthand_Name"),
            "product": match_field("Product"),
            "sales_rep": match_field("Sales_Rep"),
            "leadership_score": row.required("Leadership_Score", _score, cant_score),
            "commercial_score": row.required("Commercial_Score", _score, cant_score),
            "contractual_score": row.required("Contractual_Score", _score, cant_score),
            "sheet_gpa": row.sheet_value("Composite_GPA", _decimal),
            "sheet_win_probability": row.sheet_value("Win_Probability", _probability),
            "vp_notes": row.optional("VP_Notes", _text),
            "source_file": raw["source_file"],
            "source_row": raw["source_row"],
        }
        issues.extend(row.issues)
        if not row.excluded:
            rows.append(vp_row)
    return pd.DataFrame(rows, columns=VP_FIELDS, dtype=object), issues


def quarter_of(day):
    """Fiscal period for a date, e.g. 2026-11-24 -> "Q4-2026"."""
    return f"Q{(day.month - 1) // 3 + 1}-{day.year}"


def _standardize_deals(df, columns, source, match_key_length):
    deals, issues = [], []
    for raw in df.to_dict("records"):
        row = _RowReader(raw, raw[columns["deal_id"]] or None)

        def required(field, parser=None):
            return row.required(columns[field], parser, SET_ASIDE_RESOLUTION)

        def optional(field, parser=None):
            return row.optional(columns[field], parser)

        deal_id = required("deal_id")  # can't dedupe or track week to week without it
        amount = required("amount_raw", _decimal)
        billing_frequency = required("billing_frequency", normalize_billing_frequency)
        product = _product(row, columns["product"], source)
        stage = _stage(row, columns["stage"])
        close_date = _close_date(row, columns["close_date"])
        fiscal_period = _fiscal_period(row, columns["fiscal_period"], close_date)
        probability = _stage_probability(row, columns["stage_probability"], stage, source)

        deal = {
            "deal_id": deal_id,
            "match_key": deal_id[:match_key_length] if deal_id and match_key_length else deal_id,
            "source": source,
            "customer": optional("customer"),
            "product": product,
            "stage": stage,
            "stage_probability": probability,
            "amount_raw": amount,
            "billing_frequency": billing_frequency,
            "annual_acv": None,
            "close_date": close_date,
            "fiscal_period": fiscal_period,
            "sales_rep": optional("sales_rep"),
            "region": optional("region"),
            "created_date": optional("created_date", _date),
            "days_in_stage": optional("days_in_stage", _whole_number),
            "source_file": raw["source_file"],
            "source_row": raw["source_row"],
        }
        issues.extend(row.issues)
        if row.excluded:
            continue
        deal["annual_acv"] = annual_acv(amount, billing_frequency)
        deals.append(deal)
    return pd.DataFrame(deals, columns=DEAL_FIELDS, dtype=object), issues


# --- SPEC 4.1 rules for individual fields ---------------------------------------

def _product(row, column, source):
    product, problem = row.value(column)
    if problem is None:
        return product
    if source == HUBSPOT:
        # HubSpot only holds the acquired CareBridge business.
        filled = config.HUBSPOT_PRODUCT
        row.note(column, problem, Action.FILLED,
                 f"Filled with {filled}, the only product sold through HubSpot", filled)
        return filled
    row.note(column, problem, Action.SET_ASIDE, SET_ASIDE_RESOLUTION)
    return None


def _stage(row, column):
    stage, problem = row.value(column)
    if problem:
        row.note(column, problem, Action.NEEDS_REVIEW,
                 "Kept in the forecast; can't tell whether it is Closed Lost")
    return stage


def _close_date(row, column):
    close_date, problem = row.value(column, _date)
    if problem:
        row.note(column, problem, Action.FLAGGED,
                 "Kept; past-due, quarter and cross-system duplicate checks can't use it")
    return close_date


def _fiscal_period(row, column, close_date):
    period, problem = row.value(column, _fiscal_period_text)
    if problem is None:
        return period
    if close_date is None:
        row.note(column, problem, Action.SET_ASIDE,
                 "Row set aside: no usable fiscal period or close date, so the quarter is unknown")
        return None
    filled = quarter_of(close_date)
    row.note(column, problem, Action.FILLED, f"Calculated {filled} from close date {close_date}", filled)
    return filled


def _stage_probability(row, column, stage, source):
    probability, problem = row.value(column, _probability)
    if problem is None:
        return probability
    standard = config.STAGE_PROBABILITIES.get(stage) if source == SALESFORCE else None
    if standard is None:
        reason = ("there is no standard probability for HubSpot stages" if source == HUBSPOT
                  else f"there is no standard probability for stage {stage!r}")
        row.note(column, problem, Action.SET_ASIDE, f"Row set aside: {reason}")
        return None
    row.note(column, problem, Action.FILLED, f"Filled with the standard {standard:.0%} for {stage}", standard)
    return standard


# --- Reading cells --------------------------------------------------------------

class _RowReader:
    """Reads cells from one raw row and collects a RowIssue for each problem."""

    def __init__(self, raw, record):
        self.raw = raw
        self.record = record
        self.issues = []

    def value(self, column, parser=None):
        """Return (value, problem). problem is None, MISSING, or why the cell can't be read."""
        if column is None:  # not in this source (D13)
            return None, None
        cell = self.raw[column]
        if cell is None or cell == "":
            return None, MISSING
        if parser is None:
            return cell, None
        try:
            return parser(cell), None
        except ValueError as e:
            return None, str(e)

    def required(self, column, parser, resolution):
        """Missing or unreadable: set the row aside."""
        value, problem = self.value(column, parser)
        if problem:
            self.note(column, problem, Action.SET_ASIDE, resolution)
        return value

    def optional(self, column, parser=None):
        """Blank stays blank (D13 notes it); unreadable is left blank with a minor note."""
        value, problem = self.value(column, parser)
        if problem and problem != MISSING:
            self.note(column, problem, Action.LEFT_BLANK, "Left blank; no value invented")
        return value

    def sheet_value(self, column, parser):
        """The VP sheet's own GPA / win probability: only compared to the formula (D5)."""
        value, problem = self.value(column, parser)
        if problem:
            reason = "blank" if problem == MISSING else problem
            self.note(column, f"couldn't compare to sheet ({reason})", Action.NOT_COMPARED,
                      "Kept; GPA calculated from the scores")
        return value

    def note(self, column, problem, action, resolution, filled_value=None):
        self.issues.append(RowIssue(
            self.raw["source_file"], self.raw["source_row"], self.record,
            column, self.raw[column], problem, action, resolution, filled_value,
        ))

    @property
    def excluded(self):
        return any(issue.row_excluded for issue in self.issues)


def _text(value):
    return str(value).strip()


def _decimal(value):
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise ValueError("not a number") from None
    if not number.is_finite():
        raise ValueError("not a number")
    return number


def _probability(value):
    number = _decimal(value)
    if not 0 <= number <= 1:
        raise ValueError("probability must be between 0 and 1")
    return number


def _whole_number(value):
    number = _decimal(value)
    if number != number.to_integral_value():
        raise ValueError("not a whole number")
    return int(number)


def _score(value):
    number = _whole_number(value)
    if not 1 <= number <= 4:
        raise ValueError("score must be 1-4")
    return number


def _date(value):
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError:
        raise ValueError("not a valid date (expected YYYY-MM-DD)") from None


def _fiscal_period_text(value):
    if not FISCAL_PERIOD_PATTERN.fullmatch(value):
        raise ValueError("not a fiscal period (expected e.g. Q4-2026)")
    return value
