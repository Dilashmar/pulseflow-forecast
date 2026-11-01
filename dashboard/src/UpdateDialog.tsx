import { useEffect, useRef, useState } from "react";

import { ApiError, ServerDown, applyUpdate, cancelUpdate, checkFiles, type CheckResult, type Slot, type UpdateStatus } from "./updateApi";
import { SERVER_DOWN, SLOTS, checklistView, defaultAsOf, slotSources } from "./uploadView";

interface UpdateDialogProps {
  open: boolean;
  onClose: () => void;
  status: UpdateStatus | null;
  dashboardAsOf: string;
}

/** Weekly update (SPEC 8.3): drop files, Check files, then Apply update or Cancel.
 *  A native <dialog>: focus stays inside, Esc closes, screen readers announce it. */
export function UpdateDialog({ open, onClose, status, dashboardAsOf }: UpdateDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({});
  const [asOf, setAsOf] = useState(defaultAsOf(status, dashboardAsOf));
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<"checking" | "applying" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Fresh form each time it opens.
      setFiles({});
      setAsOf(defaultAsOf(status, dashboardAsOf));
      setResult(null);
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, status, dashboardAsOf]);

  // Any change after a check means the check no longer applies.
  const choose = (slot: Slot, file: File | null) => {
    setFiles((f) => {
      const next = { ...f };
      if (file) next[slot] = file;
      else delete next[slot];
      return next;
    });
    setResult(null);
  };

  const fail = (e: unknown) => setError(e instanceof ServerDown ? SERVER_DOWN : e instanceof ApiError ? e.message : String(e));

  const check = async () => {
    setBusy("checking");
    setError(null);
    try {
      setResult(await checkFiles(files, asOf));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy("applying");
    try {
      await applyUpdate();
      window.location.reload(); // the dashboard reads the new output
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };

  // Cancel, ×, or Esc: discard any checked-but-not-applied update.
  const close = () => {
    if (result) cancelUpdate().catch(() => undefined);
    onClose();
  };

  const sources = slotSources(Object.fromEntries(Object.entries(files).map(([k, f]) => [k, f.name])), status);
  const view = result ? checklistView(result) : null;

  return (
    <dialog ref={ref} className="update-dialog" aria-labelledby="update-title"
      onCancel={(e) => { e.preventDefault(); close(); }}>
      <header className="update-header">
        <h2 id="update-title">Update data</h2>
        <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={close}>×</button>
      </header>
      <p className="update-intro">Add the files you have. Any slot you leave empty reuses last run's file.</p>

      <div className="drop-zones">
        {SLOTS.map((s) => (
          <DropZone key={s.key} label={s.label} file={files[s.key] ?? null} source={sources[s.key]}
            onChoose={(f) => choose(s.key, f)} />
        ))}
      </div>

      <label className="as-of-field">
        <span>As-of date</span>
        <input type="date" required value={asOf} onChange={(e) => { setAsOf(e.target.value); setResult(null); }} />
      </label>

      <div className="update-result" role="status" aria-live="polite">
        {error && <p className="update-error">{error}</p>}
        {view?.message && <p className="update-error">{view.message}</p>}
        {view?.summary && <p className="update-ok">{view.summary}</p>}
        {view && view.problems.length > 0 && (
          <ul className="update-problems">
            {view.problems.map((p) => (
              <li key={p.key} className={`problem-${p.tone}`}>
                <span aria-hidden="true">{p.icon}</span>
                <span className="visually-hidden">{p.tone === "stop" ? "Problem:" : "Warning:"}</span>{" "}
                <strong>{p.label}:</strong> {p.messages.join(" ")}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="update-actions">
        <button type="button" className="button" onClick={check} disabled={busy !== null || !asOf}>
          {busy === "checking" ? "Checking…" : "Check files"}
        </button>
        <span className="update-actions-right">
          <button type="button" className="button" onClick={close} disabled={busy === "applying"}>Cancel</button>
          <button type="button" className="button button-primary" onClick={apply}
            disabled={!view?.canApply || busy !== null} aria-describedby="apply-note">
            {busy === "applying" ? "Applying…" : "Apply update"}
          </button>
        </span>
      </footer>
      <p id="apply-note" className="apply-note">Applying reloads the dashboard; what-if changes are reset.</p>
    </dialog>
  );
}

interface DropZoneProps {
  label: string;
  file: File | null;
  source: string;
  onChoose: (file: File | null) => void;
}

/** One labeled slot: drop a file on it, or click (or Enter on the focused input) to browse. */
function DropZone({ label, file, source, onChoose }: DropZoneProps) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={["drop-zone", over && "over", file && "has-file"].filter(Boolean).join(" ")}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const dropped = e.dataTransfer.files[0];
        if (dropped) onChoose(dropped);
      }}
    >
      <label className="drop-label">
        <span className="drop-title">{label}</span>
        <span className="drop-hint">{file ? file.name : "Drop a file here, or click to browse"}</span>
        <input type="file" accept=".csv,.xlsx" className="visually-hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) onChoose(chosen);
            e.target.value = ""; // choosing the same file again still counts
          }} />
      </label>
      <p className="drop-source">{source}</p>
      {file && (
        <button type="button" className="link-button" aria-label={`Remove ${file.name} from ${label}`}
          onClick={() => onChoose(null)}>
          Remove
        </button>
      )}
    </div>
  );
}
