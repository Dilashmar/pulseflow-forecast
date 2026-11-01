"""SPEC section 5 / 7.2: week-over-week Salesforce changes, and D3 short IDs."""

from decimal import Decimal

import pytest

from pipeline import config
from pipeline.checks import FIX, FLAG, NOTE
from pipeline.run import run_pipeline
from pipeline.week_over_week import (
    ACV_CHANGES,
    CLOSED_LOST,
    COPIED,
    MISSING,
    NEW,
    PULLED_IN,
    QUARTER_OTHER,
    SLIPPED,
    STAGE_MOVES,
)
from tests.helpers import copy_fixtures, edit_csv_cell, read_rows, write_rows

SF_CURRENT = config.FILES["sf_current"]
SF_PRIOR = config.FILES["sf_prior"]

# Data row positions (0 = first row after the header).
ALABASTER_NOW = 10
PALISADES_NOW = 17      # L015, Technical Validation 0.40, $300K
FJORDLAND_NOW = 31      # X001, Q1-2027
FJORDLAND_BEFORE = 24   # X001, Q4-2026

SHORT_PRIOR_IDS = {"006PF000001L002", "006PF000001L008", "006PF000001L011",
                   "006PF000001L016", "006PF000001T002", "006PF000001T004"}


@pytest.fixture
def wow(data_dir):
    return run_pipeline(data_dir).week_over_week


@pytest.fixture
def work_dir(data_dir, tmp_path):
    return copy_fixtures(data_dir, tmp_path)


def ids(wow, category):
    return {c.deal_id for c in wow.changes[category]}


def change(wow, category, deal_id):
    (found,) = [c for c in wow.changes[category] if c.deal_id == deal_id]
    return found


# --- SPEC 7.2 -------------------------------------------------------------------

def test_new_deals(wow):
    assert ids(wow, NEW) == {
        "006PF000001L004YAC",  # Solstice Surgical
        "006PF000001L005YAC",  # Celestial Cancer Institute
        "006PF000001L006YAC",  # Verdant Valley
        "006PF000001L007YAC",  # Nebula Health Alliance
    }
    solstice = change(wow, NEW, "006PF000001L004YAC")
    assert solstice.before is None
    assert solstice.ev_change == Decimal("140000")  # 350K x 0.40
    assert solstice.ev_basis == "stage-based"


def test_copied_from_hubspot_is_not_new(wow):
    assert ids(wow, COPIED) == {"006PF000001M001YAC"}  # Aethelgard Post-Acute Care
    copied = change(wow, COPIED, "006PF000001M001YAC")
    assert "HS-9001" in copied.after
    assert copied.ev_change == 0


def test_short_prior_ids_match(wow):
    matched = {d[:15] for d in ids(wow, NEW) | ids(wow, MISSING)}
    assert not matched & SHORT_PRIOR_IDS


def test_slipped(wow):
    assert ids(wow, SLIPPED) == {"006PF000001X001YAC", "006PF000001X002YAC", "006PF000001X003YAC"}
    fjordland = change(wow, SLIPPED, "006PF000001X001YAC")
    assert (fjordland.before, fjordland.after) == ("Q4-2026", "Q1-2027")
    assert fjordland.ev_change == Decimal("-240000")  # 600K x 0.40 leaves Q4


def test_no_other_quarter_changes(wow):
    assert wow.changes[PULLED_IN] == []
    assert wow.changes[QUARTER_OTHER] == []


def test_closed_lost(wow):
    assert ids(wow, CLOSED_LOST) == {"006PF000001X004YAC", "006PF000001X005YAC"}
    sycamore = change(wow, CLOSED_LOST, "006PF000001X004YAC")
    assert (sycamore.before, sycamore.after) == ("Technical Validation", "Closed Lost")
    assert sycamore.ev_change == Decimal("-200000")  # 500K x 0.40
    assert change(wow, CLOSED_LOST, "006PF000001X005YAC").ev_change == Decimal("-260000")


