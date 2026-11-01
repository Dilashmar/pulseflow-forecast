"""SPEC 7.2 "Data issues the checks must find", plus each rule on modified copies."""

from decimal import Decimal

import pandas as pd
import pytest

from pipeline import config
from pipeline.checks import DECISION, FIX, FLAG, NEEDS_REVIEW, NOTE, normalize_name, run_checks
from pipeline.load import load_hubspot, load_salesforce, load_vp_scorecard
from pipeline.standardize import (
    DEAL_FIELDS,
    Action,
    RowIssue,
    standardize_hubspot,
    standardize_salesforce,
    standardize_vp,
)
from tests.helpers import copy_fixtures, edit_csv_cell, edit_vp_cell, read_rows, write_rows

SF_CURRENT = config.FILES["sf_current"]
SF_PRIOR = config.FILES["sf_prior"]
HUBSPOT = config.FILES["hubspot"]
VP = config.FILES["vp_scorecard"]

# Data row positions (0 = first row after the header) in the SF current fixture.
L020_ROW = 0           # Borealis North Surgery Clinic, Contract Negotiations 0.80, $300K
CALEDONIA_OLD_ROW = 8  # Business Approval $400K, Days_In_Stage 19
KESTREL_ROW = 14


def build(data_dir):
    sf_current, current_issues = standardize_salesforce(load_salesforce(data_dir / SF_CURRENT))
    sf_prior, prior_issues = standardize_salesforce(load_salesforce(data_dir / SF_PRIOR))
    hubspot, hubspot_issues = standardize_hubspot(load_hubspot(data_dir / HUBSPOT))
    _, vp_issues = standardize_vp(load_vp_scorecard(data_dir / VP))
    return run_checks(sf_current, sf_prior, hubspot,
                      current_issues + prior_issues + hubspot_issues + vp_issues)


@pytest.fixture
def result(data_dir):
    return build(data_dir)


@pytest.fixture
def work_dir(data_dir, tmp_path):
    return copy_fixtures(data_dir, tmp_path)


def entries(result, check):
    return [e for e in result.audit if e.check == check]


def ids(entry):
    return {r["deal_id"] for r in entry.records}


def by_deal(entries_):
    """{deal_id: entry} for checks that log one deal per entry."""
    return {next(iter(ids(e))): e for e in entries_}


def deal(result, deal_id):
    match = result.deals[result.deals["deal_id"] == deal_id]
    assert len(match) == 1, deal_id
    return match.iloc[0]


# --- Totals after cleaning ----------------------------------------------------

def test_active_q4_deal_counts(result):
    active = result.deals[result.deals["in_forecast"]]
    assert (active["source"] == "Salesforce").sum() == 28  # 8 Top + 20 Core
    assert (active["source"] == "HubSpot").sum() == 10


def test_excluded_deals_are_kept_with_a_reason(result):
    # 36 SF rows - 1 (D1) - 1 (D2) = 34; 14 HubSpot rows - 1 (D1) = 13.
    assert len(result.deals) == 34 + 13
    sycamore = deal(result, "006PF000001X004YAC")  # Closed Lost at 0%: excluded, not a data issue
    assert not sycamore["in_forecast"]
    assert sycamore["exclusion_reason"] == "Closed Lost"
    assert not any("006PF000001X004YAC" in ids(e) for e in result.audit)


def test_prior_week_is_cleaned_too(result):
    assert len(result.prior) == 29
    assert result.prior["match_key"].is_unique


# --- D1 -----------------------------------------------------------------------

def test_d1_exact_duplicate_rows(result):
    found = entries(result, "D1")
    assert {e.records[0]["customer"] for e in found} == {
        "Cascadia Crest Medical", "Solaris Transitions Network",
    }
    impacts = {e.records[0]["source_file"]: e.impact for e in found}
    assert impacts == {SF_CURRENT: Decimal("320000"), HUBSPOT: Decimal("192000")}
    assert all(e.kind == FIX for e in found)
    assert (result.deals["deal_id"] == "006PF000001L014YAC").sum() == 1
    assert (result.deals["deal_id"] == "HS-9002").sum() == 1


