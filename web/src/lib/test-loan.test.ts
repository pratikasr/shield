import { describe, expect, it } from "vitest";
import { borrowForTarget } from "./test-loan";

// The testnet staging borrower (13 Oct 2026): 1 WETH at $2,513.02, WETH's 84% liquidation threshold, USDC at
// $0.99985508 on the market's oracle. Borrowing to 1.07 left $1,972.83812986 of debt on chain.
const COLLATERAL = 251_302_000_000n;
const LT = 8_400n;
const USDC = 99_985_508n;

describe("borrowForTarget", () => {
  it("borrows the USDC that brings the health factor to the target", () => {
    const units = borrowForTarget(COLLATERAL, 0n, LT, USDC, 10_700n);
    const debtBase = (units * USDC) / 1_000_000n;
    expect(Number(debtBase)).toBeCloseTo(197_283_812_986, -3);
    expect(Number((COLLATERAL * LT * 10_000n) / debtBase) / 1e4).toBeCloseTo(10_700, 0);
  });

  it("borrows only the difference when there is debt already", () => {
    const first = borrowForTarget(COLLATERAL, 0n, LT, USDC, 10_700n);
    const debt = (first * USDC) / 1_000_000n;
    const more = borrowForTarget(COLLATERAL, debt, LT, USDC, 10_500n);
    const all = borrowForTarget(COLLATERAL, 0n, LT, USDC, 10_500n);
    expect(Number(first + more)).toBeCloseTo(Number(all), -1);
  });

  it("borrows nothing at or below the target, or without a price", () => {
    const debt = (COLLATERAL * LT) / 10_500n;
    expect(borrowForTarget(COLLATERAL, debt, LT, USDC, 11_000n)).toBe(0n);
    expect(borrowForTarget(COLLATERAL, debt, LT, USDC, 10_500n)).toBe(0n);
    expect(borrowForTarget(COLLATERAL, 0n, LT, 0n, 11_000n)).toBe(0n);
    expect(borrowForTarget(0n, 0n, LT, USDC, 11_000n)).toBe(0n);
  });
});
