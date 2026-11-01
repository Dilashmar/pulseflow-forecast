"""D4 (matching VP rows to Salesforce deals) and D5 (sheet vs formula)."""

from decimal import Decimal

import pytest

from pipeline import config
from pipeline.checks import DECISION, FIX, FLAG, NEEDS_REVIEW, NOTE
from pipeline.forecast import LONGTAIL, TOP
from pipeline.run import run_pipeline
from tests.helpers import copy_fixtures, edit_csv_cell, edit_vp_cell

SF_CURRENT = config.FILES["sf_current"]
VP = config.FILES["vp_scorecard"]

# VP data rows (0 = first row under the header, Excel row 5).
AETHELGARD = 0   # ID T001
SOLARIS = 1      # ID T002
IRONWOOD = 4     # no ID
BOREALIS = 5     # no ID
L020_SF_ROW = 0  # Borealis North Surgery Clinic, Kira Nerys


@pytest.fixture
def result(data_dir):
    return run_pipeline(data_dir)


@pytest.fixture
def work_dir(data_dir, tmp_path):
    return copy_fixtures(data_dir, tmp_path)


def entries(result, check):
    return [e for e in result.audit if e.check == check]


def deal(result, deal_id):
    match = result.deals[result.deals["deal_id"] == deal_id]
    assert len(match) == 1, deal_id
    return match.iloc[0]


def edit_vp(work_dir, row, column, value):
    edit_vp_cell(work_dir / VP, work_dir / VP, row, column, value)
    return run_pipeline(work_dir)


def matched_ids(entry):
    return {r["deal_id"] for r in entry.records if r["source_file"] == SF_CURRENT}


# --- D4 on this week's files -----------------------------------------------------

def test_d4_matches_rows_without_id_by_name_product_rep(result):
    found = entries(result, "D4")
    by_deal = {next(iter(matched_ids(e))): e for e in found}
    assert {k: e.impact for k, e in by_deal.items()} == {
        "006PF000001T005YAC": Decimal("660000"),  # Ironwood: 1.76M at stage - 1.10M as Top
        "006PF000001T006YAC": Decimal("160000"),  # Borealis Main Campus (not L020)
        "006PF000001T007YAC": Decimal("360000"),  # Starlight
        "006PF000001T008YAC": Decimal("200000"),  # Halcyon
    }
    assert all(e.kind == FIX for e in found)


def test_borealis_north_clinic_is_not_the_top_deal(result):
    assert deal(result, "006PF000001L020YAC")["bucket"] == LONGTAIL
    assert deal(result, "006PF000001T006YAC")["bucket"] == TOP


# --- D4 rules on modified copies -------------------------------------------------

def test_d4_no_id_and_no_match_needs_review(work_dir):
    result = edit_vp(work_dir, IRONWOOD, "Sales_Rep", "Someone Else")
    review = [e for e in entries(result, "D4") if e.kind == NEEDS_REVIEW]
    assert len(review) == 1
    assert deal(result, "006PF000001T005YAC")["bucket"] == LONGTAIL
    assert result.totals.top_count == 7


def test_d4_no_id_and_two_matches_needs_review(work_dir):
    # Give the North Surgery Clinic the same rep as Main Campus: "Borealis" + PulseOR + rep is now ambiguous.
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, L020_SF_ROW, "Sales_Rep", "Clara Oswald")
    result = run_pipeline(work_dir)
    review = [e for e in entries(result, "D4") if e.kind == NEEDS_REVIEW]
    assert len(review) == 1
    assert "2" in review[0].what_was_wrong
    assert deal(result, "006PF000001T006YAC")["bucket"] == LONGTAIL
    assert deal(result, "006PF000001L020YAC")["bucket"] == LONGTAIL


def test_d4_id_matches_nothing_needs_review(work_dir):
    result = edit_vp(work_dir, AETHELGARD, "Opportunity_ID_15", "006PF000001Z999")
    review = [e for e in entries(result, "D4") if e.kind == NEEDS_REVIEW]
    assert len(review) == 1
    assert deal(result, "006PF000001T001YAC")["bucket"] == LONGTAIL


def test_d4_18_character_id_still_matches(work_dir):
    result = edit_vp(work_dir, AETHELGARD, "Opportunity_ID_15", "006PF000001T001YAC")
    assert deal(result, "006PF000001T001YAC")["bucket"] == TOP
    assert result.totals.top == Decimal("7840000")