def test_d1_catches_a_new_duplicate_without_code_changes(work_dir):
    rows = read_rows(work_dir / SF_CURRENT)
    rows.append(rows[KESTREL_ROW + 1])
    write_rows(work_dir / SF_CURRENT, rows)
    found = entries(build(work_dir), "D1")
    assert "Kestrel Regional Health" in {e.records[0]["customer"] for e in found}


# --- D2 -----------------------------------------------------------------------

def test_d2_keeps_caledonia_550k_contract_negotiations_row(result):
    found = entries(result, "D2")
    assert len(found) == 1
    entry = found[0]
    assert entry.kind == FIX
    assert len(entry.records) == 2  # all versions logged
    assert entry.impact == Decimal("240000")  # discarded $400K x 0.60

    caledonia = deal(result, "006PF000001L008YAC")
    assert caledonia["amount_raw"] == Decimal("550000")
    assert caledonia["stage"] == "Contract Negotiations"


def test_d2_tie_keeps_first_and_needs_review(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, CALEDONIA_OLD_ROW, "Days_In_Stage", "2")
    result = build(work_dir)
    (entry,) = entries(result, "D2")
    assert entry.kind == NEEDS_REVIEW
    assert entry.impact == Decimal("440000")  # discarded $550K x 0.80
    caledonia = deal(result, "006PF000001L008YAC")
    assert caledonia["amount_raw"] == Decimal("400000")
    assert "needs_review" in caledonia["flags"]


# --- D6 -----------------------------------------------------------------------

def test_d6_finds_only_aethelgard_post_acute(result):
    found = entries(result, "D6")
    assert len(found) == 1
    entry = found[0]
    assert ids(entry) == {"006PF000001M001YAC", "HS-9001"}
    assert entry.impact == Decimal("144000")
    assert entry.kind == DECISION
    assert entry.reasoning

    sf_copy = deal(result, "006PF000001M001YAC")
    assert not sf_copy["in_forecast"]
    assert sf_copy["duplicate_of"] == "HS-9001"
    assert "HS-9001" in sf_copy["exclusion_reason"]

    hs_record = deal(result, "HS-9001")
    assert hs_record["in_forecast"]
    assert "duplicate_merged" in hs_record["flags"]


def test_d6_does_not_merge_aethelgard_health_system(result):
    health_system = deal(result, "006PF000001T001YAC")  # PulseOR, related org, different product
    assert health_system["in_forecast"]
    assert health_system["duplicate_of"] is None


def test_d6_catches_a_new_cross_system_duplicate(work_dir):
    rows = read_rows(work_dir / HUBSPOT)
    rows.append(["HS-9999", "Q4-2026", "Palisades Surgical Network", "PulseOR", "Introduction",
                 "0.20", "300000", "Annual", "2026-12-14", "Rowan Sterling"])
    write_rows(work_dir / HUBSPOT, rows)
    found = entries(build(work_dir), "D6")
    assert {"006PF000001L015YAC", "HS-9999"} in [ids(e) for e in found]


def test_normalize_name():
    assert normalize_name("Aethelgard Health System (AKA Aethelgard Regional Medical)") == "aethelgard health system"
    assert normalize_name("  Aethelgard Post-Acute Care ") == "aethelgard post acute care"


# --- D7 -----------------------------------------------------------------------

def test_d7_monthly_conversions(result):
    found = by_deal(entries(result, "D7"))
    assert set(found) == {"HS-9001", "HS-9002", "HS-9003", "HS-9004", "HS-9005", "HS-9011", "HS-9013"}
    assert found["HS-9001"].impact == Decimal("-132000")  # (180,000 - 15,000) x 0.80 missing
    assert found["HS-9011"].impact == 0  # outside Q4
    assert found["HS-9013"].impact == 0  # Closed Lost
    assert sum(e.impact for e in found.values()) == Decimal("-491700")


# --- D8 -----------------------------------------------------------------------

