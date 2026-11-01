from datetime import date
from decimal import Decimal

import pytest

from pipeline import config
from pipeline.load import load_hubspot, load_salesforce, load_vp_scorecard
from pipeline.standardize import (
    DEAL_FIELDS,
    standardize_hubspot,
    standardize_salesforce,
    standardize_vp,
)
from tests.helpers import edit_csv_cell, edit_vp_cell

SF_CURRENT = config.FILES["sf_current"]
SF_PRIOR = config.FILES["sf_prior"]
VP = config.FILES["vp_scorecard"]
HUBSPOT = config.FILES["hubspot"]


def sf(path):
    return standardize_salesforce(load_salesforce(path))


def hs(path):
    return standardize_hubspot(load_hubspot(path))


def vp(path):
    return standardize_vp(load_vp_scorecard(path))


def one(deals, deal_id):
    match = deals[deals["deal_id"] == deal_id]
    assert len(match) == 1, deal_id
    return match.iloc[0]


# --- Salesforce ---------------------------------------------------------------

def test_salesforce_standard_fields(data_dir):
    deals, issues = sf(data_dir / SF_CURRENT)
    assert issues == []
    assert len(deals) == 36
    assert list(deals.columns) == DEAL_FIELDS

    t001 = one(deals, "006PF000001T001YAC")
    assert t001["match_key"] == "006PF000001T001"
    assert t001["source"] == "Salesforce"
    assert t001["customer"] == "Aethelgard Health System (AKA Aethelgard Regional Medical)"
    assert t001["product"] == "PulseOR"
    assert t001["stage"] == "Contract Negotiations"
    assert t001["stage_probability"] == Decimal("0.80")
    assert t001["amount_raw"] == Decimal("2400000")
    assert t001["billing_frequency"] == "Annual"
    assert t001["annual_acv"] == Decimal("2400000")
    assert t001["close_date"] == date(2026, 11, 30)
    assert t001["fiscal_period"] == "Q4-2026"
    assert t001["sales_rep"] == "Arthur Pendelton"
    assert t001["region"] == "Northeast"
    assert t001["created_date"] == date(2026, 2, 14)
    assert t001["days_in_stage"] == 18
    assert t001["source_file"] == SF_CURRENT
    assert t001["source_row"] == 24


def test_money_and_probability_are_exact_decimals(data_dir):
    deals, _ = sf(data_dir / SF_CURRENT)
    for column in ["stage_probability", "amount_raw", "annual_acv"]:
        assert all(isinstance(v, Decimal) for v in deals[column]), column


def test_15_and_18_character_ids_share_a_match_key(data_dir):
    current, _ = sf(data_dir / SF_CURRENT)
    prior, _ = sf(data_dir / SF_PRIOR)
    assert one(current, "006PF000001L002YAC")["match_key"] == "006PF000001L002"
    assert one(prior, "006PF000001L002")["match_key"] == "006PF000001L002"


# --- HubSpot ------------------------------------------------------------------

def test_hubspot_monthly_amount_converted_to_annual(data_dir):
    deals, issues = hs(data_dir / HUBSPOT)
    assert issues == []
    assert len(deals) == 14

    hs9001 = one(deals, "HS-9001")
    assert hs9001["amount_raw"] == Decimal("15000")
    assert hs9001["billing_frequency"] == "Monthly"
    assert hs9001["annual_acv"] == Decimal("180000")
    assert one(deals, "HS-9006")["annual_acv"] == Decimal("210000")


def test_hubspot_fields_and_blanks(data_dir):
    deals, _ = hs(data_dir / HUBSPOT)
    hs9001 = one(deals, "HS-9001")
    assert hs9001["match_key"] == "HS-9001"
    assert hs9001["source"] == "HubSpot"
    assert hs9001["customer"] == "Aethelgard Post-Acute Care"
    assert hs9001["stage"] == "Contract Sent"
    assert hs9001["close_date"] == date(2026, 11, 15)
    assert hs9001["sales_rep"] == "Dax Shepherdson"
    # Not in HubSpot (D13): left blank, never invented.
    assert hs9001["region"] is None
    assert hs9001["created_date"] is None
    assert hs9001["days_in_stage"] is None


# --- Billing frequency --------------------------------------------------------

def test_billing_frequency_trimmed_and_case_insensitive(data_dir, tmp_path):
    dst = tmp_path / HUBSPOT
    edit_csv_cell(data_dir / HUBSPOT, dst, 0, "Billing_Frequency", "  MONTHLY ")
    hs9001 = one(hs(dst)[0], "HS-9001")
    assert hs9001["billing_frequency"] == "Monthly"
    assert hs9001["annual_acv"] == Decimal("180000")


# --- Row-level problems: exclude the row, flag it, keep going -----------------

@pytest.mark.parametrize(
    "column, value",
    [
        ("Billing_Frequency", "Quarterly"),
        ("Billing_Frequency", ""),
        ("Amount", "abc"),
        ("Amount", ""),
        ("Close_Date", "2026-13-40"),
        ("Stage_Probability", "eighty"),
        ("Stage_Probability", "1.5"),
        ("Days_In_Stage", "ten"),
    ],
)
def test_bad_cell_excludes_only_that_row(data_dir, tmp_path, column, value):
    dst = tmp_path / SF_CURRENT
    edit_csv_cell(data_dir / SF_CURRENT, dst, 0, column, value)
    deals, issues = sf(dst)

    assert len(deals) == 35
    assert "006PF000001L020YAC" not in set(deals["deal_id"])
    assert len(issues) == 1
    issue = issues[0]
    assert issue.source_file == SF_CURRENT
    assert issue.source_row == 2
    assert issue.record == "006PF000001L020YAC"
    assert issue.column == column
    assert issue.value == value
    assert issue.problem
    assert issue.row_excluded


