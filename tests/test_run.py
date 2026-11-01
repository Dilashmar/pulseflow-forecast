"""End-to-end: `python pipeline/run.py --data <folder>` writes output/*.json (SPEC 7.1)."""

import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pytest

from pipeline import config
from pipeline.load import load_hubspot, load_salesforce, load_vp_scorecard
from pipeline.run import main
from tests.helpers import copy_fixtures, edit_vp_cell, read_rows, write_rows

REPO = Path(__file__).resolve().parents[1]
OUTPUT_FILES = ["forecast.json", "audit_log.json", "week_over_week.json"]
LAST_INPUTS = "last_inputs"
SF_CURRENT = config.FILES["sf_current"]
SF_PRIOR = config.FILES["sf_prior"]
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

def test_writes_three_files_and_a_copy_of_the_inputs(written, out_dir):
    assert sorted(p.name for p in out_dir.iterdir()) == sorted(OUTPUT_FILES + [LAST_INPUTS])


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


def test_excluded_deals_kept_with_reason_and_totals_unchanged(written):
    # Slipped, Closed Lost and D6 copies stay in forecast.json (the dashboard shows
    # them read-only) but add nothing: totals are the sum of the in-forecast deals.
    data = written["forecast.json"]
    excluded = [d for d in data["deals"] if not d["in_forecast"]]
    assert len(excluded) == 9
    assert all(d["exclusion_reason"] and d["bucket"] is None and d["expected_value"] == 0 for d in excluded)
    assert by_id(excluded, "006PF000001X002YAC")["exclusion_reason"] == "Outside Q4-2026 (Q1-2027)"
    assert by_id(excluded, "006PF000001M001YAC")["duplicate_of"] == "HS-9001"
    in_forecast = sum(d["expected_value"] for d in data["deals"] if d["in_forecast"])
    assert data["totals"]["formula"]["total"] == in_forecast == 13182400


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
    assert d5["title"] == "VP override"
    assert d5["kind"] == "Decision"
    assert d5["impact"] == 550000
    assert d5["reasoning"]
    assert d5["records"][0]["source_file"] == VP


def test_audit_titles_group_entries_in_plain_english(written):
    # The Data Audit tab groups entries by title (SPEC 6.4).
    entries = written["audit_log.json"]["entries"]
    assert Counter(e["title"] for e in entries) == {
        "Monthly billing converted to annual": 7,
        "Short Salesforce IDs matched": 6,
        "Outside the forecast quarter, left out": 5,
        "Past-due deals": 4,
        "VP rows matched by name": 4,
        "VP sheet matched by short ID": 4,
        "Columns missing from a file": 3,
        "Duplicate rows removed": 2,
        "Closed Lost deals left out": 2,
        "Conflicting versions, kept the latest": 1,
        "Duplicate across Salesforce and HubSpot": 1,
        "VP override": 1,
    }


def test_audit_actions_one_short_resolution_per_title(written):
    # The audit tab shows one resolution line per issue type (SPEC 6.4).
    entries = written["audit_log.json"]["entries"]
    actions = {}
    for e in entries:
        assert e["action"], e["title"]
        actions.setdefault(e["title"], set()).add(e["action"])
    assert all(len(found) == 1 for found in actions.values()), actions
    assert actions["Monthly billing converted to annual"] == {"Annual value = amount × 12"}
    assert actions["Duplicate rows removed"] == {"Kept one copy"}
    assert actions["VP rows matched by name"] == {"Matched on customer name, product and rep"}
    assert actions["Outside the forecast quarter, left out"] == {"Left out of the Q4-2026 forecast"}


def test_audit_titles_name_rules_not_deals(written):
    data = written["forecast.json"]
    names = {d["customer"] for d in data["deals"] if d["customer"]}
    ids = {d["deal_id"] for d in data["deals"]} | {d["match_key"] for d in data["deals"]}
    for e in written["audit_log.json"]["entries"]:
        assert not any(n in e["title"] for n in names | ids), e["title"]


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
    assert sorted(p.name for p in out.iterdir()) == sorted(OUTPUT_FILES + [LAST_INPUTS])


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


# --- --as-of: the date past-due is measured against --------------------------------

def test_as_of_defaults_to_config_and_is_printed_first(data_dir, out_dir, capsys):
    assert run(data_dir, out_dir) == 0
    assert capsys.readouterr().out.splitlines()[0] == "As of 2026-10-15 (from config.py)"


