"""Weekly update server (SPEC 8): check files, preview, apply, cancel, undo.

Every test works in temporary folders: a previous run of the fixtures is set up
in a temp output/, and runs/ is a temp folder too. The real output/ is never touched.
"""

import json

import pytest
from fastapi.testclient import TestClient

from pipeline import config
from pipeline.run import main
from server.app import create_app
from tests.helpers import edit_vp_cell, read_rows, write_rows

SF_CURRENT = config.FILES["sf_current"]
SF_PRIOR = config.FILES["sf_prior"]
HUBSPOT = config.FILES["hubspot"]
VP = config.FILES["vp_scorecard"]
BASELINE_TOTAL = 13182400
NORTHWIND = ["006PF000001N002YAC", "Q4-2026", "Northwind Regional", "BedFlow", "Introduction",
             "0.20", "500000", "Annual", "2026-12-01", "2026-10-20", "2", "Clara Oswald", "West"]  # +$100K


@pytest.fixture
def out_dir(data_dir, tmp_path):
    """output/ after last week's run of the fixtures (as of 2026-10-15)."""
    out = tmp_path / "output"
    assert main(["--data", str(data_dir), "--out", str(out)]) == 0
    return out


@pytest.fixture
def runs_dir(tmp_path):
    return tmp_path / "runs"


@pytest.fixture
def client(out_dir, runs_dir):
    return TestClient(create_app(output_dir=out_dir, runs_dir=runs_dir))


@pytest.fixture
def week2(data_dir, tmp_path):
    """This week's Salesforce export: last week's file plus one new deal."""
    path = tmp_path / "week_2_update.csv"
    write_rows(path, read_rows(data_dir / SF_CURRENT) + [NORTHWIND])
    return path


def check(client, as_of="2026-10-22", **slots):
    files = {slot: (path.name, path.read_bytes()) for slot, path in slots.items()}
    response = client.post("/check", data={"as_of": as_of}, files=files)
    assert response.status_code == 200, response.text
    return response.json()


def slot(result, key):
    (item,) = [s for s in result["checklist"] if s["slot"] == key]
    return item


def total(out_dir):
    return json.loads((out_dir / "forecast.json").read_text())["totals"]["formula"]["total"]


def snapshot(out_dir):
    return {p.relative_to(out_dir): p.read_bytes() for p in sorted(out_dir.rglob("*")) if p.is_file()}


# --- 8.2 Which file goes in each slot -----------------------------------------------

def test_all_four_files(client, data_dir, week2, out_dir):
    result = check(client, sf_current=week2, sf_prior=data_dir / SF_CURRENT,
                   hubspot=data_dir / HUBSPOT, vp_scorecard=data_dir / VP)
    assert result["ok"]
    assert [s["source"] for s in result["checklist"][:4]] == ["New file"] * 4
    # HubSpot and VP are the same files as last run: reusing an unchanged file is normal, so no message.
    assert [(slot(result, k)["status"], slot(result, k)["messages"]) for k in ["hubspot", "vp_scorecard"]] == [("ok", [])] * 2
    preview = result["preview"]
    assert (preview["old_total"], preview["new_total"], preview["change"]) == (BASELINE_TOTAL, BASELINE_TOTAL + 100000, 100000)
    assert preview["new_deals"] == 1
    assert total(out_dir) == BASELINE_TOTAL  # a preview never touches output/


def test_this_week_only(client, week2):
    result = check(client, sf_current=week2)
    assert result["ok"]
    assert [slot(result, k)["source"] for k in ["sf_current", "sf_prior", "hubspot", "vp_scorecard"]] == [
        "New file", "Automatic", "Reused (as of 2026-10-15)", "Reused (as of 2026-10-15)",
    ]
    assert slot(result, "sf_prior")["file"] == "Last run's this-week file"
    # Compared with last run's this-week file: only the one new deal.
    assert (result["preview"]["new_deals"], result["preview"]["new_total"]) == (1, BASELINE_TOTAL + 100000)


def test_this_week_and_last_week(client, data_dir, week2):
    result = check(client, sf_current=week2, sf_prior=data_dir / SF_PRIOR)
    assert result["ok"]
    assert slot(result, "sf_prior")["source"] == "New file"
    # Compared with the original prior week: its 4 new deals plus Northwind.
    assert result["preview"]["new_deals"] == 5