def test_stage_moves(wow):
    labels = {c.deal_id: c.label for c in wow.changes[STAGE_MOVES]}
    assert labels == {
        "006PF000001L008YAC": "advanced",   # Caledonia
        "006PF000001L009YAC": "advanced",   # Alabaster
        "006PF000001T002YAC": "advanced",   # Solaris
        "006PF000001T004YAC": "advanced",   # Zephyr Valley System
        "006PF000001L010YAC": "regressed",  # Mirage State
        "006PF000001T006YAC": "regressed",  # Borealis Main Campus
    }
    caledonia = change(wow, STAGE_MOVES, "006PF000001L008YAC")
    assert (caledonia.before, caledonia.after) == ("Business Approval", "Contract Negotiations")
    assert caledonia.ev_change == Decimal("80000")  # (0.80 - 0.60) x last week's 400K


def test_acv_changes(wow):
    found = {c.deal_id: (c.label, c.acv_change) for c in wow.changes[ACV_CHANGES]}
    assert found == {
        "006PF000001L008YAC": ("expansion", Decimal("150000")),    # Caledonia
        "006PF000001L011YAC": ("expansion", Decimal("100000")),    # Polaris
        "006PF000001T002YAC": ("expansion", Decimal("400000")),    # Solaris
        "006PF000001L012YAC": ("contraction", Decimal("-100000")),  # Windward
    }
    caledonia = change(wow, ACV_CHANGES, "006PF000001L008YAC")
    assert (caledonia.before, caledonia.after) == ("$400,000", "$550,000")
    assert caledonia.ev_change == Decimal("120000")  # 150K x this week's 0.80
    assert change(wow, ACV_CHANGES, "006PF000001L012YAC").ev_change == Decimal("-60000")


def test_stage_and_acv_parts_add_up_to_the_real_change(wow):
    # Caledonia: 400K x 0.60 = 240K last week -> 550K x 0.80 = 440K this week.
    total = (change(wow, STAGE_MOVES, "006PF000001L008YAC").ev_change
             + change(wow, ACV_CHANGES, "006PF000001L008YAC").ev_change)
    assert total == Decimal("200000")


def test_missing_from_current_none(wow):
    assert wow.changes[MISSING] == []
    assert wow.couldnt_compare == []


def test_each_change_shows_customer_product_rep_and_bucket(wow):
    solaris = change(wow, STAGE_MOVES, "006PF000001T002YAC")
    assert solaris.customer.startswith("Solaris Medical System")
    assert solaris.product == "BedFlow"
    assert solaris.sales_rep == "Clara Oswald"
    assert solaris.bucket == "Top"


# --- D3 -------------------------------------------------------------------------

def test_d3_short_salesforce_ids_are_notes(data_dir):
    result = run_pipeline(data_dir)
    salesforce = [e for e in result.audit if e.check == "D3" and e.records[0]["source_file"] != config.FILES["vp_scorecard"]]
    assert {e.records[0]["deal_id"] for e in salesforce} == SHORT_PRIOR_IDS
    assert all(e.records[0]["source_file"] == SF_PRIOR for e in salesforce)
    assert all(e.kind == NOTE and e.impact == 0 for e in salesforce)


def test_d3_vp_short_ids_have_real_impact(data_dir):
    result = run_pipeline(data_dir)
    vp = [e for e in result.audit if e.check == "D3" and e.records[0]["source_file"] == config.FILES["vp_scorecard"]]
    impacts = {e.records[1]["deal_id"]: e.impact for e in vp}
    assert impacts == {
        "006PF000001T001YAC": Decimal("120000"),  # Aethelgard: 1.92M at stage - 1.80M as Top
        "006PF000001T002YAC": Decimal("150000"),  # Solaris
        "006PF000001T003YAC": Decimal("180000"),  # Vanguard
        "006PF000001T004YAC": Decimal("150000"),  # Zephyr
    }
    assert sum(impacts.values()) == Decimal("600000")
    assert all(e.kind == FIX for e in vp)


# --- Rules on modified copies ---------------------------------------------------

def test_deal_deleted_from_current_is_missing(work_dir):
    rows = read_rows(work_dir / SF_CURRENT)
    del rows[PALISADES_NOW + 1]
    write_rows(work_dir / SF_CURRENT, rows)
    wow = run_pipeline(work_dir).week_over_week
    assert ids(wow, MISSING) == {"006PF000001L015YAC"}
    assert change(wow, MISSING, "006PF000001L015YAC").ev_change == Decimal("-120000")


