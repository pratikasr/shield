/**
 * Risk maths for the borrower page: Aave's health factor when one collateral's price moves, what Shield's exit and an
 * Aave liquidation would do at that price, and the chance the price touches the exit price.
 *
 * Aave V3 (GenericLogic.calculateUserAccountData): HF = sum over collateral reserves of value x liquidation threshold,
 * divided by the total debt value, all at Aave's oracle prices. Moving one asset's price changes only that asset's
 * terms, so HF is a straight line in the move on top and on the bottom: HF(m) = (N + a m) / (D + b m), where a is the
 * moved asset's supplied value times its threshold and b is the debt held in that asset (zero for a USDC borrower).
 */
import { aaveLiquidation, shieldExit, type AaveLiquidation } from "./economics";

/** Aave liquidates below this health factor. */
export const LIQUIDATION_HF = 1;
/** Years in 24 hours and in 7 days, on the 365-day year the Repricer annualises volatility with. */
export const YEARS_24H = 1 / 365;
export const YEARS_7D = 7 / 365;

export interface HfReserve {
  /** Token units supplied and borrowed. */
  supplied: number;
  borrowed: number;
  priceUsd: number;
  /** Liquidation threshold as a fraction, for example 0.84. */
  liquidationThreshold: number;
  /** Whether Aave counts the supply as collateral. Defaults to true for a supply with a threshold above zero. */
  collateral?: boolean;
}

function counts(r: HfReserve): boolean {
  return (r.collateral ?? true) && r.supplied > 0 && r.liquidationThreshold > 0;
}

/** Sum over collateral reserves of supplied value times liquidation threshold. */
export function weightedCollateralUsd(reserves: HfReserve[]): number {
  return reserves.reduce((sum, r) => (counts(r) ? sum + r.supplied * r.priceUsd * r.liquidationThreshold : sum), 0);
}

export function debtValueUsd(reserves: HfReserve[]): number {
  return reserves.reduce((sum, r) => sum + r.borrowed * r.priceUsd, 0);
}

/** Aave's health factor; Infinity with no debt, as Aave reports type(uint256).max. */
export function healthFactor(reserves: HfReserve[]): number {
  const debt = debtValueUsd(reserves);
  if (!(debt > 0)) return Number.POSITIVE_INFINITY;
  return weightedCollateralUsd(reserves) / debt;
}

/** The health factor after the price of `reserves[index]` moves by `move` (-0.1 is a 10% fall), everything else still. */
export function healthFactorAfterMove(reserves: HfReserve[], index: number, move: number): number {
  return healthFactor(reserves.map((r, i) => (i === index ? { ...r, priceUsd: r.priceUsd * (1 + move) } : r)));
}

/** HF(m) = (weighted + movedWeighted x m) / (debt + movedDebt x m), all in USD at today's prices. */
export interface MoveModel {
  weightedCollateralUsd: number;
  debtUsd: number;
  /** The moved asset's supplied value times its threshold (zero if it is not collateral). */
  movedWeightedUsd: number;
  /** Debt held in the moved asset. */
  movedDebtUsd: number;
}

/** The model for moving `reserves[index]`, from the reserves alone. */
export function moveModel(reserves: HfReserve[], index: number): MoveModel {
  const r = reserves[index];
  return {
    weightedCollateralUsd: weightedCollateralUsd(reserves),
    debtUsd: debtValueUsd(reserves),
    movedWeightedUsd: r && counts(r) ? r.supplied * r.priceUsd * r.liquidationThreshold : 0,
    movedDebtUsd: r ? r.borrowed * r.priceUsd : 0,
  };
}

/**
 * The model anchored to the health factor and debt Aave reports, so the move of 0 reproduces Aave's own reading
 * exactly (including collateral switched off and oracle rounding), and only the moved asset's terms change.
 */
export function anchoredModel(args: { healthFactor: number; debtUsd: number; movedSuppliedUsd: number; movedBorrowedUsd: number; liquidationThreshold: number }): MoveModel {
  return {
    weightedCollateralUsd: args.healthFactor * args.debtUsd,
    debtUsd: args.debtUsd,
    movedWeightedUsd: args.movedSuppliedUsd * args.liquidationThreshold,
    movedDebtUsd: args.movedBorrowedUsd,
  };
}

