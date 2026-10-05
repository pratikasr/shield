import { describe, expect, it } from "vitest";
import { formatUsd } from "./format";

describe("formatUsd", () => {
  it("is compact from $100,000 without padded decimals, on any ICU version", () => {
    expect(formatUsd(200_000)).toBe("$200K");
    expect(formatUsd(1_234_567)).toBe("$1.23M");
    expect(formatUsd(324_000_000)).toBe("$324M");
  });

  it("shows cents below $100,000 and two significant digits below a cent", () => {
    expect(formatUsd(99_999.5)).toBe("$99,999.50");
    expect(formatUsd(0.0000077)).toBe("$0.0000077");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
