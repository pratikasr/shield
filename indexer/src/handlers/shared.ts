import type { EvmOnEventContext, Position, VaultStats } from "envio";

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
