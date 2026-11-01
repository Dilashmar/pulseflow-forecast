// Calls to the weekly update server (server/app.py, SPEC 8). In development,
// Vite forwards /api/* to it (vite.config.ts), so there is no cross-origin setup.

export type Slot = "sf_current" | "sf_prior" | "hubspot" | "vp_scorecard";

export interface UpdateStatus {
  as_of: string | null; // null: no run yet (first run needs all four files)
  can_undo: boolean;
  undone: boolean; // went back; true until the next update is applied
  pending: boolean;
}

export interface ChecklistItem {
  slot: string; // a Slot, or "as_of"
  label: string;
  file: string | null;
  source: string | null;
  status: "ok" | "warn" | "stop";
  messages: string[];
}

export interface CheckResult {
  ok: boolean; // nothing stops: Apply is possible
  message: string | null; // e.g. "No new files. Nothing to update."
  checklist: ChecklistItem[];
  preview: Record<string, unknown> | null; // computed by the server; not shown (SPEC 8.6)
}

/** The server isn't running (no connection, or Vite's proxy couldn't reach it). */
export class ServerDown extends Error {
  constructor() {
    super("The update server isn't running");
  }
}

/** The server answered with an error of its own (e.g. 409 "Already gone back"). */
export class ApiError extends Error {}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const BASE = "/api";

export const getStatus = (fetchFn: FetchFn = fetch) => call<UpdateStatus>(fetchFn, "/status");

export function checkFiles(files: Partial<Record<Slot, File>>, asOf: string, fetchFn: FetchFn = fetch) {
  const body = new FormData();
  body.append("as_of", asOf);
  for (const [slot, file] of Object.entries(files)) {
    if (file) body.append(slot, file, file.name);
  }
  return call<CheckResult>(fetchFn, "/check", { method: "POST", body });
}

export const applyUpdate = (fetchFn: FetchFn = fetch) => call(fetchFn, "/apply", { method: "POST" });
export const cancelUpdate = (fetchFn: FetchFn = fetch) => call(fetchFn, "/cancel", { method: "POST" });
export const undoUpdate = (fetchFn: FetchFn = fetch) => call(fetchFn, "/undo", { method: "POST" });

async function call<T = unknown>(fetchFn: FetchFn, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(`${BASE}${path}`, init);
  } catch {
    throw new ServerDown();
  }
  const body = await response.json().catch(() => null);
  if (response.ok) return body as T;
  // Our server always explains its errors in "detail"; anything else is the proxy failing to reach it.
  if (body && typeof body.detail === "string") throw new ApiError(body.detail);
  throw new ServerDown();
}
