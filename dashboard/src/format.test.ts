import { describe, expect, it } from "vitest";

import { money, percent, signedMoney } from "./format";

describe("money (SPEC 6: under $1M as $K, $1M and over as $M)", () => {
  it.each([
    [13_182_400, "$13.18M"],
    [7_840_000, "$7.84M"],
    [12_000_000, "$12.00M"],
    [1_000_000, "$1.00M"],
    [1_005_000, "$1.01M"], // half up
    [992_400, "$992K"],
    [812_000, "$812K"],
    [999_400, "$999K"],
    [999_600, "$1.00M"], // would round to $1000K, so shown in $M
    [38_400, "$38K"],
    [0, "$0"],
    [-100_000, "−$100K"],
  ])("%d -> %s", (value, expected) => {
    expect(money(value)).toBe(expected);
  });
});

describe("signedMoney", () => {
  it.each([
    [1_182_400, "+$1.18M"],
    [550_000, "+$550K"],
    [-100_000, "−$100K"],
    [-1_500_000, "−$1.50M"],
    [0, "$0"],
  ])("%d -> %s", (value, expected) => {
    expect(signedMoney(value)).toBe(expected);
  });
});

describe("percent", () => {
  it("shows one decimal", () => {
    expect(percent(109.9)).toBe("109.9%");
    expect(percent(110)).toBe("110.0%");
  });
});
