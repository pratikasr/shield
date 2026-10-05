import { indexer } from "envio";
import { fields, loadPosition } from "./shared.js";

indexer.onEvent({ contract: "Executor", event: "Exited", fields }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  context.Exit.set({
    // One row per log: exit() is permissionless, so one transaction can exit several borrowers.
    id: `${event.transaction.hash}-${event.logIndex}`,
    position_id: p.id,
    borrower: p.borrower,
    collateral: event.params.collateral.toLowerCase(),
    repaid: event.params.repaid,
    seized: event.params.seized,
    savedVsAave: event.params.savedVsAave,
    healthFactorBefore: event.params.healthFactorBefore,
    healthFactorAfter: event.params.healthFactorAfter,
    flashLoanAmount: event.params.flashLoanAmount,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
  context.Position.set({
    ...p,
    status: "Exited",
    premiumPerBlock: 0n,
    healthFactor: event.params.healthFactorAfter,
    exitedAt: BigInt(event.block.timestamp),
  });
});
