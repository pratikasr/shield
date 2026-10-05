import type { EarningsBucket, EvmOnEventContext, Position, ProtocolConfig, VaultStats } from "envio";

type HandlerContext = EvmOnEventContext;

export const fields = { transaction: ["hash"], block: ["timestamp"] } as const;

/** Prepaid premium is accounted in 18-decimal units; USDC amounts in events have 6. */
export const USDC_TO_WAD = 10n ** 12n;

export function emptyPosition(borrower: string): Position {
  return {
    id: borrower.toLowerCase(),
    borrower: borrower.toLowerCase(),
    collateral: "",
    status: "OptedOut",
    trigger: 0,
    maxDiscountBps: 0,
    prepaid: 0n,
    premiumPaid: 0n,
    premiumPerBlock: 0n,
    healthFactor: 0n,
    sigma: 0n,
    repriceCount: 0,
    optedInAt: 0n,
    optedInTx: "",
    lastRepricedBlock: 0n,
    exitedAt: undefined,
  };
}

export async function loadPosition(context: HandlerContext, borrower: string): Promise<Position> {
  return (await context.Position.get(borrower.toLowerCase())) ?? emptyPosition(borrower);
}

export async function loadStats(context: HandlerContext): Promise<VaultStats> {
  return (
    (await context.VaultStats.get("vault")) ?? {
      id: "vault",
      deposited: 0n,
      withdrawn: 0n,
      premiumEarned: 0n,
      exitsExecuted: 0,
      exitFunding: 0n,
      collateralValueReceived: 0n,
      depositors: 0,
    }
  );
}

export function eventId(event: { chainId: number; block: { number: number }; logIndex: number }): string {
  return `${event.chainId}-${event.block.number}-${event.logIndex}`;
}

/** The contracts' initial parameters: PositionRegistry sets them in storage without an event. */
export function defaultConfig(): ProtocolConfig {
  return { id: "config", treasury: undefined, protocolShareBps: 0, exitDiscountBps: 100, exitHfBuffer: 600, dMin: 100 };
}

export async function loadConfig(context: HandlerContext): Promise<ProtocolConfig> {
  return (await context.ProtocolConfig.get("config")) ?? defaultConfig();
}

type Counters = Omit<EarningsBucket, "id" | "period" | "start">;
export type EarningsDelta = Partial<Counters>;

const HOUR = 3600n;
const DAY = 86_400n;

function emptyBucket(id: string, period: string, start: bigint): EarningsBucket {
  return {
    id,
    period,
    start,
    premiumCharged: 0n,
    premiumToVault: 0n,
    premiumToProtocol: 0n,
    protocolPaid: 0n,
    exitDiscount: 0n,
    exits: 0,
    debtRepaid: 0n,
    savedVsAave: 0n,
    reprices: 0,
    optIns: 0,
    deposited: 0n,
    withdrawn: 0n,
  };
}

/** The bucket ids an event at `timestamp` (unix seconds) counts toward: since deployment, its UTC day and its hour. */
export function bucketKeys(timestamp: number | bigint): { id: string; period: string; start: bigint }[] {
  const t = BigInt(timestamp);
  const day = t - (t % DAY);
  const hour = t - (t % HOUR);
  return [
    { id: "all", period: "all", start: 0n },
    { id: `day-${day}`, period: "day", start: day },
    { id: `hour-${hour}`, period: "hour", start: hour },
  ];
}

/** Adds `delta` to the all-time, daily and hourly earnings buckets for an event at `timestamp`. */
export async function addEarnings(context: HandlerContext, timestamp: number | bigint, delta: EarningsDelta): Promise<void> {
  for (const { id, period, start } of bucketKeys(timestamp)) {
    const b = (await context.EarningsBucket.get(id)) ?? emptyBucket(id, period, start);
    const next: EarningsBucket = { ...b };
    for (const [k, v] of Object.entries(delta) as [keyof Counters, bigint | number][]) {
      (next[k] as bigint | number) = typeof v === "bigint" ? (b[k] as bigint) + v : (b[k] as number) + v;
    }
    context.EarningsBucket.set(next);
  }
}

/** The protocol's part of a premium charge, rounded down exactly as Repricer._charge does. */
export function protocolPart(charged: bigint, shareBps: number): bigint {
  return (charged * BigInt(shareBps)) / 10_000n;
}