def test_d8_closed_lost_with_probability(result):
    found = by_deal(entries(result, "D8"))
    assert {k: e.impact for k, e in found.items()} == {
        "006PF000001X005YAC": Decimal("260000"),  # Coral Reef 650K x 0.40
        "HS-9013": Decimal("43200"),              # Celestial 144K x 0.30
    }
    for deal_id in found:
        assert not deal(result, deal_id)["in_forecast"]
        assert deal(result, deal_id)["exclusion_reason"] == "Closed Lost"


# --- D9 -----------------------------------------------------------------------

def test_d9_past_due_at_risk_812k(result):
    found = by_deal(entries(result, "D9"))
    assert set(found) == {"006PF000001L001YAC", "006PF000001L002YAC", "006PF000001L003YAC", "HS-9004"}
    assert sum(e.at_risk for e in found.values()) == Decimal("812000")
    for deal_id, entry in found.items():
        assert entry.impact == 0
        assert entry.kind == DECISION
        assert entry.reasoning
        assert deal(result, deal_id)["in_forecast"]
        assert "past_due" in deal(result, deal_id)["flags"]


# --- D10 ----------------------------------------------------------------------

def test_d10_outside_forecast_quarter(result):
    found = by_deal(entries(result, "D10"))
    assert set(found) == {
        "006PF000001X001YAC", "006PF000001X002YAC", "006PF000001X003YAC", "HS-9011", "HS-9012",
    }
    assert found["006PF000001X002YAC"].impact == Decimal("450000")  # Timberline 750K x 0.60
    assert sum(e.impact for e in found.values()) == Decimal("838000")
    for deal_id in found:
        assert not deal(result, deal_id)["in_forecast"]
        assert "Q1-2027" in deal(result, deal_id)["exclusion_reason"]


# --- D11 / D12 ----------------------------------------------------------------

def test_d11_and_d12_find_nothing_this_week(result):
    assert entries(result, "D11") == []
    assert entries(result, "D12") == []


def test_d11_flags_nonstandard_stage_probability(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, "Stage_Probability", "0.70")
    result = build(work_dir)
    (entry,) = entries(result, "D11")
    assert ids(entry) == {"006PF000001L020YAC"}
    assert entry.kind == FLAG
    assert entry.impact == 0
    assert entry.at_risk == Decimal("-30000")  # 300K x (0.70 - 0.80)
    assert deal(result, "006PF000001L020YAC")["in_forecast"]


def test_d11_flags_unknown_stage(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, "Stage", "Verbal Commit")
    (entry,) = entries(build(work_dir), "D11")
    assert "Verbal Commit" in entry.what_was_wrong


def test_d12_flags_fiscal_period_close_date_mismatch(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, "Close_Date", "2027-01-05")
    result = build(work_dir)
    (entry,) = entries(result, "D12")
    assert ids(entry) == {"006PF000001L020YAC"}
    assert entry.kind == FLAG
    assert entry.impact == 0
    assert entry.at_risk == Decimal("240000")  # counted in Q4 but closes in Q1
    assert deal(result, "006PF000001L020YAC")["in_forecast"]


# --- D13 ----------------------------------------------------------------------

def test_d13_fields_missing_from_hubspot(result):
    found = entries(result, "D13")
    assert len(found) == 3
    for column in ["Region", "Created_Date", "Days_In_Stage"]:
        assert any(column in e.what_was_wrong for e in found), column
    assert all(e.records[0]["source_file"] == HUBSPOT and e.impact == 0 for e in found)


@pytest.mark.parametrize("column", ["Region", "Sales_Rep", "Created_Date"])
def test_d13_blank_minor_field_is_a_note(work_dir, column):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, column, "")
    (entry,) = [e for e in entries(build(work_dir), "D13") if ids(e) == {"006PF000001L020YAC"}]
    assert entry.kind == NOTE
    assert column in entry.what_was_wrong


def test_d13_blank_customer_is_a_flag(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, "Health_System", "")
    result = build(work_dir)
    (entry,) = [e for e in entries(result, "D13") if ids(e) == {"006PF000001L020YAC"}]
    assert entry.kind == FLAG
    assert "duplicate" in entry.resolution
    assert deal(result, "006PF000001L020YAC")["in_forecast"]


