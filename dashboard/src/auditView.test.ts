import { describe, expect, it } from "vitest";

import { auditView } from "./auditView";
import { audit, forecast } from "./data";
import type { AuditFile } from "./types";

const view = auditView(audit, forecast);
const groupSummary = (groups: typeof view.fixes) => groups.map((g) => [g.title, g.countText]);

describe("summary", () => {
  it("counts only, no dollar figure", () => {
    expect(view.summary).toBe("25 issues fixed automatically · 3 judgment calls need your attention");
  });

  it("every audit entry appears exactly once", () => {
    const shown = [...view.judgmentCalls, ...view.attention, ...view.fixes, ...view.notes]
      .reduce((sum, g) => sum + g.items.length, 0);
    expect(shown).toBe(audit.entries.length);
  });
});

describe("judgment calls: the only place with dollars", () => {
  it("one card per title, in check order", () => {
    expect(view.judgmentCalls.map((j) => [j.title, j.amount])).toEqual([
      ["VP override", "+$550K impact"],
      ["Duplicate across Salesforce and HubSpot", "+$144K impact"],
      ["Past-due deals", "$812K at risk"],
    ]);
  });

  it("each with the decision, the reasoning and its deals", () => {
    const [vp, , pastDue] = view.judgmentCalls;
    expect(vp.decision).toMatch(/^Formula used by default/);
    expect(vp.reasoning).toMatch(/^Every Top deal is scored by the same formula/);
    expect(vp.items.map((d) => [d.name, d.dealId])).toEqual([["Ironwood Clinical Center & Health System", "006PF000001T005YAC"]]);
    expect(pastDue.items.map((d) => [d.name?.split(" ")[0], d.amount])).toEqual([
      ["Hyperion", "$360K at risk"], ["Obsidian", "$180K at risk"], ["Valkyrie", "$200K at risk"], ["Zephyr", "$72K at risk"],
    ]);
  });
});

describe("fixed issues, grouped by title", () => {
  it("largest group first, with counts and no dollars", () => {
    expect(groupSummary(view.fixes)).toEqual([
      ["Monthly billing converted to annual", "7 deals"],
      ["Outside the forecast quarter, left out", "5 deals"],
      ["VP rows matched by name", "4 deals"],
      ["VP sheet matched by short ID", "4 deals"],
      ["Closed Lost deals left out", "2 deals"],
      ["Duplicate rows removed", "2 deals"],
      ["Conflicting versions, kept the latest", "1 deal"],
    ]);
    expect(view.fixes[0].items[0]).not.toHaveProperty("amount");
  });

  it("each deal: name, what was wrong, and a link to its panel", () => {
    expect(view.fixes[0].items[0]).toEqual({
      name: "Aethelgard Post-Acute Care", dealId: "HS-9001", detail: "Amount $15,000 is billed monthly",
    });
  });
});

describe("notes: no effect on the forecast, collapsed", () => {
  it("grouped the same way", () => {
    expect(groupSummary(view.notes)).toEqual([
      ["Short Salesforce IDs matched", "6 deals"],
      ["Columns missing from a file", "3 issues"],
    ]);
    expect(view.notesSummary).toBe("9 notes with no effect on the forecast");
  });

  it("an entry about a whole file has no deal to open", () => {
    expect(view.notes[1].items[0]).toEqual({ name: null, dealId: null, detail: "HubSpot has no Region column" });
  });
});

describe("needs a check (Needs review, Flag)", () => {
  it("none this week", () => {
    expect(view.attention).toEqual([]);
  });

  it("shown when present, and counted in the summary", () => {
    const flagged: AuditFile = {
      ...audit,
      entries: [...audit.entries, {
        ...audit.entries[0], check: "D2", kind: "Needs review", title: "Conflicting versions, latest unclear", impact: 0,
      }],
    };
    const v = auditView(flagged, forecast);
    expect(groupSummary(v.attention)).toEqual([["Conflicting versions, latest unclear", "1 deal"]]);
    expect(v.summary).toBe("25 issues fixed automatically · 3 judgment calls need your attention · 1 issue needs a check");
  });
});
