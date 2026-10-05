import { describe, expect, it } from "vitest";
import {
  YEARS_24H,
  YEARS_7D,
  anchoredModel,
  formatChance,
  healthFactor,
  healthFactorAfterMove,
  hfAtMove,
  moveForHf,
  moveModel,
  normalCdf,
  simulateMove,
  touchProbability,
  type HfReserve,
  type SimulationInput,
} from "./risk-math";

const usdcDebt = (usd: number): HfReserve => ({ supplied: 0, borrowed: usd, priceUsd: 1, liquidationThreshold: 0.78 });

/** 1 WETH at $4,000 with LT 0.84 against 3,000 USDC: HF = 4,000 x 0.84 / 3,000 = 1.12. */
const oneWeth: HfReserve[] = [{ supplied: 1, borrowed: 0, priceUsd: 4000, liquidationThreshold: 0.84 }, usdcDebt(3000)];

/** Plus 0.05 cbBTC at $100,000 with LT 0.78 and 6,000 USDC: HF = (3,360 + 3,900) / 6,000 = 1.21. */
const twoCollateral: HfReserve[] = [
  { supplied: 1, borrowed: 0, priceUsd: 4000, liquidationThreshold: 0.84 },
  { supplied: 0.05, borrowed: 0, priceUsd: 100_000, liquidationThreshold: 0.78 },
  usdcDebt(6000),
];

const exitParams = { discountBps: 100, hfBuffer: 0.06 };

function input(reserves: HfReserve[], trigger?: number): SimulationInput {
  const weth = reserves[0]!;
  return {
    model: moveModel(reserves, 0),
    priceUsd: weth.priceUsd,
    suppliedUsd: weth.supplied * weth.priceUsd,
    liquidationThreshold: weth.liquidationThreshold,
    bonus: 1.055,
    usdcDebtUsd: reserves.reduce((s, r) => (r.priceUsd === 1 ? s + r.borrowed : s), 0),
    trigger,
    ...exitParams,
  };
}

describe("health factor, computed as Aave does", () => {
  it("one WETH collateral against USDC debt", () => {
    expect(healthFactor(oneWeth)).toBeCloseTo(1.12, 12);
    // WETH -10%: 3,600 x 0.84 / 3,000 = 1.008.
    expect(healthFactorAfterMove(oneWeth, 0, -0.1)).toBeCloseTo(1.008, 12);
    // WETH +25%: 5,000 x 0.84 / 3,000 = 1.4.
    expect(healthFactorAfterMove(oneWeth, 0, 0.25)).toBeCloseTo(1.4, 12);
  });

  it("two collateral reserves: only the moved one changes", () => {
    expect(healthFactor(twoCollateral)).toBeCloseTo(1.21, 12);
    // WETH -20%: (3,200 x 0.84 + 3,900) / 6,000 = 6,588 / 6,000 = 1.098.
    expect(healthFactorAfterMove(twoCollateral, 0, -0.2)).toBeCloseTo(1.098, 12);
    // cbBTC -10%: (3,360 + 4,500 x 0.78) / 6,000 = 6,870 / 6,000 = 1.145.
    expect(healthFactorAfterMove(twoCollateral, 1, -0.1)).toBeCloseTo(1.145, 12);
  });

  it("leaves out supply that is not collateral, and has no health factor without debt", () => {
    const off: HfReserve[] = [...twoCollateral.slice(0, 1), { ...twoCollateral[1]!, collateral: false }, usdcDebt(6000)];
    expect(healthFactor(off)).toBeCloseTo(3360 / 6000, 12);
    expect(healthFactor([oneWeth[0]!])).toBe(Number.POSITIVE_INFINITY);
  });

  it("moves debt held in the moved asset too", () => {
    // 2 WETH collateral (6,720 weighted), 0.5 WETH and 2,000 USDC debt (4,000): HF 1.68.
    const r: HfReserve[] = [{ supplied: 2, borrowed: 0.5, priceUsd: 4000, liquidationThreshold: 0.84 }, usdcDebt(2000)];
    expect(healthFactor(r)).toBeCloseTo(1.68, 12);
    // WETH +10%: 7,392 / (2,200 + 2,000) = 1.76.
    expect(healthFactorAfterMove(r, 0, 0.1)).toBeCloseTo(1.76, 12);
    expect(hfAtMove(moveModel(r, 0), 0.1)).toBeCloseTo(1.76, 12);
  });

  it("the straight-line model matches a full recomputation at every move", () => {
    const model = moveModel(twoCollateral, 0);
    for (let m = -0.3; m <= 0.3; m += 0.05) expect(hfAtMove(model, m)).toBeCloseTo(healthFactorAfterMove(twoCollateral, 0, m), 12);
  });

  it("anchors to the health factor Aave reports", () => {
    // Aave says 1.119 (say a small supply is switched off as collateral); the move of 0 must read exactly that.
    const model = anchoredModel({ healthFactor: 1.119, debtUsd: 3000, movedSuppliedUsd: 4000, movedBorrowedUsd: 0, liquidationThreshold: 0.84 });
    expect(hfAtMove(model, 0)).toBeCloseTo(1.119, 12);
    expect(hfAtMove(model, -0.1)).toBeCloseTo((1.119 * 3000 - 336) / 3000, 12);
  });
});