def test_vp_only_keeps_last_runs_prior(client, data_dir, tmp_path):
    vp = tmp_path / VP
    edit_vp_cell(data_dir / VP, vp, 7, "Contractual_Score", 4)  # Halcyon 1 -> 4: +$800K
    result = check(client, vp_scorecard=vp)
    assert result["ok"]
    assert [slot(result, k)["source"] for k in ["sf_current", "sf_prior", "hubspot"]] == ["Reused (as of 2026-10-15)"] * 3
    preview = result["preview"]
    assert preview["new_total"] == BASELINE_TOTAL + 800000
    assert preview["new_deals"] == 4  # same weeks compared as last run


def test_first_run_needs_all_four_files(data_dir, tmp_path):
    client = TestClient(create_app(output_dir=tmp_path / "empty", runs_dir=tmp_path / "runs"))
    result = check(client, sf_current=data_dir / SF_CURRENT)
    assert not result["ok"]
    assert result["message"] == "First run: all four files are needed. Missing: Last week's Salesforce, HubSpot, VP scorecard."
    assert result["preview"] is None


def test_no_new_files(client):
    result = check(client)
    assert not result["ok"]
    assert result["message"] == "No new files. Nothing to update."


# --- 8.4 Checks: stop -----------------------------------------------------------------

def test_wrong_file_type(client, tmp_path):
    notes = tmp_path / "notes.txt"
    notes.write_text("hello")
    result = check(client, hubspot=notes)
    assert not result["ok"] and result["preview"] is None
    item = slot(result, "hubspot")
    assert item["status"] == "stop"
    assert item["messages"] == ["notes.txt isn't a .csv or .xlsx file."]


def test_missing_column(client, data_dir, tmp_path):
    bad = tmp_path / "week_2_update.csv"
    rows = read_rows(data_dir / SF_CURRENT)
    i = rows[0].index("Amount")
    write_rows(bad, [row[:i] + row[i + 1:] for row in rows])
    result = check(client, sf_current=bad)
    assert not result["ok"]
    item = slot(result, "sf_current")
    assert item["status"] == "stop"
    assert "week_2_update.csv" in item["messages"][0] and "Amount" in item["messages"][0]


def test_wrong_slot(client, data_dir):
    result = check(client, sf_current=data_dir / HUBSPOT, vp_scorecard=data_dir / SF_CURRENT)
    assert not result["ok"]
    assert slot(result, "sf_current")["messages"] == ["This looks like a HubSpot export. Put it in the HubSpot slot."]
    assert slot(result, "vp_scorecard")["messages"] == [
        "This looks like a Salesforce export. Put it in the This week's Salesforce slot."
    ]


# --- 8.4 Checks: warn -----------------------------------------------------------------

def test_same_file_twice_stops(client, week2):
    result = check(client, sf_current=week2, sf_prior=week2)
    assert not result["ok"] and result["preview"] is None
    item = slot(result, "sf_prior")
    assert item["status"] == "stop"
    assert item["messages"] == ["This week and last week are the same file, so What Changed would be empty."]


# --- Re-uploading the Salesforce file that is already loaded ---------------------------

ALREADY_LOADED = "This Salesforce file is already loaded, so it's treated as unchanged."


def test_reupload_of_current_salesforce_alone_is_nothing_new(client, data_dir):
    result = check(client, sf_current=data_dir / SF_CURRENT)  # last run's this-week file
    assert not result["ok"] and result["preview"] is None
    assert result["message"] == "Nothing new to update."
    item = slot(result, "sf_current")
    assert (item["status"], item["messages"]) == ("warn", [ALREADY_LOADED])


def test_reupload_of_current_salesforce_with_a_new_vp_file(client, data_dir, out_dir, tmp_path):
    # The incident: the Salesforce file was already loaded. It counts as unchanged, so last week's
    # file stays as it was (not "automatic"), and the new VP file still applies.
    vp = tmp_path / VP
    edit_vp_cell(data_dir / VP, vp, 7, "Contractual_Score", 4)  # Halcyon 1 -> 4: +$800K
    result = check(client, sf_current=data_dir / SF_CURRENT, vp_scorecard=vp)
    assert result["ok"]
    assert slot(result, "sf_current")["messages"] == [ALREADY_LOADED]
    assert slot(result, "sf_prior")["source"] == "Reused (as of 2026-10-15)"
    assert (result["preview"]["new_total"], result["preview"]["new_deals"]) == (BASELINE_TOTAL + 800000, 4)

    assert client.post("/apply").status_code == 200
    assert total(out_dir) == BASELINE_TOTAL + 800000
    assert (out_dir / "last_inputs" / SF_PRIOR).read_bytes() == (data_dir / SF_PRIOR).read_bytes()
    counts = json.loads((out_dir / "week_over_week.json").read_text())["counts"]
    assert (counts["New Deals"], counts["Stage Moves"]) == (4, 6)  # same weeks compared as before


