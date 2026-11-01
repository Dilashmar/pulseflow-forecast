"""End-to-end: `python pipeline/run.py --data <folder>` writes output/*.json (SPEC 7.1)."""

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from pipeline import config
from pipeline.load import load_hubspot, load_salesforce, load_vp_scorecard
from pipeline.run import main
from tests.helpers import copy_fixtures, edit_vp_cell, read_rows, write_rows

REPO = Path(__file__).resolve().parents[1]
OUTPUT_FILES = ["forecast.json", "audit_log.json", "week_over_week.json"]
SF_CURRENT = config.FILES["sf_current"]
VP = config.FILES["vp_scorecard"]
HALCYON_VP_ROW = 7


@pytest.fixture
def out_dir(tmp_path):
    return tmp_path / "output"


@pytest.fixture
def work_dir(data_dir, tmp_path):
    return copy_fixtures(data_dir, tmp_path / "data")


def run(data_dir, out_dir):
    return main(["--data", str(data_dir), "--out", str(out_dir)])


def read(out_dir, name):
    return json.loads((out_dir / name).read_text())


@pytest.fixture
def written(data_dir, out_dir):
    assert run(data_dir, out_dir) == 0
    return {name: read(out_dir, name) for name in OUTPUT_FILES}


def by_id(deals, deal_id):
    (deal,) = [d for d in deals if d["deal_id"] == deal_id]
    return deal


# --- forecast.json --------------------------------------------------------------

def test_writes_three_files(written, out_dir):
    assert sorted(p.name for p in out_dir.iterdir()) == sorted(OUTPUT_FILES)


def test_forecast_totals(written):
    totals = written["forecast.json"]["totals"]
    formula, vp = totals["formula"], totals["vp_override"]
    assert formula["top"] == 7840000
    assert formula["core_longtail"] == 4350000
    assert formula["carebridge_longtail"] == 992400
    assert formula["total"] == 13182400
    assert formula["variance"] == 1182400
    assert formula["percent_of_target"] == 109.9
    assert formula["past_due_exposure"] == 812000
    assert (formula["top_count"], formula["core_count"], formula["carebridge_count"]) == (8, 20, 10)
    assert vp["total"] == 13732400
    assert vp["variance"] == 1732400
    assert vp["percent_of_target"] == 114.4
    assert totals["vp_override_difference"] == 550000


def test_forecast_meta_and_settings(written):
    forecast = written["forecast.json"]
    assert forecast["meta"]["as_of"] == "2026-10-15"
    assert forecast["meta"]["forecast_quarter"] == "Q4-2026"
    assert forecast["meta"]["board_target"] == 12000000
    assert forecast["meta"]["ev_basis"] == "formula"
    settings = forecast["settings"]
    assert settings["gpa_weights"] == {"leadership": 20, "commercial": 20, "contractual": 60}
    assert settings["win_probability_cutoffs"] == [
        {"min_gpa_x100": 320, "probability": 0.75},
        {"min_gpa_x100": 240, "probability": 0.5},
        {"min_gpa_x100": 160, "probability": 0.3},
        {"min_gpa_x100": 0, "probability": 0.1},
    ]
    assert settings["product_lines"]["CareBridge"] == "Acquired CareBridge"
    assert settings["promote_scores"] == {"leadership": 3, "commercial": 3, "contractual": 3}
    assert settings["top_deal_limit"] == 8


def test_forecast_deals(written):
    deals = written["forecast.json"]["deals"]
    assert len(deals) == 47
    # Top deals first, in VP rank order; excluded deals last.
    assert [d["vp_rank"] for d in deals[:8]] == list(range(1, 9))
    assert all(d["bucket"] == "Longtail" for d in deals[8:38])
    assert all(d["bucket"] is None and d["expected_value"] == 0 for d in deals[38:])

    ironwood = by_id(deals, "006PF000001T005YAC")
    assert ironwood["gpa"] == 2.4
    assert ironwood["win_probability"] == 0.5
    assert ironwood["expected_value"] == 1100000
    assert ironwood["vp_win_probability"] == 0.75
    assert ironwood["vp_expected_value"] == 1650000
    assert ironwood["close_date"] == "2026-12-22"

    hs9001 = by_id(deals, "HS-9001")
    assert hs9001["region"] is None
    assert hs9001["flags"] == ["duplicate_merged"]
    assert by_id(deals, "HS-9005")["expected_value"] == 38400


# --- audit_log.json -------------------------------------------------------------

def test_audit_log(written):
    audit = written["audit_log.json"]
    entries = audit["entries"]
    assert audit["summary"]["entries"] == len(entries)
    assert audit["summary"]["by_check"]["D1"] == 2
    assert audit["summary"]["by_check"]["D9"] == 4
    assert audit["summary"]["total_impact_abs"] == sum(abs(e["impact"]) for e in entries)
    assert audit["summary"]["total_impact_net"] == sum(e["impact"] for e in entries)

    (d5,) = [e for e in entries if e["check"] == "D5"]
    assert d5["kind"] == "Decision"
    assert d5["impact"] == 550000
    assert d5["reasoning"]
    assert d5["records"][0]["source_file"] == VP


