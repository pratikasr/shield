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
  "CoverWarmingUp",
] as const;
export type ExitStatus = (typeof EXIT_STATUS)[number] | "PreviewFailed";

/** PositionRegistry record flags. */
export const FLAG_ACTIVE = 1;
export const FLAG_LAPSED = 2;

/** HF is x 1e18 and the trigger is in basis points (10,400 = 1.04). */
const BPS_TO_WAD = 10n ** 14n;

export interface Observation {
  borrower: Address;
  status: ExitStatus;
  healthFactor: bigint;
  repayAmount: bigint;
  trigger: number;
  /** Record fields from the same multicall; absent when the record read failed. */
  flags?: number;
  collateralId?: number;
  prepaid?: bigint;
  optedInAt?: bigint;
}

export interface Plan {
  exits: Address[];
  reprice: boolean;
}

export interface Cadence {
  repriceEveryNBlocks: number;
  repriceWindowBlocks: number;
  repriceIdleEveryNBlocks: number;
}

/**
 * Whether this block gets a reprice (ADR-025). Inside the window (REPRICE_WINDOW_BLOCKS from the keeper's first
 * block; 0 means no end) the cadence is REPRICE_EVERY_N_BLOCKS, after it REPRICE_IDLE_EVERY_N_BLOCKS. The cadence
 * counts from the last block that was repriced, not `block % N`, so a keeper whose passes skip heads still
 * reprices on time.
 */
export function shouldReprice(block: bigint, startBlock: bigint, lastRepriceBlock: bigint | undefined, cfg: Cadence): boolean {
  const inWindow = cfg.repriceWindowBlocks === 0 || block - startBlock < BigInt(cfg.repriceWindowBlocks);
  const every = inWindow ? cfg.repriceEveryNBlocks : cfg.repriceIdleEveryNBlocks;
  if (every === 0) return false;
  if (lastRepriceBlock === undefined) return true;
  return block - lastRepriceBlock >= BigInt(every);
}

/** Exits go to every borrower whose exit the Executor reports as Ready; nothing else is attempted. */
export function plan(observations: Observation[], repriceDue: boolean): Plan {
  const exits = observations.filter((o) => o.status === "Ready").map((o) => o.borrower);
  return { exits, reprice: repriceDue && observations.some(isRepriceable) };
}

/**
 * A record worth paying gas to reprice: active, not lapsed, with prepaid premium left, and read cleanly. A lapsed
 * or empty record cannot be charged, and a record whose preview failed would likely make the batch revert.
 */
export function isRepriceable(o: Observation): boolean {
  if (o.status === "NotActive" || o.status === "PreviewFailed" || o.status === "CoverLapsed") return false;
  if (o.flags === undefined || o.prepaid === undefined) return false;
  if ((o.flags & FLAG_ACTIVE) === 0 || (o.flags & FLAG_LAPSED) !== 0) return false;
  return o.prepaid > 0n;
}

/** HF minus the trigger, both x 1e18: the smaller, the closer the borrower is to an exit. */
export function distanceToTrigger(o: Observation): bigint {
  return o.healthFactor - BigInt(o.trigger) * BPS_TO_WAD;
}

/** Riskiest first, so when repriceMany is split the borrowers nearest their trigger go in the first chunk. */
export function byRisk(a: Observation, b: Observation): number {
  const d = distanceToTrigger(a) - distanceToTrigger(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/** Statuses for which previewExit reports no real HF (it returns early with 0). */
const NO_HF: ReadonlySet<ExitStatus> = new Set(["NotActive", "CoverLapsed", "PreviewFailed"]);

/** At or below the trigger, yet the Executor will not exit: worth a warning (audit M5). */
export function isStuck(o: Observation): boolean {
  if (o.status === "Ready" || NO_HF.has(o.status)) return false;
  return o.trigger > 0 && distanceToTrigger(o) <= 0n;
}

/** Statuses a fresh Pyth update from Hermes might clear. */
export function hermesMightUnblock(o: Observation): boolean {
  return (o.status === "PythStale" || o.status === "OracleDeviation") && isStuck(o);
}

/** Splits a list into chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}
