"""SPEC 7.2 expected results: Top Strategic Deals table and forecast totals."""

from decimal import Decimal

import pytest

from pipeline import config
from pipeline.forecast import LONGTAIL, TOP
from pipeline.run import run_pipeline
from tests.helpers import copy_fixtures, edit_vp_cell, read_rows, write_rows

SF_CURRENT = config.FILES["sf_current"]
VP = config.FILES["vp_scorecard"]
HALCYON_VP_ROW = 7


@pytest.fixture
def result(data_dir):
    return run_pipeline(data_dir)


@pytest.fixture
def work_dir(data_dir, tmp_path):
    return copy_fixtures(data_dir, tmp_path)


def deal(result, deal_id):
    match = result.deals[result.deals["deal_id"] == deal_id]
    assert len(match) == 1, deal_id
    return match.iloc[0]


def new_sf_row(deal_id, product):
    return [deal_id, "Q4-2026", "Northwind Regional", product, "Business Approval", "0.60",
            "500000", "Annual", "2026-12-01", "2026-09-01", "5", "Clara Oswald", "West"]


# --- Top Strategic Deals (formula default) ---------------------------------------

TOP_TABLE = [
    # deal_id,             scores,    GPA,    prob,   ACV,       expected value
    ("006PF000001T001YAC", (4, 4, 3), "3.40", "0.75", "2400000", "1800000"),  # Aethelgard Health System
    ("006PF000001T002YAC", (4, 3, 3), "3.20", "0.75", "3000000", "2250000"),  # Solaris Medical System
    ("006PF000001T003YAC", (3, 3, 3), "3.00", "0.50", "1800000", "900000"),   # Vanguard Meridian
    ("006PF000001T004YAC", (3, 3, 2), "2.40", "0.50", "1500000", "750000"),   # Zephyr Valley System
    ("006PF000001T005YAC", (4, 2, 2), "2.40", "0.50", "2200000", "1100000"),  # Ironwood Clinical Center
    ("006PF000001T006YAC", (3, 2, 1), "1.60", "0.30", "1600000", "480000"),   # Borealis - Main Campus
    ("006PF000001T007YAC", (2, 2, 2), "2.00", "0.30", "1200000", "360000"),   # Starlight Oncology
    ("006PF000001T008YAC", (2, 1, 1), "1.20", "0.10", "2000000", "200000"),   # Halcyon Medical Group
]


@pytest.mark.parametrize("deal_id, scores, gpa, prob, acv, ev", TOP_TABLE)
def test_top_deal_row(result, deal_id, scores, gpa, prob, acv, ev):
    row = deal(result, deal_id)
    assert row["bucket"] == TOP
    assert (row["leadership_score"], row["commercial_score"], row["contractual_score"]) == scores
    assert row["gpa"] == Decimal(gpa)
    assert row["win_probability"] == Decimal(prob)
    assert row["annual_acv"] == Decimal(acv)
    assert row["expected_value"] == Decimal(ev)


def test_top_total(result):
    assert result.totals.top == Decimal("7840000")
    assert result.totals.top_count == 8


# --- Forecast totals -------------------------------------------------------------

def test_formula_totals(result):
    t = result.totals
    assert (t.core_longtail, t.core_count) == (Decimal("4350000"), 20)
    assert (t.carebridge_longtail, t.carebridge_count) == (Decimal("992400"), 10)
    assert (t.other_longtail, t.other_count) == (0, 0)
    assert t.total == Decimal("13182400")
    assert t.target == Decimal("12000000")
    assert t.variance == Decimal("1182400")
    assert t.percent_of_target == Decimal("109.9")


def test_vp_override_totals(result):
    t = result.totals_vp
    assert t.top == Decimal("8390000")
    assert t.core_longtail == Decimal("4350000")
    assert t.carebridge_longtail == Decimal("992400")
    assert t.total == Decimal("13732400")
    assert t.variance == Decimal("1732400")
    assert t.percent_of_target == Decimal("114.4")
    assert result.totals_vp.total - result.totals.total == Decimal("550000")


def test_vp_override_values_on_deal(result):
    ironwood = deal(result, "006PF000001T005YAC")
    assert ironwood["vp_win_probability"] == Decimal("0.75")
    assert ironwood["vp_expected_value"] == Decimal("1650000")
    assert ironwood["vp_rank"] == 5
    assert ironwood["vp_notes"].startswith("COO verbally committed")


def test_past_due_exposure(result):
    assert result.totals.past_due_exposure == Decimal("812000")
    assert result.totals_vp.past_due_exposure == Decimal("812000")
    d9 = [e for e in result.audit if e.check == "D9"]
    assert sum(e.at_risk for e in d9) == Decimal("812000")


# --- Buckets ---------------------------------------------------------------------

def test_every_forecast_deal_in_exactly_one_bucket(result):
    deals = result.deals
    active = deals[deals["in_forecast"].astype(bool)]
    assert set(active["bucket"]) == {TOP, LONGTAIL}
    assert active["deal_id"].is_unique
    excluded = deals[~deals["in_forecast"].astype(bool)]
    assert excluded["bucket"].isna().all()
    assert (excluded["expected_value"] == 0).all()


def test_longtail_uses_stage_probability(result):
    north_clinic = deal(result, "006PF000001L020YAC")  # Borealis North Surgery Clinic: not the Top deal
    assert north_clinic["bucket"] == LONGTAIL
    assert north_clinic["product_line"] == "Core Salesforce"
    assert north_clinic["win_probability"] == Decimal("0.80")
    assert north_clinic["expected_value"] == Decimal("240000")
    hs9001 = deal(result, "HS-9001")
    assert hs9001["product_line"] == "Acquired CareBridge"
    assert hs9001["expected_value"] == Decimal("144000")


# --- New weekly data works without code changes ---------------------------------

def test_changed_score_flows_through(work_dir):
    edit_vp_cell(work_dir / VP, work_dir / VP, HALCYON_VP_ROW, "Contractual_Score", 4)  # 2/1/4 -> 3.00
    result = run_pipeline(work_dir)
    halcyon = deal(result, "006PF000001T008YAC")
    assert halcyon["gpa"] == Decimal("3.00")
    assert halcyon["win_probability"] == Decimal("0.50")
    assert halcyon["expected_value"] == Decimal("1000000")
    assert result.totals.top == Decimal("8640000")
    assert result.totals.total == Decimal("13982400")


def test_new_deal_flows_through(work_dir):
    rows = read_rows(work_dir / SF_CURRENT)
    rows.append(new_sf_row("006PF000001N001YAC", "BedFlow"))
    write_rows(work_dir / SF_CURRENT, rows)
    result = run_pipeline(work_dir)
    assert result.totals.core_longtail == Decimal("4650000")
    assert result.totals.core_count == 21
    assert result.totals.total == Decimal("13482400")


def test_unknown_product_counts_under_other_and_is_flagged(work_dir):
    rows = read_rows(work_dir / SF_CURRENT)
    rows.append(new_sf_row("006PF000001N002YAC", "SurgiSync"))
    write_rows(work_dir / SF_CURRENT, rows)
    result = run_pipeline(work_dir)
    assert (result.totals.other_longtail, result.totals.other_count) == (Decimal("300000"), 1)
    assert result.totals.total == Decimal("13482400")
    flagged = [e for e in result.audit if "SurgiSync" in e.what_was_wrong]
    assert len(flagged) == 1
    assert flagged[0].at_risk == Decimal("300000")
