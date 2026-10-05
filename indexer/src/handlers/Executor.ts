import { indexer } from "envio";
import { addEarnings, fields, loadConfig, loadPosition } from "./shared.js";

indexer.onEvent({ contract: "Executor", event: "Exited", fields }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  const config = await loadConfig(context);
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
    trigger: p.trigger,
    discountBps: config.exitDiscountBps,
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
  await addEarnings(context, event.block.timestamp, {
    exits: 1,
    debtRepaid: event.params.repaid,
    savedVsAave: event.params.savedVsAave,
    exitDiscount: (event.params.repaid * BigInt(config.exitDiscountBps)) / 10_000n,
  });
});
