import { describe, expect, it, vi } from "vitest";

import { ApiError, ServerDown, applyUpdate, cancelUpdate, checkFiles, getStatus, undoUpdate } from "./updateApi";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("calls to the update server (through Vite's /api proxy)", () => {
  it("status", async () => {
    const fetchFn = vi.fn(() => json({ as_of: "2026-10-15", can_undo: false, undone: false, pending: false }));
    expect(await getStatus(fetchFn)).toEqual({ as_of: "2026-10-15", can_undo: false, undone: false, pending: false });
    expect(fetchFn).toHaveBeenCalledWith("/api/status", undefined);
  });

  it("check sends the as-of date and only the chosen files", async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) => json({ ok: true, message: null, checklist: [], preview: null }));
    const file = new File(["Opportunity_ID\n"], "week_2_update.csv");
    await checkFiles({ sf_current: file }, "2026-10-22", fetchFn);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/check");
    expect(init?.method).toBe("POST");
    const body = init?.body as FormData;
    expect(body.get("as_of")).toBe("2026-10-22");
    expect((body.get("sf_current") as File).name).toBe("week_2_update.csv");
    expect(body.has("hubspot")).toBe(false);
  });

  it("apply, cancel and undo are POSTs", async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) => json({}));
    await applyUpdate(fetchFn);
    await cancelUpdate(fetchFn);
    await undoUpdate(fetchFn);
    expect(fetchFn.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/apply", "POST"], ["/api/cancel", "POST"], ["/api/undo", "POST"],
    ]);
  });

  it("the server's own error message is passed on", async () => {
    const fetchFn = vi.fn(() => json({ detail: "Already gone back" }, 409));
    await expect(undoUpdate(fetchFn)).rejects.toEqual(new ApiError("Already gone back"));
  });

  it("server not running: no connection, or the proxy's error page", async () => {
    await expect(getStatus(vi.fn(() => Promise.reject(new TypeError("fetch failed"))))).rejects.toBeInstanceOf(ServerDown);
    const proxyError = vi.fn(() => Promise.resolve(new Response("", { status: 500 })));
    await expect(getStatus(proxyError)).rejects.toBeInstanceOf(ServerDown);
  });
});