# --- week_over_week.json --------------------------------------------------------

def test_week_over_week(written):
    wow = written["week_over_week.json"]
    assert wow["ev_basis"] == "stage-based"
    assert wow["counts"] == {
        "New Deals": 4, "Copied from HubSpot": 1, "Slipped (out of Q4)": 3, "Pulled into Q4": 0,
        "Quarter changed (other)": 0, "Closed Lost": 2, "Stage Moves": 6, "ACV Changes": 4,
        "Missing from current": 0,
    }
    caledonia = by_id(wow["changes"]["ACV Changes"], "006PF000001L008YAC")
    assert (caledonia["acv_change"], caledonia["ev_change"]) == (150000, 120000)
    assert wow["couldnt_compare"] == []


# --- The command itself ---------------------------------------------------------

def test_script_runs_from_the_command_line(tmp_path):
    out = tmp_path / "output"
    completed = subprocess.run(
        [sys.executable, "pipeline/run.py", "--data", "tests/fixtures", "--out", str(out)],
        cwd=REPO, capture_output=True, text=True,
    )
    assert completed.returncode == 0, completed.stderr
    assert "13,182,400" in completed.stdout
    assert sorted(p.name for p in out.iterdir()) == sorted(OUTPUT_FILES)


def test_new_week_with_new_deal_and_changed_score(work_dir, out_dir):
    edit_vp_cell(work_dir / VP, work_dir / VP, HALCYON_VP_ROW, "Contractual_Score", 4)  # +800K Top
    rows = read_rows(work_dir / SF_CURRENT)
    rows.append(["006PF000001N001YAC", "Q4-2026", "Northwind Regional", "BedFlow", "Business Approval",
                 "0.60", "500000", "Annual", "2026-12-01", "2026-09-01", "5", "Clara Oswald", "West"])
    write_rows(work_dir / SF_CURRENT, rows)  # +300K Core

    assert run(work_dir, out_dir) == 0
    formula = read(out_dir, "forecast.json")["totals"]["formula"]
    assert formula["top"] == 8640000
    assert formula["core_longtail"] == 4650000
    assert formula["total"] == 14282400
    assert read(out_dir, "week_over_week.json")["counts"]["New Deals"] == 5


def test_missing_column_stops_and_writes_nothing(work_dir, out_dir, capsys):
    rows = read_rows(work_dir / SF_CURRENT)
    i = rows[0].index("Amount")
    write_rows(work_dir / SF_CURRENT, [row[:i] + row[i + 1:] for row in rows])

    assert run(work_dir, out_dir) == 1
    err = capsys.readouterr().err
    assert "1_sfdc_pipeline_current.csv" in err and "Amount" in err
    assert not out_dir.exists()


def test_failed_run_leaves_previous_output_untouched(data_dir, work_dir, out_dir):
    assert run(data_dir, out_dir) == 0
    before = {name: (out_dir / name).read_bytes() for name in OUTPUT_FILES}
    (work_dir / VP).write_text("not a workbook")

    assert run(work_dir, out_dir) == 1
    assert {name: (out_dir / name).read_bytes() for name in OUTPUT_FILES} == before


def test_missing_data_folder(tmp_path, out_dir, capsys):
    assert run(tmp_path / "nowhere", out_dir) == 1
    assert "nowhere" in capsys.readouterr().err
    assert not out_dir.exists()


def test_same_input_gives_identical_files(data_dir, tmp_path):
    first, second = tmp_path / "a", tmp_path / "b"
    assert run(data_dir, first) == 0
    assert run(data_dir, second) == 0
    for name in OUTPUT_FILES:
        assert (first / name).read_bytes() == (second / name).read_bytes(), name


# --- SPEC 7.1: no deal IDs or names in pipeline logic ---------------------------

def test_no_deal_ids_or_names_hard_coded(data_dir):
    sf = load_salesforce(data_dir / SF_CURRENT)
    prior = load_salesforce(data_dir / config.FILES["sf_prior"])
    hs = load_hubspot(data_dir / config.FILES["hubspot"])
    vp = load_vp_scorecard(data_dir / VP)
    ids = set(sf["Opportunity_ID"]) | set(prior["Opportunity_ID"]) | set(hs["HubSpot_Deal_ID"])
    ids |= {i[:15] for i in ids}
    names = set(sf["Health_System"]) | set(hs["Company_Name"]) | set(vp["Hospital_Shorthand_Name"])
    # Distinctive first words too, e.g. "Ironwood", "Aethelgard".
    names |= {n.split()[0] for n in names}

    for path in (REPO / "pipeline").glob("*.py"):
        source = path.read_text()
        assert not re.search(r"006PF|HS-\d", source), path.name
        found = [term for term in ids | names if re.search(rf"\b{re.escape(term)}\b", source)]
        assert found == [], f"{path.name}: {found}"
