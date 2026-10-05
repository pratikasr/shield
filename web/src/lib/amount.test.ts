import { describe, expect, it } from "vitest";
import { amountText, centsUp, checkAmount, cleanAmountInput, normaliseAmount } from "./amount";

describe("amount fields", () => {
  it("reads one comma without a point as a decimal comma, and other commas as thousands", () => {
    expect(normaliseAmount("2,5")).toBe("2.5");
    expect(normaliseAmount("1,000.50")).toBe("1000.50");
    expect(normaliseAmount("1,000,000")).toBe("1000000");
    expect(cleanAmountInput("$1,2a3.4")).toBe("1,23.4");
  });

  it("parses in bigint units, so a 21-digit amount is a message and never a crash", () => {
    expect(checkAmount("25.5").units).toBe(25_500_000n);
    expect(checkAmount("").tone).toBe("muted");
    const huge = checkAmount("123456789012345678901", { balance: 10n ** 9n });
    expect(huge.ok).toBe(false);
    expect(huge.message).toMatch(/This wallet holds/);
    expect(checkAmount("0.0000001").message).toBe("The smallest amount is 0.000001 USDC.");
    expect(checkAmount("1.1234567").message).toMatch(/at most 6 digits/);
    expect(checkAmount("0").message).toBe("Enter more than 0.");
    expect(checkAmount("abc").message).toBe("Enter a number, like 25 or 25.50.");
  });

  it("checks the minimum and the available amount", () => {
    expect(checkAmount("0.5", { min: 1_000_000n }).ok).toBe(false);
    expect(checkAmount("5", { available: 4_000_000n }).message).toMatch(/Only \$4\.00 is available/);
    expect(checkAmount("5", { balance: 5_000_000n, min: 1_000_000n }).ok).toBe(true);
  });

  it("formats Max amounts exactly and rounds suggested prepay up to the cent", () => {
    expect(amountText(5_000_001n)).toBe("5.000001");
    expect(centsUp(4.001)).toBe(4_010_000n);
    expect(centsUp(0)).toBe(0n);
    expect(centsUp(Number.NaN)).toBe(0n);
  });
});