def test_as_of_option_moves_past_due(data_dir, out_dir, capsys):
    # As of 10-09 only Hyperion (closes 10-05) and HS-9004 (10-08) are past due: $360K + $72K.
    assert main(["--data", str(data_dir), "--out", str(out_dir), "--as-of", "2026-10-09"]) == 0
    assert capsys.readouterr().out.splitlines()[0] == "As of 2026-10-09 (from --as-of)"
    data = read(out_dir, "forecast.json")
    assert data["meta"]["as_of"] == "2026-10-09"
    assert sorted(d["deal_id"] for d in data["deals"] if "past_due" in d["flags"]) == ["006PF000001L001YAC", "HS-9004"]
    assert data["totals"]["formula"]["past_due_exposure"] == 432000
    assert data["totals"]["formula"]["total"] == 13182400  # past-due deals still count


def test_bad_as_of_stops_and_writes_nothing(data_dir, out_dir, capsys):
    assert main(["--data", str(data_dir), "--out", str(out_dir), "--as-of", "15/10/2026"]) == 1
    assert "--as-of" in capsys.readouterr().err
    assert not out_dir.exists()


def test_input_fingerprints_in_meta(written, data_dir):
    import hashlib
    fingerprints = written["forecast.json"]["meta"]["input_fingerprints"]
    assert fingerprints == {
        key: hashlib.sha256((data_dir / name).read_bytes()).hexdigest() for key, name in config.FILES.items()
    }


# --- Prior-week check: is the prior-week file last run's current file? ------------

def next_week(data_dir, last_week_dir, dst):
    """A following week: last week's current file becomes the prior week; one new deal this week."""
    copy_fixtures(data_dir, dst)
    shutil.copy(last_week_dir / SF_CURRENT, dst / SF_PRIOR)
    rows = read_rows(dst / SF_CURRENT)
    rows.append(["006PF000001N002YAC", "Q4-2026", "Northwind Regional", "BedFlow", "Introduction",
                 "0.20", "500000", "Annual", "2026-12-01", "2026-10-20", "2", "Clara Oswald", "West"])
    write_rows(dst / SF_CURRENT, rows)
    return dst


def test_no_warning_on_first_run_or_rerun(data_dir, out_dir, capsys):
    assert run(data_dir, out_dir) == 0
    assert run(data_dir, out_dir) == 0  # same week again
    assert "Warning" not in capsys.readouterr().err


def test_next_week_compares_neighbouring_weeks_without_warning(data_dir, tmp_path, out_dir, capsys):
    assert run(data_dir, out_dir) == 0
    week2 = next_week(data_dir, data_dir, tmp_path / "week2")
    assert run(week2, out_dir) == 0
    week3 = next_week(data_dir, week2, tmp_path / "week3")
    rows = read_rows(week3 / SF_CURRENT)
    rows[-1][rows[0].index("Stage")], rows[-1][rows[0].index("Stage_Probability")] = "Technical Validation", "0.40"
    write_rows(week3 / SF_CURRENT, rows)  # this week, Northwind moved up a stage
    assert run(week3, out_dir) == 0

    assert "Warning" not in capsys.readouterr().err
    counts = read(out_dir, "week_over_week.json")["counts"]
    # Week 3 against week 2: only the stage move, not week 2's new deal again.
    assert (counts["New Deals"], counts["Stage Moves"]) == (0, 1)


def test_warning_when_prior_week_file_was_not_replaced(data_dir, work_dir, out_dir, capsys):
    assert run(data_dir, out_dir) == 0
    rows = read_rows(work_dir / SF_CURRENT)
    rows.append(["006PF000001N002YAC", "Q4-2026", "Northwind Regional", "BedFlow", "Introduction",
                 "0.20", "500000", "Annual", "2026-12-01", "2026-10-20", "2", "Clara Oswald", "West"])
    write_rows(work_dir / SF_CURRENT, rows)  # new week's current file, but the old prior-week file left in place
    capsys.readouterr()

    assert run(work_dir, out_dir) == 0  # a warning, not a stop
    err = capsys.readouterr().err
    assert "Warning: the prior-week file" in err and SF_PRIOR in err
    assert read(out_dir, "forecast.json")["totals"]["formula"]["total"] == 13282400


# --- --current: next week from one file -----------------------------------------

NORTHWIND = ["006PF000001N002YAC", "Q4-2026", "Northwind Regional", "BedFlow", "Introduction",
             "0.20", "500000", "Annual", "2026-12-01", "2026-10-20", "2", "Clara Oswald", "West"]


def week_2_update(data_dir, path):
    """Next week's Salesforce export: one new deal (+$100K) and Alabaster Business Approval ->
    Contract Negotiations ($350K x 0.20 = +$70K)."""
    rows = read_rows(data_dir / SF_CURRENT)
    h = rows[0]
    for row in rows[1:]:
        if row[h.index("Health_System")] == "Alabaster Medical Center":
            row[h.index("Stage")], row[h.index("Stage_Probability")] = "Contract Negotiations", "0.80"
            row[h.index("Days_In_Stage")] = "1"
    write_rows(path, rows + [NORTHWIND])
    return path