def test_week_2_uploaded_twice(client, week2, out_dir):
    # Apply week 2, then upload the same file again: nothing new, What Changed keeps week 2's changes.
    assert check(client, sf_current=week2)["ok"]
    assert client.post("/apply").status_code == 200
    result = check(client, sf_current=week2)
    assert (result["ok"], result["message"]) == (False, "Nothing new to update.")
    assert json.loads((out_dir / "week_over_week.json").read_text())["counts"]["New Deals"] == 1


def test_unchanged_vp_only_is_nothing_new(client, data_dir):
    result = check(client, vp_scorecard=data_dir / VP)
    assert (result["ok"], result["message"]) == (False, "Nothing new to update.")
    assert slot(result, "vp_scorecard")["messages"] == []


def test_partial_file_warning(client, data_dir, tmp_path):
    partial = tmp_path / "week_2_update.csv"
    rows = read_rows(data_dir / SF_CURRENT)
    write_rows(partial, rows[: len(rows) // 2])  # about half of last week's deals gone
    result = check(client, sf_current=partial)
    assert result["ok"]
    item = slot(result, "sf_current")
    assert item["status"] == "warn"
    assert "partial export" in item["messages"][0]


def test_as_of_earlier_than_last_run(client, week2):
    result = check(client, as_of="2026-10-01", sf_current=week2)
    assert result["ok"]
    item = slot(result, "as_of")
    assert item["status"] == "warn"
    assert item["messages"] == ["2026-10-01 is earlier than the last run's date (2026-10-15)."]


def test_bad_as_of_date(client, week2):
    response = client.post("/check", data={"as_of": "22/10/2026"},
                           files={"sf_current": (week2.name, week2.read_bytes())})
    assert response.status_code == 400
    assert "2026-10-22" in response.json()["detail"]


# --- 8.3 / 8.5 Apply, cancel, undo ------------------------------------------------------

def test_cancel_leaves_output_unchanged(client, week2, out_dir):
    before = snapshot(out_dir)
    assert check(client, sf_current=week2)["ok"]
    assert client.post("/cancel").status_code == 200
    assert snapshot(out_dir) == before
    assert client.post("/apply").status_code == 409  # nothing left to apply


def test_apply_replaces_output_and_saves_the_run(client, week2, out_dir, runs_dir):
    assert check(client, sf_current=week2)["ok"]
    response = client.post("/apply")
    assert response.status_code == 200
    assert total(out_dir) == BASELINE_TOTAL + 100000
    assert (out_dir / "last_inputs" / SF_CURRENT).read_bytes() == week2.read_bytes()
    # Two run folders: the output it replaced, and the new run. Each holds the output and its inputs.
    runs = sorted(p.name for p in runs_dir.iterdir() if p.is_dir() and not p.name.startswith("."))
    assert len(runs) == 2 and all(r.startswith(("2026-10-15_", "2026-10-22_")) for r in runs)
    new_run = runs_dir / response.json()["run"]
    assert (new_run / "forecast.json").read_bytes() == (out_dir / "forecast.json").read_bytes()
    assert (new_run / "last_inputs" / SF_CURRENT).is_file()
    assert client.get("/status").json() == {"as_of": "2026-10-22", "can_undo": True, "undone": False, "pending": False}


def test_undo_restores_the_previous_run(client, week2, out_dir):
    before = snapshot(out_dir)
    assert check(client, sf_current=week2)["ok"]
    assert client.post("/apply").status_code == 200
    assert total(out_dir) == BASELINE_TOTAL + 100000

    assert client.post("/undo").status_code == 200
    assert snapshot(out_dir) == before
    status = client.get("/status").json()
    assert (status["can_undo"], status["undone"]) == (False, True)  # the button shows "Already gone back"
    response = client.post("/undo")  # one step only
    assert response.status_code == 409
    assert response.json()["detail"] == "Already gone back"


def test_status_before_any_update(client):
    assert client.get("/status").json() == {"as_of": "2026-10-15", "can_undo": False, "undone": False, "pending": False}


def test_new_check_replaces_the_pending_preview(client, data_dir, week2, out_dir, tmp_path):
    assert check(client, sf_current=week2)["preview"]["new_total"] == BASELINE_TOTAL + 100000
    vp = tmp_path / VP
    edit_vp_cell(data_dir / VP, vp, 7, "Contractual_Score", 4)
    assert check(client, vp_scorecard=vp)["ok"]
    assert client.post("/apply").status_code == 200
    assert total(out_dir) == BASELINE_TOTAL + 800000  # the second check's preview, not the first