describe("price simulator thresholds", () => {
  it("finds the moves where the exit fires and Aave can liquidate", () => {
    const model = moveModel(oneWeth, 0);
    // Exit at 1.05: 1.05 x 3,000 / 3,360 - 1 = -6.25%, WETH $3,750.
    expect(moveForHf(model, 1.05)).toBeCloseTo(-0.0625, 12);
    // Liquidation at 1.00: 3,000 / 3,360 - 1 = -10.714%, WETH $3,571.43.
    expect(moveForHf(model, 1)).toBeCloseTo(3000 / 3360 - 1, 12);
    // No price at or above zero takes a position with no WETH to any health factor.
    expect(moveForHf(moveModel([usdcDebt(10), { ...oneWeth[0]!, supplied: 0 }], 1), 1)).toBeNaN();
  });

  it("reports above the trigger, at the trigger, and below 1.00 on either side of each threshold", () => {
    const sim = (m: number) => simulateMove(input(oneWeth, 1.05), m);
    const above = sim(-0.06); // HF 1.0528
    expect(above.exitFires).toBe(false);
    expect(above.liquidatable).toBe(false);
    expect(above.shield).toBeUndefined();
    expect(above.aave).toBeUndefined();

    const atTrigger = sim(-0.0625); // HF exactly 1.05: the Executor allows the exit at or below the trigger
    expect(atTrigger.healthFactor).toBeCloseTo(1.05, 12);
    expect(atTrigger.exitFires).toBe(true);
    expect(atTrigger.liquidatable).toBe(false);

    const justAboveOne = sim(-0.1); // HF 1.008
    expect(justAboveOne.exitFires).toBe(true);
    expect(justAboveOne.liquidatable).toBe(false);

    const below = sim(-0.11); // HF 3,560 x 0.84 / 3,000 = 0.9968
    expect(below.healthFactor).toBeCloseTo(0.99680, 5);
    expect(below.liquidatable).toBe(true);
    expect(below.exitFires).toBe(true);
  });

  it("prices Aave's penalty at the simulated price, with the half-debt cap above 0.95 only", () => {
    // HF 0.9968, $3,000 debt and $3,560 collateral, both at least $2,000: half the debt, 1,500 x 5.5% = 82.50.
    const near = simulateMove(input(oneWeth, 1.05), -0.11).aave!;
    expect(near.basis).toBe("half");
    expect(near.penaltyUsd).toBeCloseTo(82.5, 9);
    // WETH -20%: HF 0.896, at or below 0.95, so all 3,000 USDC: 3,000 x 5.5% = 165.
    const deep = simulateMove(input(oneWeth, 1.05), -0.2).aave!;
    expect(deep.basis).toBe("all");
    expect(deep.penaltyUsd).toBeCloseTo(165, 9);
  });

  it("sizes Shield's exit at the trigger and restores trigger plus buffer there", () => {
    const s = simulateMove(input(oneWeth, 1.05), -0.0625).shield!;
    // r = 3,000 x (1.11 - 1.05) / (1.11 - 1.01 x 0.84) = 180 / 0.2616 = 688.07; cost 1% of that.
    expect(s.repayUsd).toBeCloseTo(180 / 0.2616, 9);
    expect(s.costUsd).toBeCloseTo(1.8 / 0.2616, 9);
    expect(s.priceUsd).toBeCloseTo(3750, 9);
    expect(s.healthFactorAfter).toBeCloseTo(1.11, 9);
  });

  it("keeps the exit's price and cost when the price falls further, and the health factor after stays above 1.00", () => {
    const at = simulateMove(input(oneWeth, 1.05), -0.0625).shield!;
    const deeper = simulateMove(input(oneWeth, 1.05), -0.11).shield!;
    expect(deeper.move).toBeCloseTo(-0.0625, 12);
    expect(deeper.costUsd).toBeCloseTo(at.costUsd, 9);
    // After the exit: 3,000 - 688.07 debt and 1 - 1.01 x 688.07 / 3,750 WETH. At $3,560:
    const r = 180 / 0.2616;
    const weth = 1 - (1.01 * r) / 3750;
    expect(deeper.healthFactorAfter).toBeCloseTo((weth * 3560 * 0.84) / (3000 - r), 9);
    expect(deeper.healthFactorAfter).toBeGreaterThan(1);
  });

  it("runs the exit now when the health factor is already at or below the trigger", () => {
    const s = simulateMove(input(oneWeth, 1.15), -0.05).shield!;
    expect(s.move).toBe(0);
    // r = 3,000 x (1.21 - 1.12) / (1.21 - 0.8484)
    expect(s.repayUsd).toBeCloseTo((3000 * 0.09) / (1.21 - 0.8484), 9);
  });

  it("has no Shield side without a trigger", () => {
    const s = simulateMove(input(oneWeth), -0.2);
    expect(s.exitFires).toBe(false);
    expect(s.exitMove).toBeNaN();
    expect(s.shield).toBeUndefined();
    expect(s.liquidatable).toBe(true);
  });
});