def run_current(path, out_dir, *extra):
    return main(["--current", str(path), "--out", str(out_dir), *extra])


def test_each_run_keeps_a_copy_of_its_inputs(written, out_dir, data_dir):
    snapshot = out_dir / LAST_INPUTS
    assert sorted(p.name for p in snapshot.iterdir()) == sorted(config.FILES.values())
    for name in config.FILES.values():
        assert (snapshot / name).read_bytes() == (data_dir / name).read_bytes(), name


def test_current_runs_next_week_from_one_file(data_dir, tmp_path, out_dir, capsys):
    assert run(data_dir, out_dir) == 0
    update = week_2_update(data_dir, tmp_path / "week_2_update.csv")
    capsys.readouterr()

    assert run_current(update, out_dir, "--as-of", "2026-10-22") == 0
    assert "Warning" not in capsys.readouterr().err

    # Compared with last run's current file: only this week's two changes.
    wow = read(out_dir, "week_over_week.json")
    assert {k: v for k, v in wow["counts"].items() if v} == {"New Deals": 1, "Stage Moves": 1}
    (move,) = wow["changes"]["Stage Moves"]
    assert (move["customer"], move["ev_change"]) == ("Alabaster Medical Center", 70000)
    forecast = read(out_dir, "forecast.json")
    assert forecast["totals"]["formula"]["total"] == 13182400 + 100000 + 70000
    assert forecast["meta"]["as_of"] == "2026-10-22"

    # The copy now holds this run's inputs, ready for the week after.
    snapshot = out_dir / LAST_INPUTS
    assert (snapshot / SF_CURRENT).read_bytes() == update.read_bytes()
    assert (snapshot / SF_PRIOR).read_bytes() == (data_dir / SF_CURRENT).read_bytes()
    for key in ["vp_scorecard", "hubspot"]:
        name = config.FILES[key]
        assert (snapshot / name).read_bytes() == (data_dir / name).read_bytes(), name


def test_current_twice_in_a_row(data_dir, tmp_path, out_dir):
    assert run(data_dir, out_dir) == 0
    update = week_2_update(data_dir, tmp_path / "week_2_update.csv")
    assert run_current(update, out_dir) == 0
    week3 = tmp_path / "week_3_update.csv"
    rows = read_rows(update)
    rows[-1][rows[0].index("Stage")], rows[-1][rows[0].index("Stage_Probability")] = "Technical Validation", "0.40"
    write_rows(week3, rows)  # Northwind moves up: +$100K

    assert run_current(week3, out_dir) == 0
    wow = read(out_dir, "week_over_week.json")
    assert {k: v for k, v in wow["counts"].items() if v} == {"Stage Moves": 1}
    assert read(out_dir, "forecast.json")["totals"]["formula"]["total"] == 13182400 + 170000 + 100000


def test_current_needs_a_previous_run(data_dir, tmp_path, out_dir, capsys):
    update = week_2_update(data_dir, tmp_path / "week_2_update.csv")
    assert run_current(update, out_dir) == 1
    assert "run with --data first" in capsys.readouterr().err
    assert not out_dir.exists()


def test_current_file_not_found(data_dir, tmp_path, out_dir, capsys):
    assert run(data_dir, out_dir) == 0
    assert run_current(tmp_path / "missing.csv", out_dir) == 1
    assert "missing.csv" in capsys.readouterr().err


def test_current_with_wrong_columns_stops_and_keeps_last_week(data_dir, tmp_path, out_dir, capsys):
    assert run(data_dir, out_dir) == 0
    before = {name: (out_dir / name).read_bytes() for name in OUTPUT_FILES}
    bad = tmp_path / "week_2_update.csv"
    rows = read_rows(data_dir / SF_CURRENT)
    i = rows[0].index("Amount")
    write_rows(bad, [row[:i] + row[i + 1:] for row in rows])

    assert run_current(bad, out_dir) == 1
    err = capsys.readouterr().err
    assert "week_2_update.csv" in err and "Amount" in err
    assert {name: (out_dir / name).read_bytes() for name in OUTPUT_FILES} == before
    assert (out_dir / LAST_INPUTS / SF_CURRENT).read_bytes() == (data_dir / SF_CURRENT).read_bytes()


def test_data_and_current_cant_be_used_together(data_dir, tmp_path, out_dir):
    with pytest.raises(SystemExit):
        main(["--data", str(data_dir), "--current", str(tmp_path / "x.csv"), "--out", str(out_dir)])


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