def test_d4_id_matches_deal_no_longer_active(work_dir):
    # Point the Aethelgard row at Fjordland (Q1-2027, PulseOR).
    result = edit_vp(work_dir, AETHELGARD, "Opportunity_ID_15", "006PF000001X001")
    (inactive,) = [e for e in entries(result, "D4") if "no longer active" in e.resolution]
    assert inactive.kind == FIX
    assert inactive.impact == Decimal("450000")  # 600K x 0.75 (GPA 3.40) would have been added
    assert deal(result, "006PF000001X001YAC")["bucket"] is None
    assert deal(result, "006PF000001T001YAC")["bucket"] == LONGTAIL


def test_d4_id_with_blank_product_uses_salesforce_product(work_dir):
    result = edit_vp(work_dir, AETHELGARD, "Product", None)
    assert deal(result, "006PF000001T001YAC")["bucket"] == TOP
    assert result.totals.top == Decimal("7840000")


def test_d4_id_with_different_product_needs_review(work_dir):
    result = edit_vp(work_dir, AETHELGARD, "Product", "BedFlow")
    review = [e for e in entries(result, "D4") if e.kind == NEEDS_REVIEW]
    assert len(review) == 1
    assert "BedFlow" in review[0].what_was_wrong
    assert deal(result, "006PF000001T001YAC")["bucket"] == LONGTAIL


def test_d4_id_with_different_rep_trusts_the_id(work_dir):
    result = edit_vp(work_dir, AETHELGARD, "Sales_Rep", "Someone Else")
    (note,) = [e for e in entries(result, "D4") if e.kind == NOTE]
    assert "Someone Else" in note.what_was_wrong
    assert note.impact == 0
    assert deal(result, "006PF000001T001YAC")["bucket"] == TOP


def test_d4_two_rows_for_the_same_deal(work_dir):
    # Blank the product too, or "product differs" (BedFlow vs PulseOR) would catch it first.
    edit_vp_cell(work_dir / VP, work_dir / VP, SOLARIS, "Product", None)
    result = edit_vp(work_dir, SOLARIS, "Opportunity_ID_15", "006PF000001T001")
    review = [e for e in entries(result, "D4") if e.kind == NEEDS_REVIEW]
    assert len(review) == 1
    assert "same deal" in review[0].what_was_wrong
    aethelgard = deal(result, "006PF000001T001YAC")
    assert aethelgard["bucket"] == TOP
    assert aethelgard["gpa"] == Decimal("3.40")  # the first row's scores
    assert deal(result, "006PF000001T002YAC")["bucket"] == LONGTAIL


def test_invalid_score_is_not_a_top_deal(work_dir):
    result = edit_vp(work_dir, 7, "Leadership_Score", 9)  # Halcyon
    halcyon = deal(result, "006PF000001T008YAC")
    assert halcyon["bucket"] == LONGTAIL
    assert halcyon["expected_value"] == Decimal("400000")  # 2.0M x 0.20 stage probability
    assert result.totals.top_count == 7


# --- D5 ------------------------------------------------------------------------

def test_d5_only_ironwood_override(result):
    (entry,) = entries(result, "D5")
    assert matched_ids(entry) == {"006PF000001T005YAC"}
    assert entry.kind == DECISION
    assert entry.impact == Decimal("550000")  # 2.2M x (0.75 - 0.50)
    assert entry.reasoning


def test_d5_gpa_only_mismatch_is_a_flag(work_dir):
    result = edit_vp(work_dir, AETHELGARD, "Composite_GPA", 3.5)
    (entry,) = entries(result, "D5")[:1]
    assert matched_ids(entry) == {"006PF000001T001YAC"}
    assert entry.kind == FLAG
    assert entry.impact == 0


def test_d5_sheet_gpa_rounded_half_up_before_comparing(work_dir):
    result = edit_vp(work_dir, AETHELGARD, "Composite_GPA", 3.395)  # rounds to 3.40
    assert [e for e in entries(result, "D5") if "006PF000001T001YAC" in matched_ids(e)] == []


def test_d5_blank_sheet_value_couldnt_compare(work_dir):
    result = edit_vp(work_dir, AETHELGARD, "Win_Probability", None)
    notes = [e for e in entries(result, "D5") if "couldn't compare" in e.what_was_wrong]
    assert len(notes) == 1
    assert notes[0].kind == FLAG
    aethelgard = deal(result, "006PF000001T001YAC")
    assert aethelgard["bucket"] == TOP
    assert aethelgard["vp_win_probability"] == Decimal("0.75")  # falls back to the formula
    assert result.totals_vp.total == Decimal("13732400")
