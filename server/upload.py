"""Weekly update (SPEC 8): check uploaded files, preview, apply, cancel, undo.

Wraps the existing pipeline: files are read with its loaders and the run uses
pipeline.run's functions. No forecast logic lives here.

Folders:
  output/                    the applied run (the dashboard reads it)
  output/last_inputs/        that run's 4 input files (kept by every pipeline run)
  runs/<as-of>_<time>/       every applied run: its output and last_inputs
  runs/.pending/             the one update being checked (8.3); cleared by apply or cancel
  runs/history.json          applied run folders in order, for undo (one step, 8.3)
"""

import hashlib
import json
import os
import shutil
from datetime import date, datetime
from pathlib import Path

from pipeline import config
from pipeline.load import InputError, load_hubspot, load_salesforce, load_vp_scorecard
from pipeline.run import LAST_INPUTS, OUTPUT_FILES, build_outputs, run_files, save_inputs, write_outputs
from pipeline.standardize import SALESFORCE_MATCH_KEY_LENGTH

SLOTS = ["sf_current", "sf_prior", "hubspot", "vp_scorecard"]  # keys match config.FILES
LABELS = {
    "sf_current": "This week's Salesforce",
    "sf_prior": "Last week's Salesforce",
    "hubspot": "HubSpot",
    "vp_scorecard": "VP scorecard",
}
# Which kind of export each slot takes, and how to name a kind (for "wrong slot").
SLOT_KIND = {"sf_current": "salesforce", "sf_prior": "salesforce", "hubspot": "hubspot", "vp_scorecard": "vp"}
KINDS = {
    "salesforce": (load_salesforce, "a Salesforce export", "sf_current"),
    "hubspot": (load_hubspot, "a HubSpot export", "hubspot"),
    "vp": (load_vp_scorecard, "the VP scorecard", "vp_scorecard"),
}
EXTENSIONS = {".csv", ".xlsx"}
PARTIAL_SHARE = 0.20  # more than this share of last week's deals missing -> possible partial export

OK, WARN, STOP = "ok", "warn", "stop"
ALREADY_LOADED = "This Salesforce file is already loaded, so it's treated as unchanged."


class UpdateError(Exception):
    status = 400


class Conflict(UpdateError):
    """The request doesn't fit the current state (nothing to apply, already gone back...)."""
    status = 409


