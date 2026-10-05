/**
 * The comparison "Aave penalty if liquidated: $X. Shield: $Y." and the cover's runway, with one definition everywhere.
 *
 * Aave V3.7 (LiquidationLogic): a liquidator repaying USDC against one collateral may repay all of that USDC debt,
 * unless both that collateral and that debt are worth at least $2,000 and the health factor is above 0.95; then at
 * most half of the TOTAL debt. The amount is also capped by what the collateral can pay at the bonus. The borrower
 * loses the bonus on what is repaid.
 *
 * Shield (Executor._plan): at the trigger, repay r = D * (T - HF) / (T - (1 + delta) * LT) of the TOTAL debt D, where
 * T = trigger + exit buffer, capped at the USDC debt and at the collateral, and give the vault (1 + delta) x r of
 * collateral. The borrower loses delta x r. delta and the buffer are read from the registry.
 */

/** Launch values, used only on the landing page where no registry is read. */
export const LAUNCH_EXIT = { discountBps: 100, hfBuffer: 0.06, dMin: 0.01, minCoverSeconds: 900 };
/** Aave V3.7 liquidation constants (LiquidationLogic.sol). */
export const AAVE_MIN_BASE_MAX_CLOSE_FACTOR_USD = 2000;
export const AAVE_CLOSE_FACTOR = 0.5;
/** Blocks per day at the Repricer's 300 ms block time: what turns the per-block premium into days. */
export const BLOCK_SECONDS = 0.3;
export const BLOCKS_PER_DAY = 86_400 / BLOCK_SECONDS;
export const BLOCKS_PER_YEAR = BLOCKS_PER_DAY * 365;
/** Registry MIN_PREPAY: 1 USDC in 18-decimal units. */
export const MIN_PREPAY_WAD = 10n ** 18n;

export interface AaveLiquidation {
  /** Debt a liquidator may repay. */
  repayUsd: number;
  /** Collateral the borrower loses to the bonus. */
  penaltyUsd: number;
  /** What capped the repayment: half the total debt, all of the USDC debt, or the collateral. */
  basis: "half" | "all" | "collateral";
}

/** What an Aave liquidation of the USDC debt against one collateral takes, at a health factor just under 1.00. */
export function aaveLiquidation(args: {
  totalDebtUsd: number;
  /** The debt reserve being liquidated (USDC). */
  debtReserveUsd: number;
  /** The collateral reserve's value at the moment of liquidation. */
  collateralUsd: number;
  /** Liquidation bonus, for example 1.055. */
  bonus: number;
}): AaveLiquidation {
  const { totalDebtUsd, debtReserveUsd, collateralUsd, bonus } = args;
  if (!(debtReserveUsd > 0) || !(collateralUsd > 0) || !(bonus > 1)) return { repayUsd: 0, penaltyUsd: 0, basis: "all" };
  let repay = debtReserveUsd;
  let basis: AaveLiquidation["basis"] = "all";
  if (collateralUsd >= AAVE_MIN_BASE_MAX_CLOSE_FACTOR_USD && debtReserveUsd >= AAVE_MIN_BASE_MAX_CLOSE_FACTOR_USD) {
    const half = totalDebtUsd * AAVE_CLOSE_FACTOR;
    if (debtReserveUsd > half) {
      repay = half;
      basis = "half";
    }
  }
  if (repay * bonus > collateralUsd) {
    repay = collateralUsd / bonus;
    basis = "collateral";
  }
  return { repayUsd: repay, penaltyUsd: repay * (bonus - 1), basis };
}

export interface ShieldExit {
  repayUsd: number;
  /** Collateral the borrower gives up beyond the debt repaid: the discount. */
  costUsd: number;
  /** The health factor the exit restores. */
  target: number;
  reachable: boolean;
}

/** What Shield's exit at `trigger` repays and costs, sized the way the Executor sizes it. */
export function shieldExit(args: {
  totalDebtUsd: number;
  usdcDebtUsd: number;
  trigger: number;
  /** The covered collateral's liquidation threshold. */
  liquidationThreshold: number;
  /** The covered collateral's value at the trigger; caps the exit. */
  collateralUsd?: number;
  discountBps: number;
  hfBuffer: number;
}): ShieldExit {
  const delta = args.discountBps / 10_000;
  const target = args.trigger + args.hfBuffer;
  const denom = target - (1 + delta) * args.liquidationThreshold;
  if (!(denom > 0) || !(args.totalDebtUsd > 0)) return { repayUsd: 0, costUsd: 0, target, reachable: false };
  let repay = (args.totalDebtUsd * (target - args.trigger)) / denom;
  repay = Math.min(repay, args.usdcDebtUsd);
  if (args.collateralUsd !== undefined && repay * (1 + delta) > args.collateralUsd) repay = Math.max(args.collateralUsd, 0) / (1 + delta);
  return { repayUsd: repay, costUsd: repay * delta, target, reachable: true };
}

/** The Repricer's annual premium: k x sigma x debt / max(HF - trigger, d_min). */
export function annualPremiumUsd(args: { debtUsd: number; healthFactor: number; trigger: number; k: number; sigma: number; dMin: number }): number {
  if (!(args.debtUsd > 0)) return 0;
  const d = Math.max(args.healthFactor - args.trigger, args.dMin);
  return (args.k * args.sigma * args.debtUsd) / d;
}

/** Days the prepaid balance lasts at the current per-block premium. */
export function runwayDays(prepaidUsd: number, perBlockUsd: number): number {
  if (perBlockUsd <= 0) return Number.POSITIVE_INFINITY;
  return prepaidUsd / (perBlockUsd * BLOCKS_PER_DAY);
}

export function formatRunway(days: number): string {
  if (!Number.isFinite(days)) return "as long as the rate stays at zero";
  if (days < 1 / 24) return "less than an hour";
  if (days < 1) return `about ${Math.round(days * 24)} hours`;
  if (days < 365) return `about ${Math.round(days)} days`;
  return "more than a year";
}