def test_d6_never_matches_on_blank_names(work_dir):
    # M001 and HS-9001 match on product, ACV and close date; with both names blank
    # there is no evidence they are the same customer.
    m001_row = 30
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, m001_row, "Health_System", "")
    edit_csv_cell(work_dir / HUBSPOT, work_dir / HUBSPOT, 0, "Company_Name", "")
    result = build(work_dir)
    assert entries(result, "D6") == []
    assert deal(result, "006PF000001M001YAC")["customer"] is None


# --- SPEC 4.1: missing or invalid values ----------------------------------------

def test_set_aside_row_is_logged_for_review(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, "Amount", "abc")
    result = build(work_dir)
    (entry,) = entries(result, "4.1")
    assert entry.kind == NEEDS_REVIEW
    assert entry.records == [{"source_file": SF_CURRENT, "source_row": 2,
                              "deal_id": "006PF000001L020YAC", "customer": None}]
    assert "Amount" in entry.what_was_wrong and "abc" in entry.what_was_wrong
    assert entry.impact == 0


@pytest.mark.parametrize("column", ["Stage_Probability", "Fiscal_Period"])
def test_filled_value_logged_with_impact(work_dir, column):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, column, "")
    result = build(work_dir)
    (entry,) = entries(result, "4.1")
    assert entry.kind == FIX
    assert ids(entry) == {"006PF000001L020YAC"}
    assert entry.impact == Decimal("-240000")  # would be missing if the row were set aside
    assert deal(result, "006PF000001L020YAC")["in_forecast"]


def test_hubspot_product_filled_and_logged(work_dir):
    hs9006_row = 6  # CareBridge, $210K annual, 0.80
    edit_csv_cell(work_dir / HUBSPOT, work_dir / HUBSPOT, hs9006_row, "Product", "")
    result = build(work_dir)
    (entry,) = entries(result, "4.1")
    assert entry.kind == FIX
    assert entry.impact == Decimal("-168000")
    assert deal(result, "HS-9006")["product"] == "CareBridge"


def test_missing_stage_kept_needs_review(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, "Stage", "")
    result = build(work_dir)
    (entry,) = entries(result, "4.1")
    assert entry.kind == NEEDS_REVIEW
    assert entry.at_risk == Decimal("240000")
    assert deal(result, "006PF000001L020YAC")["in_forecast"]
    assert entries(result, "D11") == []  # no stage to compare


def test_missing_close_date_kept_and_flagged(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, "Close_Date", "")
    result = build(work_dir)
    (entry,) = entries(result, "4.1")
    assert entry.kind == FLAG
    assert entry.at_risk == Decimal("240000")
    assert deal(result, "006PF000001L020YAC")["in_forecast"]
    assert entries(result, "D12") == []
    assert len(entries(result, "D9")) == 4  # unchanged


def test_unreadable_minor_field_is_a_note(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_ROW, "Created_Date", "last spring")
    (entry,) = entries(build(work_dir), "4.1")
    assert entry.kind == NOTE
    assert entry.impact == 0


def test_vp_invalid_score_logged_as_not_a_top_deal(work_dir):
    edit_vp_cell(work_dir / VP, work_dir / VP, 0, "Leadership_Score", 7)
    (entry,) = entries(build(work_dir), "4.1")
    assert entry.records[0]["source_file"] == VP
    assert "not a Top deal" in entry.resolution
    assert "Longtail" in entry.resolution


def test_vp_sheet_notes_are_left_for_d5():
    note = RowIssue("3_vp_deal_scorecard.xlsx", 5, "X", "Composite_GPA", None,
                    "couldn't compare to sheet (blank)", Action.NOT_COMPARED, "Scores used")
    no_deals = pd.DataFrame(columns=DEAL_FIELDS, dtype=object)
    result = run_checks(no_deals, no_deals, no_deals, [note])
    assert result.audit == []