describe("chance of touching the exit price", () => {
  it("normal CDF at known points", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.841344746, 6);
    expect(normalCdf(-1.959963985)).toBeCloseTo(0.025, 6);
    expect(normalCdf(-3)).toBeCloseTo(0.001349898, 6);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("2 x Phi(ln(B/S) / (sigma sqrt T)) at known values", () => {
    // ln(B/S) / (sigma sqrt T) = -1.96 gives 5%; -1 gives 31.73%.
    expect(touchProbability({ spot: 100, barrier: 100 * Math.exp(-1.959963985), sigma: 1, years: 1 })).toBeCloseTo(0.05, 6);
    expect(touchProbability({ spot: 100, barrier: 100 * Math.exp(-0.2), sigma: 0.8, years: 1 / 16 })).toBeCloseTo(2 * 0.158655254, 6);
    // WETH $4,000 to $3,750 at 80% a year: z = ln(0.9375) / (0.8 sqrt(1/365)) = -0.0645385 / 0.0418739 = -1.54126,
    // P = 2 x 0.0616 = 12.3% in 24 hours.
    const z = Math.log(0.9375) / (0.8 * Math.sqrt(YEARS_24H));
    expect(z).toBeCloseTo(-1.54126, 4);
    expect(touchProbability({ spot: 4000, barrier: 3750, sigma: 0.8, years: YEARS_24H })).toBeCloseTo(2 * normalCdf(z), 12);
    expect(touchProbability({ spot: 4000, barrier: 3750, sigma: 0.8, years: YEARS_24H })).toBeCloseTo(0.1232, 3);
  });

  it("is 1 at or above the price, 0 with no volatility or no time", () => {
    expect(touchProbability({ spot: 100, barrier: 100, sigma: 0.8, years: YEARS_24H })).toBe(1);
    expect(touchProbability({ spot: 100, barrier: 120, sigma: 0, years: 0 })).toBe(1);
    expect(touchProbability({ spot: 100, barrier: 90, sigma: 0, years: YEARS_7D })).toBe(0);
    expect(touchProbability({ spot: 100, barrier: 90, sigma: 0.8, years: 0 })).toBe(0);
    expect(touchProbability({ spot: 0, barrier: 90, sigma: 0.8, years: 1 })).toBeNaN();
  });

  it("rises with time and with volatility, and stays within 0 and 1", () => {
    let last = 0;
    for (const days of [0.1, 1, 7, 30, 365, 3650]) {
      const p = touchProbability({ spot: 4000, barrier: 3500, sigma: 0.6, years: days / 365 });
      expect(p).toBeGreaterThan(last);
      expect(p).toBeLessThanOrEqual(1);
      last = p;
    }
    last = 0;
    for (const sigma of [0.1, 0.3, 0.8, 1.5, 5]) {
      const p = touchProbability({ spot: 4000, barrier: 3500, sigma, years: YEARS_7D });
      expect(p).toBeGreaterThan(last);
      last = p;
    }
    expect(touchProbability({ spot: 4000, barrier: 3500, sigma: 0.8, years: YEARS_7D })).toBeGreaterThan(
      touchProbability({ spot: 4000, barrier: 3500, sigma: 0.8, years: YEARS_24H }),
    );
  });

  it("formats an estimate without claiming certainty", () => {
    expect(formatChance(0.1232)).toBe("12%");
    expect(formatChance(0.001)).toBe("<1%");
    expect(formatChance(0.999)).toBe(">99%");
    expect(formatChance(1)).toBe("100%");
    expect(formatChance(0)).toBe("0%");
  });
});