export function hfAtMove(model: MoveModel, move: number): number {
  const debt = model.debtUsd + model.movedDebtUsd * move;
  if (!(debt > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(model.weightedCollateralUsd + model.movedWeightedUsd * move, 0) / debt;
}

/** The move at which the health factor reaches `hf`; NaN if no price at or above zero gets there. */
export function moveForHf(model: MoveModel, hf: number): number {
  const slope = model.movedWeightedUsd - hf * model.movedDebtUsd;
  if (slope === 0 || !Number.isFinite(slope)) return Number.NaN;
  const m = (hf * model.debtUsd - model.weightedCollateralUsd) / slope;
  return Number.isFinite(m) && m > -1 ? m : Number.NaN;
}

export interface SimulationInput {
  model: MoveModel;
  /** The moved collateral's price and supplied value now. */
  priceUsd: number;
  suppliedUsd: number;
  liquidationThreshold: number;
  /** Aave's liquidation bonus for the collateral, for example 1.055. */
  bonus: number;
  /** The USDC debt: what Shield repays and what an Aave liquidation of this collateral repays. */
  usdcDebtUsd: number;
  /** The cover's trigger, or the one being previewed. */
  trigger?: number;
  discountBps: number;
  hfBuffer: number;
}

export interface ShieldAtMove {
  /** Where the exit runs: at the trigger on the way down, or now if the health factor is already at or below it. */
  move: number;
  priceUsd: number;
  repayUsd: number;
  /** The exit discount: collateral given up beyond the debt repaid. */
  costUsd: number;
  /** The health factor at the simulated price once the exit has run. */
  healthFactorAfter: number;
}

export interface Simulation {
  move: number;
  priceUsd: number;
  healthFactor: number;
  /** At or below the trigger, where the Executor lets an exit run. */
  exitFires: boolean;
  /** Below 1.00, where Aave lets a liquidator act. */
  liquidatable: boolean;
  /** Moves at which the exit fires and Aave can liquidate; NaN when no price reaches them. */
  exitMove: number;
  liquidationMove: number;
  /** Without Shield: what an Aave liquidation at this price takes. Undefined above 1.00. */
  aave?: AaveLiquidation;
  /** With Shield: the exit, if the price reaches the trigger on the way to this price. */
  shield?: ShieldAtMove;
}

/** What a move of the collateral's price does to the position, with and without Shield. */
export function simulateMove(input: SimulationInput, move: number): Simulation {
  const { model, trigger } = input;
  const hf = hfAtMove(model, move);
  const exitFires = trigger !== undefined && hf <= trigger;
  const liquidatable = hf < LIQUIDATION_HF;
  const exitMove = trigger !== undefined ? moveForHf(model, trigger) : Number.NaN;
  const liquidationMove = moveForHf(model, LIQUIDATION_HF);

  const aave = liquidatable
    ? aaveLiquidation({
        totalDebtUsd: model.debtUsd + model.movedDebtUsd * move,
        debtReserveUsd: input.usdcDebtUsd,
        collateralUsd: input.suppliedUsd * (1 + move),
        bonus: input.bonus,
        healthFactor: hf,
      })
    : undefined;

  let shield: ShieldAtMove | undefined;
  if (exitFires && trigger !== undefined) {
    const hfNow = hfAtMove(model, 0);
    const at = hfNow <= trigger ? 0 : exitMove;
    if (Number.isFinite(at)) {
      const hfAt = hfAtMove(model, at);
      const exit = shieldExit({
        totalDebtUsd: model.debtUsd + model.movedDebtUsd * at,
        usdcDebtUsd: input.usdcDebtUsd,
        trigger,
        healthFactor: hfAt,
        liquidationThreshold: input.liquidationThreshold,
        collateralUsd: input.suppliedUsd * (1 + at),
        discountBps: input.discountBps,
        hfBuffer: input.hfBuffer,
      });
      if (exit.reachable) {
        // The vault takes (1 + discount) x repaid of collateral at the exit's price: that share of the supply leaves.
        const valueAtExit = input.suppliedUsd * (1 + at);
        const share = valueAtExit > 0 ? Math.min((exit.repayUsd + exit.costUsd) / valueAtExit, 1) : 0;
        const after: MoveModel = {
          weightedCollateralUsd: model.weightedCollateralUsd - model.movedWeightedUsd * share,
          debtUsd: model.debtUsd - exit.repayUsd,
          movedWeightedUsd: model.movedWeightedUsd * (1 - share),
          movedDebtUsd: model.movedDebtUsd,
        };
        shield = {
          move: at,
          priceUsd: input.priceUsd * (1 + at),
          repayUsd: exit.repayUsd,
          costUsd: exit.costUsd,
          healthFactorAfter: hfAtMove(after, move),
        };
      }
    }
  }

  return { move, priceUsd: input.priceUsd * (1 + move), healthFactor: hf, exitFires, liquidatable, exitMove, liquidationMove, aave, shield };
}

/** Standard normal CDF, from the complementary error function (Numerical Recipes erfcc, error below 1.2e-7). */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === Number.POSITIVE_INFINITY) return 1;
  if (x === Number.NEGATIVE_INFINITY) return 0;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const erfc =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? 1 - erfc / 2 : erfc / 2;
}

/**
 * The chance a price now at `spot` touches `barrier` within `years`, under a zero-drift lognormal model with constant
 * annualised volatility `sigma` (the reflection principle): 2 x Phi(ln(B / S) / (sigma x sqrt(T))) for a barrier
 * below the price, 1 at or above it, 0 with no volatility or no time.
 */
export function touchProbability(args: { spot: number; barrier: number; sigma: number; years: number }): number {
  const { spot, barrier, sigma, years } = args;
  if (!(spot > 0) || !(barrier > 0)) return Number.NaN;
  if (barrier >= spot) return 1;
  if (!(sigma > 0) || !(years > 0)) return 0;
  return Math.min(2 * normalCdf(Math.log(barrier / spot) / (sigma * Math.sqrt(years))), 1);
}

/** A probability as an estimate in whole percents: "<1%" and ">99%" at the ends, never a false "0%" or "100%". */
export function formatChance(p: number): string {
  if (!Number.isFinite(p)) return "n/a";
  if (p >= 1) return "100%";
  if (p <= 0) return "0%";
  if (p < 0.005) return "<1%";
  if (p > 0.995) return ">99%";
  return `${Math.round(p * 100)}%`;
}