class Updater:
    def __init__(self, output_dir, runs_dir):
        self.output_dir = Path(output_dir)
        self.runs_dir = Path(runs_dir)
        self.pending_dir = self.runs_dir / ".pending"
        self.history_file = self.runs_dir / "history.json"

    # --- State ------------------------------------------------------------------------

    def status(self):
        history = self._history()
        return {
            "as_of": self._meta(self.output_dir).get("as_of"),
            "can_undo": len(history["runs"]) >= 2 and not history["undone"],
            "undone": history["undone"],  # went back; stays true until the next update is applied
            "pending": (self.pending_dir / "preview.json").exists(),
        }

    def preview(self):
        path = self.pending_dir / "preview.json"
        if not path.exists():
            raise Conflict("No preview. Check files first.")
        return json.loads(path.read_text())

    # --- Check files, and preview when nothing stops (8.3, 8.4) ------------------------

    def check(self, uploads, as_of_text):
        """uploads: slot -> (file name, bytes), only for slots with a new file."""
        try:
            as_of = date.fromisoformat(as_of_text)
        except ValueError:
            raise UpdateError(f"As-of date must be a date like 2026-10-22 (got {as_of_text!r})") from None
        unknown = set(uploads) - set(SLOTS)
        if unknown:
            raise UpdateError(f"Unknown slot(s): {', '.join(sorted(unknown))}")

        self.cancel()  # one pending update at a time
        uploaded = self._save_uploads(uploads)
        last = self._last_inputs()
        last_as_of = self._meta(self.output_dir).get("as_of")
        reused = f"Reused (as of {last_as_of})"

        # 8.4 stops, per uploaded file.
        stops = {key: _stop_reason(key, path) for key, path in uploaded.items()}
        # Files identical to the current data in their slot aren't new. This week's Salesforce then
        # counts as not uploaded, so last week's file stays as it was instead of becoming "automatic".
        # (Last week's slot is left out: an uploaded last-week file is always a deliberate choice.)
        same = {key for key, path in uploaded.items()
                if last and key != "sf_prior" and not stops[key] and _sha(path) == _sha(last / config.FILES[key])}
        effective = {k: p for k, p in uploaded.items() if not (k == "sf_current" and k in same)}

        # 8.2: which file each slot uses, and where it came from.
        files, items = {}, {}
        for key in SLOTS:
            if key in effective:
                files[key], source, shown = effective[key], "New file", effective[key].name
            elif last is None:
                files[key], source, shown = None, "Missing", None
            elif key == "sf_prior" and "sf_current" in effective:
                files[key], source, shown = last / config.FILES["sf_current"], "Automatic", "Last run's this-week file"
            else:
                source_file = config.FILES["sf_prior" if key == "sf_prior" else key]
                files[key], source, shown = last / source_file, reused, f"Last run's {LABELS[key]} file"
            items[key] = {"slot": key, "label": LABELS[key], "file": shown, "source": source, "status": OK, "messages": []}

        message = None
        if not uploaded:
            message = "No new files. Nothing to update." if last else "First run: all four files are needed."
        elif last is None and len(uploaded) < len(SLOTS):
            missing = [LABELS[k] for k in SLOTS if k not in uploaded]
            message = f"First run: all four files are needed. Missing: {', '.join(missing)}."
            for k in SLOTS:
                if k not in uploaded:
                    items[k].update(status=STOP, messages=["Needed for the first run."])

        for key, stop in stops.items():
            if stop:
                items[key].update(status=STOP, messages=[stop])
        if "sf_current" in same:
            _warn(items["sf_current"], ALREADY_LOADED)

        # Compare this week's and last week's Salesforce files.
        sf_ok = all(files[k] and items[k]["status"] != STOP for k in ["sf_current", "sf_prior"])
        if sf_ok and ("sf_current" in effective or "sf_prior" in effective):
            if _sha(files["sf_current"]) == _sha(files["sf_prior"]):
                items["sf_prior"].update(status=STOP, messages=[
                    "This week and last week are the same file, so What Changed would be empty."])
            elif "sf_current" in effective:
                partial = _partial_warning(files["sf_current"], files["sf_prior"])
                if partial:
                    _warn(items["sf_current"], partial)

        as_of_item = {"slot": "as_of", "label": "As-of date", "file": None, "source": None,
                      "status": OK, "messages": [], "value": as_of.isoformat()}
        if last_as_of and as_of < date.fromisoformat(last_as_of):
            _warn(as_of_item, f"{as_of} is earlier than the last run's date ({last_as_of}).")

        checklist = [items[k] for k in SLOTS] + [as_of_item]
        stopped = any(i["status"] == STOP for i in checklist)
        if not message and not stopped and uploaded and set(uploaded) <= same:
            message = "Nothing new to update."
        result = {"ok": False, "message": message, "checklist": checklist, "preview": None}
        if message or stopped:
            return result

        names = {k: (path.name if k in effective else config.FILES[k]) for k, path in files.items()}
        try:
            result["preview"] = self._run_preview(files, names, as_of)
        except InputError as e:  # e.g. a reused file that can no longer be read
            result["message"] = str(e)
            return result
        result["ok"] = True
        return result

    def _run_preview(self, files, names, as_of):
        out = self.pending_dir / "output"
        run = run_files(files, as_of=as_of, names=names)
        write_outputs(build_outputs(run), out)
        save_inputs(files, out)

        new = json.loads((out / "forecast.json").read_text())
        wow = json.loads((out / "week_over_week.json").read_text())["changes"]
        audit = json.loads((out / "audit_log.json").read_text())["entries"]
        old = self._meta_totals(self.output_dir)
        new_total = new["totals"]["formula"]["total"]
        preview = {
            "as_of": as_of.isoformat(),
            "old_total": old,
            "new_total": new_total,
            "change": None if old is None else new_total - old,
            "new_deals": len(wow["New Deals"]),
            "slipped": len(wow["Slipped (out of Q4)"]),
            "closed_lost": len(wow["Closed Lost"]),
            "needs_review": sum(1 for e in audit if e["kind"] == "Needs review"),
        }
        (self.pending_dir / "preview.json").write_text(json.dumps(preview, indent=2))
        return preview

    # --- Apply, cancel, undo (8.3, 8.5) ---------------------------------------------------

    def apply(self):
        preview = self.preview()  # Conflict if there's nothing to apply
        history = self._history()
        if not history["runs"] and (self.output_dir / "forecast.json").exists():
            # First update: keep the output it replaces, so it can be undone.
            history["runs"].append(self._save_run(self.output_dir, self._meta(self.output_dir)["as_of"]))
        name = self._save_run(self.pending_dir / "output", preview["as_of"])
        self._restore(self.runs_dir / name)
        history["runs"].append(name)
        history["undone"] = False
        self._save_history(history)
        shutil.rmtree(self.pending_dir)
        return {"run": name, "as_of": preview["as_of"], "total": preview["new_total"]}

    def cancel(self):
        if self.pending_dir.exists():
            shutil.rmtree(self.pending_dir)
        return {"cancelled": True}

    def undo(self):
        history = self._history()
        if history["undone"]:
            raise Conflict("Already gone back")
        if len(history["runs"]) < 2:
            raise Conflict("Nothing to go back to")
        history["runs"].pop()
        self._restore(self.runs_dir / history["runs"][-1])
        history["undone"] = True
        self._save_history(history)
        return {"run": history["runs"][-1], "as_of": self._meta(self.output_dir).get("as_of")}

    # --- Helpers -------------------------------------------------------------------------

    def _save_uploads(self, uploads):
        paths = {}
        for key, (file_name, data) in uploads.items():
            folder = self.pending_dir / "uploads" / key
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / Path(file_name).name  # keep the user's file name for messages and the audit log
            path.write_bytes(data)
            paths[key] = path
        return paths

    def _last_inputs(self):
        last = self.output_dir / LAST_INPUTS
        return last if all((last / name).is_file() for name in config.FILES.values()) else None

    def _save_run(self, source_dir, as_of):
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        name = f"{as_of}_{datetime.now():%H%M%S}"
        candidate, n = name, 2
        while (self.runs_dir / candidate).exists():
            candidate, n = f"{name}-{n}", n + 1
        target = self.runs_dir / candidate
        target.mkdir()
        for file_name in OUTPUT_FILES:
            shutil.copy2(source_dir / file_name, target / file_name)
        shutil.copytree(source_dir / LAST_INPUTS, target / LAST_INPUTS)
        return candidate

    def _restore(self, run_dir):
        """Make output/ hold this run: the JSON files and its last_inputs."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        for file_name in OUTPUT_FILES:
            temp = self.output_dir / f".{file_name}.tmp"
            shutil.copy2(run_dir / file_name, temp)
            os.replace(temp, self.output_dir / file_name)
        temp_inputs = self.output_dir / f".{LAST_INPUTS}.tmp"
        if temp_inputs.exists():
            shutil.rmtree(temp_inputs)
        shutil.copytree(run_dir / LAST_INPUTS, temp_inputs)
        if (self.output_dir / LAST_INPUTS).exists():
            shutil.rmtree(self.output_dir / LAST_INPUTS)
        os.replace(temp_inputs, self.output_dir / LAST_INPUTS)

    def _history(self):
        if self.history_file.exists():
            return json.loads(self.history_file.read_text())
        return {"runs": [], "undone": False}

    def _save_history(self, history):
        self.history_file.write_text(json.dumps(history, indent=2))

    @staticmethod
    def _meta(folder):
        path = Path(folder) / "forecast.json"
        return json.loads(path.read_text())["meta"] if path.exists() else {}

    @staticmethod
    def _meta_totals(folder):
        path = Path(folder) / "forecast.json"
        return json.loads(path.read_text())["totals"]["formula"]["total"] if path.exists() else None


def _stop_reason(slot, path):
    """Why this file can't be used in this slot (8.4), or None."""
    if path.suffix.lower() not in EXTENSIONS:
        return f"{path.name} isn't a .csv or .xlsx file."
    loader = KINDS[SLOT_KIND[slot]][0]
    try:
        loader(path)
        return None
    except InputError as e:
        for kind, (other_loader, description, home_slot) in KINDS.items():
            if kind == SLOT_KIND[slot]:
                continue
            try:
                other_loader(path)
            except InputError:
                continue
            return f"This looks like {description}. Put it in the {LABELS[home_slot]} slot."
        return str(e)


def _partial_warning(current, prior):
    """More than PARTIAL_SHARE of last week's deals missing from this week's file."""
    keys = lambda path: {i[:SALESFORCE_MATCH_KEY_LENGTH] for i in load_salesforce(path)["Opportunity_ID"] if i}  # noqa: E731
    before, now = keys(prior), keys(current)
    missing = len(before - now)
    if before and missing / len(before) > PARTIAL_SHARE:
        return (f"{missing} of last week's {len(before)} deals ({missing / len(before):.0%}) are missing from "
                f"this week's file. Is it a partial export?")
    return None


def _warn(item, message):
    item["status"] = WARN if item["status"] == OK else item["status"]
    item["messages"].append(message)


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