def test_row_set_aside_this_week_is_not_compared(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, PALISADES_NOW, "Amount", "abc")
    result = run_pipeline(work_dir)
    wow = result.week_over_week
    assert wow.changes[MISSING] == []
    assert [(c["deal_id"], c["week"]) for c in wow.couldnt_compare] == [("006PF000001L015YAC", "this week")]
    (flag,) = [e for e in result.audit if e.check == "WoW"]
    assert flag.kind == FLAG
    assert flag.at_risk == Decimal("120000")


def test_row_set_aside_last_week_is_not_new(work_dir):
    palisades_before = 11
    edit_csv_cell(work_dir / SF_PRIOR, work_dir / SF_PRIOR, palisades_before, "Amount", "abc")
    wow = run_pipeline(work_dir).week_over_week
    assert "006PF000001L015YAC" not in ids(wow, NEW)
    assert [(c["deal_id"], c["week"]) for c in wow.couldnt_compare] == [("006PF000001L015YAC", "last week")]


def test_row_with_missing_id_is_not_compared(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, PALISADES_NOW, "Opportunity_ID", "")
    wow = run_pipeline(work_dir).week_over_week
    # The blank-ID row can't be linked to anything; last week's Palisades is flagged missing.
    assert ids(wow, MISSING) == {"006PF000001L015YAC"}
    assert ids(wow, NEW) == {"006PF000001L004YAC", "006PF000001L005YAC",
                             "006PF000001L006YAC", "006PF000001L007YAC"}


def test_stage_outside_the_order_is_changed(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, ALABASTER_NOW, "Stage", "On Hold")
    wow = run_pipeline(work_dir).week_over_week
    assert change(wow, STAGE_MOVES, "006PF000001L009YAC").label == "changed"


def test_missing_stage_is_not_a_stage_move(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, ALABASTER_NOW, "Stage", "")
    wow = run_pipeline(work_dir).week_over_week
    assert "006PF000001L009YAC" not in ids(wow, STAGE_MOVES)


def test_flags_shown_alongside_without_changing_category(work_dir):
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, ALABASTER_NOW, "Close_Date", "2026-10-01")
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, ALABASTER_NOW, "Fiscal_Period", "Q4-2026")
    wow = run_pipeline(work_dir).week_over_week
    alabaster = change(wow, STAGE_MOVES, "006PF000001L009YAC")
    assert alabaster.label == "advanced"
    assert "past_due" in alabaster.flags


def test_pulled_into_q4(work_dir):
    edit_csv_cell(work_dir / SF_PRIOR, work_dir / SF_PRIOR, FJORDLAND_BEFORE, "Fiscal_Period", "Q1-2027")
    edit_csv_cell(work_dir / SF_PRIOR, work_dir / SF_PRIOR, FJORDLAND_BEFORE, "Close_Date", "2027-01-25")
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, FJORDLAND_NOW, "Fiscal_Period", "Q4-2026")
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, FJORDLAND_NOW, "Close_Date", "2026-12-15")
    wow = run_pipeline(work_dir).week_over_week
    pulled = change(wow, PULLED_IN, "006PF000001X001YAC")
    assert (pulled.before, pulled.after) == ("Q1-2027", "Q4-2026")
    assert pulled.ev_change == Decimal("240000")
    assert "006PF000001X001YAC" not in ids(wow, SLIPPED)


def test_other_quarter_change(work_dir):
    edit_csv_cell(work_dir / SF_PRIOR, work_dir / SF_PRIOR, FJORDLAND_BEFORE, "Fiscal_Period", "Q1-2027")
    edit_csv_cell(work_dir / SF_PRIOR, work_dir / SF_PRIOR, FJORDLAND_BEFORE, "Close_Date", "2027-01-25")
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, FJORDLAND_NOW, "Fiscal_Period", "Q2-2027")
    edit_csv_cell(work_dir / SF_CURRENT, work_dir / SF_CURRENT, FJORDLAND_NOW, "Close_Date", "2027-04-20")
    wow = run_pipeline(work_dir).week_over_week
    other = change(wow, QUARTER_OTHER, "006PF000001X001YAC")
    assert (other.before, other.after) == ("Q1-2027", "Q2-2027")
    assert other.ev_change == 0
