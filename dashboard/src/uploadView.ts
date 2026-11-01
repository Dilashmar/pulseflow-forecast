// What the weekly update dialog and the sidebar's Weekly update section show
// (SPEC 8.2, 8.3). Display logic only; the server does every check.

import type { CheckResult, Slot, UpdateStatus } from "./updateApi";

export const SLOTS: { key: Slot; label: string }[] = [
  { key: "sf_current", label: "This week's Salesforce" },
  { key: "sf_prior", label: "Last week's Salesforce" },
  { key: "hubspot", label: "HubSpot" },
  { key: "vp_scorecard", label: "VP scorecard" },
];

export const SERVER_DOWN =
  "The update server isn't running. Start it from the project folder: .venv/bin/uvicorn server.app:app --port 8000";

export interface Problem {
  key: string;
  icon: "⚠️" | "❌";
  tone: "warn" | "stop";
  label: string;
  messages: string[];
}

export interface ChecklistView {
  summary: string | null; // "✅ All files look good" when nothing needs saying
  message: string | null; // the server's own message (no new files, first run)
  problems: Problem[]; // only the ⚠️ / ❌ rows
  canApply: boolean;
}

/** Where each slot's file will come from, given the chosen file names (8.2). */
export function slotSources(chosen: Partial<Record<Slot, string>>, status: UpdateStatus | null): Record<Slot, string> {
  const sources = {} as Record<Slot, string>;
  for (const { key } of SLOTS) {
    const name = chosen[key];
    if (name) sources[key] = `New file: ${name}`;
    else if (!status?.as_of) sources[key] = "Needed for the first run";
    else if (key === "sf_prior" && chosen.sf_current) sources[key] = "Automatic: last run's this-week file";
    else sources[key] = `Reused (as of ${status.as_of})`;
  }
  return sources;
}

/** The current data's as-of date (editable in the dialog). */
export function defaultAsOf(status: UpdateStatus | null, dashboardAsOf: string): string {
  return status?.as_of ?? dashboardAsOf;
}

export function checklistView(result: CheckResult): ChecklistView {
  const problems: Problem[] = result.checklist
    .filter((i) => i.status !== "ok")
    .map((i) => ({
      key: i.slot,
      icon: i.status === "stop" ? "❌" : "⚠️",
      tone: i.status === "stop" ? "stop" : "warn",
      label: i.label,
      messages: i.messages,
    }));
  const allFine = result.ok && !result.message && problems.length === 0;
  return {
    summary: allFine ? "✅ All files look good" : null,
    message: result.message,
    problems,
    canApply: result.ok,
  };
}

/** "Go back to last week's data": a button when an update can be undone; a note once it has been. */
export function undoView(status: UpdateStatus | null): { button: boolean; note: string | null } {
  if (!status) return { button: false, note: null };
  return { button: status.can_undo, note: status.undone ? "Already gone back" : null };
}