def test_bad_hubspot_billing_frequency_excludes_only_that_row(data_dir, tmp_path):
    dst = tmp_path / HUBSPOT
    edit_csv_cell(data_dir / HUBSPOT, dst, 0, "Billing_Frequency", "Weekly")
    deals, issues = hs(dst)
    assert len(deals) == 13
    assert [(i.record, i.column, i.value) for i in issues] == [("HS-9001", "Billing_Frequency", "Weekly")]


def test_blank_optional_field_stays_blank(data_dir, tmp_path):
    dst = tmp_path / SF_CURRENT
    edit_csv_cell(data_dir / SF_CURRENT, dst, 0, "Region", "")
    deals, issues = sf(dst)
    assert issues == []
    assert one(deals, "006PF000001L020YAC")["region"] is None


# --- VP scorecard -------------------------------------------------------------

def test_vp_rows(data_dir):
    rows, issues = vp(data_dir / VP)
    assert issues == []
    assert len(rows) == 8

    first = rows.iloc[0]
    assert first["rank"] == 1
    assert first["match_key"] == "006PF000001T001"
    assert first["customer"] == "Aethelgard Health"
    assert first["product"] == "PulseOR"
    assert first["sales_rep"] == "Arthur Pendelton"
    assert (first["leadership_score"], first["commercial_score"], first["contractual_score"]) == (4, 4, 3)
    assert first["sheet_gpa"] == Decimal("3.4")
    assert first["sheet_win_probability"] == Decimal("0.75")
    assert first["vp_notes"].startswith("MSA redlines")


def test_vp_row_without_id_has_blank_match_key(data_dir):
    rows, _ = vp(data_dir / VP)
    ironwood = rows[rows["customer"] == "Ironwood Clinical"].iloc[0]
    assert ironwood["match_key"] is None
    assert ironwood["sheet_win_probability"] == Decimal("0.75")
    assert ironwood["sheet_gpa"] == Decimal("2.4")


@pytest.mark.parametrize("value", [5, 0, 2.5, "high"])
def test_vp_invalid_score_excludes_only_that_row(data_dir, tmp_path, value):
    dst = tmp_path / VP
    edit_vp_cell(data_dir / VP, dst, 0, "Leadership_Score", value)
    rows, issues = vp(dst)

    assert len(rows) == 7
    assert "006PF000001T001" not in set(rows["match_key"])
    assert len(issues) == 1
    assert issues[0].source_file == VP
    assert issues[0].source_row == 5
    assert issues[0].record == "006PF000001T001"
    assert issues[0].column == "Leadership_Score"
    assert issues[0].row_excluded


# Ironwood (data row 4) has no ID in the sheet, so it must be matched by name + product + rep.
IRONWOOD = 4


@pytest.mark.parametrize("column", ["Hospital_Shorthand_Name", "Product", "Sales_Rep"])
def test_vp_row_without_id_needs_name_product_and_rep(data_dir, tmp_path, column):
    dst = tmp_path / VP
    edit_vp_cell(data_dir / VP, dst, IRONWOOD, column, None)
    rows, issues = vp(dst)
    assert len(rows) == 7
    assert "Ironwood Clinical" not in set(rows["customer"])
    assert [(i.source_row, i.column, i.row_excluded) for i in issues] == [(9, column, True)]


def test_vp_row_with_id_keeps_row_when_name_and_rep_blank(data_dir, tmp_path):
    dst = tmp_path / VP
    edit_vp_cell(data_dir / VP, dst, 0, "Hospital_Shorthand_Name", None)
    edit_vp_cell(dst, dst, 0, "Sales_Rep", None)
    rows, issues = vp(dst)
    assert issues == []
    first = rows.iloc[0]
    assert first["match_key"] == "006PF000001T001"
    assert first["customer"] is None
    assert first["sales_rep"] is None


@pytest.mark.parametrize("column, field", [
    ("Composite_GPA", "sheet_gpa"),
    ("Win_Probability", "sheet_win_probability"),
])
@pytest.mark.parametrize("value, reason", [(None, "blank"), ("n/a", "not a number")])
def test_vp_sheet_value_blank_or_unreadable_keeps_row(data_dir, tmp_path, column, field, value, reason):
    dst = tmp_path / VP
    edit_vp_cell(data_dir / VP, dst, 0, column, value)
    rows, issues = vp(dst)

    assert len(rows) == 8
    first = rows.iloc[0]
    assert first[field] is None
    assert (first["leadership_score"], first["commercial_score"], first["contractual_score"]) == (4, 4, 3)
    assert len(issues) == 1
    issue = issues[0]
    assert not issue.row_excluded
    assert (issue.source_row, issue.record, issue.column, issue.value) == (5, "006PF000001T001", column, value)
    assert issue.problem == f"couldn't compare to sheet ({reason})"
