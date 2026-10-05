/**
 * The comparison line "Aave penalty if liquidated: $X. Shield: $Y." and the cover's runway.
 * Aave V3: a liquidator repays half the debt (all of it when debt or collateral is under $2,000) and takes the
 * reserve's liquidation bonus on top. Shield: the exit repays enough to bring HF from the trigger back to
 * trigger + 0.06 (ADR-021) and takes a 1% discount on that amount.
 */
export const EXIT_BUFFER = 0.06;
export const BLOCK_SECONDS = 0.3;
export const BLOCKS_PER_DAY = 86_400 / BLOCK_SECONDS;

export function aavePenaltyUsd(debtUsd: number, collateralUsd: number, liquidationBonus: number): number {
  const closeFactor = debtUsd < 2000 || collateralUsd < 2000 ? 1 : 0.5;
  return debtUsd * closeFactor * Math.max(liquidationBonus - 1, 0);
}

export function shieldExitUsd(args: {
  debtUsd: number;
  trigger: number;
  liquidationThreshold: number;
  discountBps?: number;
}): { repayUsd: number; costUsd: number } {
  const delta = (args.discountBps ?? 100) / 10_000;
  const target = args.trigger + EXIT_BUFFER;
  const denom = target - (1 + delta) * args.liquidationThreshold;
  if (denom <= 0 || args.debtUsd <= 0) return { repayUsd: 0, costUsd: 0 };
  const repayUsd = Math.min((args.debtUsd * (target - args.trigger)) / denom, args.debtUsd);
  return { repayUsd, costUsd: repayUsd * delta };
}

/** Days the prepaid balance lasts at the current per-block premium. */
export function runwayDays(prepaidUsd: number, perBlockUsd: number): number {
  if (perBlockUsd <= 0) return Number.POSITIVE_INFINITY;
  return prepaidUsd / (perBlockUsd * BLOCKS_PER_DAY);
}

export function formatRunway(days: number): string {
  if (!Number.isFinite(days)) return "until the premium starts";
  if (days < 1 / 24) return "less than an hour";
  if (days < 1) return `about ${Math.round(days * 24)} hours`;
  if (days < 365) return `about ${Math.round(days)} days`;
  return "more than a year";
}
