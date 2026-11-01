import { describe, expect, it } from "vitest";

import { audit, forecast } from "./data";
import { dealDetail } from "./dealDetail";
import { BASELINE, demote, promote, setScore, setVpOverride } from "./forecast";

const deal = (id: string) => forecast.deals.find((d) => d.deal_id === id)!;
const detail = (id: string, scenario = BASELINE) => dealDetail(deal(id), scenario, forecast, audit);

describe("Top deal: GPA written out", () => {
  it("Ironwood baseline", () => {
    const d = detail("006PF000001T005YAC");
    expect(d.isTop).toBe(true);
    expect(d.scores).toEqual({ leadership: 4, commercial: 2, contractual: 2 });
    expect(d.gpaLine).toBe("GPA = 0.20 × 4 + 0.20 × 2 + 0.60 × 2 = 2.40");
    expect(d.probabilityLine).toBe("2.40 is at least 2.40 → 50% win probability");
    expect(d.expectedValueLine).toBe("Expected value = $2.20M × 50% = $1.10M");
    expect(d.vpLine).toBe("VP sheet says 75% (+$550K). Not applied: the formula is the default.");
  });

  it("updates with an edit", () => {
    const starlight = setScore(BASELINE, deal("006PF000001T007YAC"), "contractual", 3);
    const d = detail("006PF000001T007YAC", starlight);
    expect(d.gpaLine).toBe("GPA = 0.20 × 2 + 0.20 × 2 + 0.60 × 3 = 2.60");
    expect(d.probabilityLine).toBe("2.60 is at least 2.40 → 50% win probability");
    expect(d.expectedValueLine).toBe("Expected value = $1.20M × 50% = $600K");
    expect(d.edited).toBe(true);
  });

  it("lowest band says 'below'", () => {
    expect(detail("006PF000001T008YAC").probabilityLine).toBe("1.20 is below 1.60 → 10% win probability"); // Halcyon
  });

  it("VP override applied, and not applied after an edit", () => {
    const on = detail("006PF000001T005YAC", setVpOverride(BASELINE, true));
    expect(on.vpLine).toBe("VP sheet says 75% (+$550K). Applied.");
    expect(on.expectedValueLine).toBe("Expected value = $2.20M × 75% = $1.65M");

    const edited = setVpOverride(setScore(BASELINE, deal("006PF000001T005YAC"), "contractual", 3), true);
    expect(detail("006PF000001T005YAC", edited).vpLine).toBe(
      "VP sheet says 75% (+$550K). Not applied: the scores were edited.",
    );
  });

  it("no VP line when the sheet agrees with the formula", () => {
    expect(detail("006PF000001T001YAC").vpLine).toBeNull();
  });
});

describe("Longtail deal", () => {
  it("stage probability explained", () => {
    const d = detail("006PF000001L020YAC");
    expect(d.isTop).toBe(false);
    expect(d.scores).toBeNull();
    expect(d.gpaLine).toBeNull();
    expect(d.probabilityLine).toBe("80% win probability: the stage probability for Contract Negotiations");
    expect(d.expectedValueLine).toBe("Expected value = $300K × 80% = $240K");
  });
});

describe("flags in plain words", () => {
  it("past due", () => {
    expect(detail("006PF000001L001YAC").flags).toEqual([{
      label: "Past due", tone: "danger",
      text: "Close date 2026-10-05 is before 2026-10-15 but the deal is still open. It's still counted, but its value is at risk.",
    }]);
  });

  it("merged duplicate names the Salesforce copy", () => {
    expect(detail("HS-9001").flags).toEqual([{
      label: "Merged duplicate", tone: "info",
      text: "This deal also appears in Salesforce as 006PF000001M001YAC. It's counted once, here.",
    }]);
  });

  it("edited", () => {
    const starlight = setScore(BASELINE, deal("006PF000001T007YAC"), "contractual", 3);
    expect(detail("006PF000001T007YAC", starlight).flags.map((f) => f.label)).toContain("Edited");
  });
});

describe("this deal's audit entries", () => {
  const checks = (id: string) => detail(id).auditEntries.map((e) => e.check).sort();

  it("Ironwood: D4 (matched by name) and D5 (VP override)", () => {
    expect(checks("006PF000001T005YAC")).toEqual(["D4", "D5"]);
  });

  it("HS-9001: D6 (cross-system duplicate) and D7 (monthly billing)", () => {
    expect(checks("HS-9001")).toEqual(["D6", "D7"]);
  });

  it("Caledonia: D2 (two versions) and D3 (short ID last week)", () => {
    expect(checks("006PF000001L008YAC")).toEqual(["D2", "D3"]);
  });

  it("formatted for display", () => {
    const d5 = detail("006PF000001T005YAC").auditEntries.find((e) => e.check === "D5")!;
    expect(d5.kind).toBe("Decision");
    expect(d5.impact).toBe("+$550K");
    expect(d5.reasoning).toBeTruthy();
  });

  it("a deal with no issues has none", () => {
    expect(detail("006PF000001L015YAC").auditEntries).toEqual([]);
  });
});

describe("promote / move to Longtail in the panel", () => {
  const settings = forecast.settings;

  it("a Longtail deal offers Promote to Top, starting at the promote scores", () => {
    const d = detail("006PF000001L013YAC"); // Kestrel
    expect(d.moveAction).toEqual({
      kind: "promote",
      label: "Promote to Top",
      note: "Starts at scores 3 / 3 / 3 (GPA 3.00 → 50%)",
    });
  });

  it("a Top deal offers Move to Longtail at its stage probability", () => {
    expect(detail("006PF000001T008YAC").moveAction).toEqual({ // Halcyon, Introduction 20%
      kind: "demote",
      label: "Move to Longtail",
      note: "Goes back to its stage probability (20% for Introduction)",
    });
  });

  it("after promotion: scores, GPA lines and a Promoted flag; the action becomes Move to Longtail", () => {
    const d = detail("006PF000001L013YAC", promote(BASELINE, deal("006PF000001L013YAC"), settings));
    expect(d.isTop).toBe(true);
    expect(d.scores).toEqual({ leadership: 3, commercial: 3, contractual: 3 });
    expect(d.gpaLine).toBe("GPA = 0.20 × 3 + 0.20 × 3 + 0.60 × 3 = 3.00");
    expect(d.expectedValueLine).toBe("Expected value = $500K × 50% = $250K");
    expect(d.flags.map((f) => f.label)).toContain("Promoted");
    expect(d.moveAction.kind).toBe("demote");
  });

  it("after demotion: stage probability and a Moved to Longtail flag", () => {
    const d = detail("006PF000001T008YAC", demote(BASELINE, deal("006PF000001T008YAC")));
    expect(d.isTop).toBe(false);
    expect(d.probabilityLine).toBe("20% win probability: the stage probability for Introduction");
    expect(d.flags.map((f) => f.label)).toContain("Moved to Longtail");
    expect(d.moveAction.kind).toBe("promote");
    expect(d.moveAction.note).toBe("Goes back to its VP scores 2 / 1 / 1 (GPA 1.20 → 10%)");
  });
});
