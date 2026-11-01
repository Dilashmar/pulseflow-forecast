"""Map each source to the standard deal fields (SPEC section 2).

A row with a missing required value or a value that can't be read (bad
amount, billing frequency, date, probability or score) is left out and
returned as a RowIssue, which the checks turn into a "needs review" audit
entry. The run continues.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

import pandas as pd

from pipeline.forecast import annual_acv, normalize_billing_frequency

DEAL_FIELDS = [
    "deal_id", "match_key", "source", "customer", "product", "stage",
    "stage_probability", "amount_raw", "billing_frequency", "annual_acv",
    "close_date", "fiscal_period", "sales_rep", "region", "created_date",
    "days_in_stage", "source_file", "source_row",
]

VP_FIELDS = [
    "rank", "match_key", "customer", "product", "sales_rep",
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


@dataclass(frozen=True)
class RowIssue:
    """A cell that is missing or unreadable.

    row_excluded=True: the row is left out ("needs review").
    row_excluded=False: the row is kept; only this cell is unusable
    (the VP sheet's own GPA / win probability, so D5 can't compare).
    """

    source_file: str
    source_row: int
    record: str | None
    column: str
    value: object
    problem: str
    row_excluded: bool = True


def standardize_salesforce(df):
    return _standardize_deals(df, SALESFORCE_COLUMNS, "Salesforce", SALESFORCE_MATCH_KEY_LENGTH)


def standardize_hubspot(df):
    return _standardize_deals(df, HUBSPOT_COLUMNS, "HubSpot", None)


def standardize_vp(df):
    rows, issues = [], []
    for raw in df.to_dict("records"):
        reader = _RowReader(raw, raw["Opportunity_ID_15"] or raw["Hospital_Shorthand_Name"])
        opportunity_id = reader.read("Opportunity_ID_15", _text)
        # Without an ID the row is matched on name + product + rep (D4), so all three are needed.
        no_id = opportunity_id is None
        row = {
            "rank": reader.read("Rank", _whole_number),
            "match_key": opportunity_id[:SALESFORCE_MATCH_KEY_LENGTH] if opportunity_id else None,
            "customer": reader.read("Hospital_Shorthand_Name", _text, required=no_id),
            "product": reader.read("Product", _text, required=True),
            "sales_rep": reader.read("Sales_Rep", _text, required=no_id),
            "leadership_score": reader.read("Leadership_Score", _score, required=True),
            "commercial_score": reader.read("Commercial_Score", _score, required=True),
            "contractual_score": reader.read("Contractual_Score", _score, required=True),
            "sheet_gpa": reader.read_sheet_value("Composite_GPA", _decimal),
            "sheet_win_probability": reader.read_sheet_value("Win_Probability", _probability),
            "vp_notes": reader.read("VP_Notes", _text),
            "source_file": raw["source_file"],
            "source_row": raw["source_row"],
        }
        issues.extend(reader.issues)
        if not reader.excluded:
            rows.append(row)
    return pd.DataFrame(rows, columns=VP_FIELDS, dtype=object), issues


def _standardize_deals(df, columns, source, match_key_length):
    deals, issues = [], []
    for raw in df.to_dict("records"):
        deal_id = raw[columns["deal_id"]] or None
        reader = _RowReader(raw, deal_id)

        def read(field, parser=None, required=False):
            return reader.read(columns[field], parser, required)

        billing_frequency = read("billing_frequency", normalize_billing_frequency, required=True)
        deal = {
            "deal_id": read("deal_id", required=True),
            "match_key": deal_id[:match_key_length] if deal_id and match_key_length else deal_id,
            "source": source,
            "customer": read("customer"),
            "product": read("product", required=True),
            "stage": read("stage", required=True),
            "stage_probability": read("stage_probability", _probability, required=True),
            "amount_raw": read("amount_raw", _decimal, required=True),
            "billing_frequency": billing_frequency,
            "annual_acv": None,
            "close_date": read("close_date", _date, required=True),
            "fiscal_period": read("fiscal_period", required=True),
            "sales_rep": read("sales_rep"),
            "region": read("region"),
            "created_date": read("created_date", _date),
            "days_in_stage": read("days_in_stage", _whole_number),
            "source_file": raw["source_file"],
            "source_row": raw["source_row"],
        }
        issues.extend(reader.issues)
        if reader.excluded:
            continue
        deal["annual_acv"] = annual_acv(deal["amount_raw"], billing_frequency)
        deals.append(deal)
    return pd.DataFrame(deals, columns=DEAL_FIELDS, dtype=object), issues


class _RowReader:
    """Reads cells from one raw row, collecting a RowIssue for each bad cell."""

    def __init__(self, raw, record):
        self.raw = raw
        self.record = record
        self.issues = []

    def read(self, column, parser=None, required=False):
        if column is None:
            return None
        value = self.raw[column]
        if value is None or value == "":
            if required:
                self._flag(column, value, "missing value")
            return None
        if parser is None:
            return value
        try:
            return parser(value)
        except ValueError as e:
            self._flag(column, value, str(e))
            return None

    def read_sheet_value(self, column, parser):
        """The VP sheet's own GPA / win probability, used only for the D5 comparison.

        Blank or unreadable: keep the row (the scores still work) and note that
        the sheet couldn't be compared.
        """
        value = self.raw[column]
        try:
            if value is None or value == "":
                raise ValueError("blank")
            return parser(value)
        except ValueError as e:
            self._flag(column, value, f"couldn't compare to sheet ({e})", row_excluded=False)
            return None

    @property
    def excluded(self):
        return any(issue.row_excluded for issue in self.issues)

    def _flag(self, column, value, problem, row_excluded=True):
        self.issues.append(RowIssue(
            self.raw["source_file"], self.raw["source_row"], self.record,
            column, value, problem, row_excluded,
        ))


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
