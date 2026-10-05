/** Executor.Status, in contract order (contracts/src/Executor.sol). */
export const EXIT_STATUS = [
  "Ready",
  "NotActive",
  "CoverLapsed",
  "AboveTrigger",
  "EModeUnsupported",
  "DiscountAboveMax",
  "NothingToRepay",
  "AllowanceTooLow",
  "PythStale",
  "OracleDeviation",
  "TargetUnreachable",
  "CoverWarmingUp",
] as const;
export type ExitStatus = (typeof EXIT_STATUS)[number];

export interface ExitStatusContext {
  /** Collateral symbol, for example WETH. */
  symbol: string;
  /** The asset Pyth prices it in, for example ETH. */
  priceName: string;
  discountBps?: number;
  maxDiscountBps?: number;
  maxGapBps?: number;
  maxPriceAgeSeconds?: number;
  target?: number;
}

const pct = (bps: number | undefined, fallback: string) => (bps === undefined ? fallback : `${Math.round(bps) / 100}%`);

/**
 * Why an exit cannot run, in one or two plain sentences with the fix: the Executor's own reason, so the page never
 * says something the contract would not do.
 */
export function exitStatusMessage(status: ExitStatus, c: ExitStatusContext): { title: string; body: string } {
  const age = c.maxPriceAgeSeconds ? (c.maxPriceAgeSeconds >= 3600 ? `${Math.round(c.maxPriceAgeSeconds / 3600)} hour` : `${c.maxPriceAgeSeconds} seconds`) : "1 hour";
  switch (status) {
    case "Ready":
      return { title: "Exit due", body: "Your health factor reached the trigger. The keeper submits the exit as soon as it sees this; anyone else may too." };
    case "NotActive":
      return { title: "No active cover", body: "This wallet has no active cover, so no exit can run." };
    case "CoverLapsed":
      return { title: "Prepaid balance used up", body: "The cover lapsed because the prepaid balance ran out, so the trigger is not armed. Top up to re-arm it." };
    case "AboveTrigger":
      return { title: "Above the trigger", body: "Your health factor is above the trigger, so no exit is due." };
    case "EModeUnsupported":
      return { title: "Position is in eMode", body: "Shield covers positions outside eMode only, so the exit cannot run. Leave eMode on Aave to re-arm the trigger." };
    case "DiscountAboveMax":
      return {
        title: "Discount above your maximum",
        body: `Shield's exit discount is ${pct(c.discountBps, "above")} and your maximum is ${pct(c.maxDiscountBps, "lower")}, so the exit cannot run. Raise your maximum discount or opt out.`,
      };
    case "NothingToRepay":
      return { title: "Nothing to repay", body: `The exit has no USDC debt to repay or no ${c.symbol} left to take, so it cannot run.` };
    case "AllowanceTooLow":
      return { title: "Approval too low", body: `Shield can no longer move your a${c.symbol} at an exit. Approve it again to re-arm the trigger.` };
    case "PythStale":
      return {
        title: `Waiting for a ${c.priceName} price`,
        body: `The exit needs a Pyth ${c.priceName} price from the last ${age}. Pyth pushes a new one when ${c.priceName} moves 0.02% and at least hourly; the exit runs when one arrives.`,
      };
    case "OracleDeviation":
      return {
        title: "Prices disagree",
        body: `Aave's and Pyth's ${c.priceName} prices differ by more than ${pct(c.maxGapBps, "the allowed gap")}, or Pyth's confidence band is too wide. The exit runs once they agree.`,
      };
    case "TargetUnreachable":
      return {
        title: "Exit cannot restore the target",
        body: `Repaying debt against ${c.symbol} at the exit discount cannot bring the health factor back to ${c.target?.toFixed(2) ?? "the target"}, so the exit cannot run.`,
      };
    case "CoverWarmingUp":
      return { title: "Cover is arming", body: "New, restored or raised cover waits before it can exit, so it cannot be bought at the moment it is needed." };
  }
}
