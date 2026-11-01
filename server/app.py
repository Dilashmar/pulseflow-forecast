"""Local server for the weekly update (SPEC 8). Run from the project folder:

    uvicorn server.app:app --port 8000

Endpoints: GET /status, POST /check (files + as-of date; previews when nothing
stops), GET /preview, POST /apply, POST /cancel, POST /undo. The logic is in
server/upload.py; this file only maps HTTP to it.
"""

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from server.upload import Updater, UpdateError

ROOT = Path(__file__).resolve().parents[1]


def create_app(output_dir=ROOT / "output", runs_dir=ROOT / "runs"):
    updater = Updater(output_dir, runs_dir)
    app = FastAPI(title="PulseFlow weekly update")

    def call(action, *args):
        try:
            return action(*args)
        except UpdateError as e:
            raise HTTPException(status_code=e.status, detail=str(e)) from e

    @app.get("/status")
    def status():
        return updater.status()

    @app.post("/check")
    async def check(
        as_of: str = Form(...),
        sf_current: UploadFile | None = File(None),
        sf_prior: UploadFile | None = File(None),
        hubspot: UploadFile | None = File(None),
        vp_scorecard: UploadFile | None = File(None),
    ):
        files = {"sf_current": sf_current, "sf_prior": sf_prior, "hubspot": hubspot, "vp_scorecard": vp_scorecard}
        uploads = {key: (f.filename, await f.read()) for key, f in files.items() if f is not None and f.filename}
        return call(updater.check, uploads, as_of)

    @app.get("/preview")
    def preview():
        return call(updater.preview)

    @app.post("/apply")
    def apply():
        return call(updater.apply)

    @app.post("/cancel")
    def cancel():
        return call(updater.cancel)

    @app.post("/undo")
    def undo():
        return call(updater.undo)

    return app


app = create_app()
