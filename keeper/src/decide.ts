import type { Address } from "viem";

/** Executor.Status, in the order the contract declares it. */
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
] as const;
export type ExitStatus = (typeof EXIT_STATUS)[number] | "PreviewFailed";

export interface Observation {
  borrower: Address;
  status: ExitStatus;
  healthFactor: bigint;
  repayAmount: bigint;
  trigger: number;
}

export interface Plan {
  exits: Address[];
  reprice: boolean;
}

/** Whether this block gets a reprice, given the cadence settings (ADR-025). */
export function shouldReprice(
  block: bigint,
  startBlock: bigint,
  cfg: { repriceEveryNBlocks: number; repriceWindowBlocks: number; repriceIdleEveryNBlocks: number },
): boolean {
  const inWindow = cfg.repriceWindowBlocks === 0 || block - startBlock < BigInt(cfg.repriceWindowBlocks);
  const every = inWindow ? cfg.repriceEveryNBlocks : cfg.repriceIdleEveryNBlocks;
  if (every === 0) return false;
  return block % BigInt(every) === 0n;
}

/** Exits go to every borrower whose exit the Executor reports as Ready; nothing else is attempted. */
export function plan(observations: Observation[], repriceDue: boolean, inFlight: Set<Address>): Plan {
  const exits = observations.filter((o) => o.status === "Ready" && !inFlight.has(o.borrower)).map((o) => o.borrower);
  const anyActive = observations.some((o) => o.status !== "NotActive");
  return { exits, reprice: repriceDue && anyActive };
}
