import { indexer } from "envio";
import { USDC_TO_WAD, eventId, fields, loadPosition } from "./shared.js";

indexer.onEvent({ contract: "Repricer", event: "Repriced", fields }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  const { charged, premiumPerBlock, healthFactor, sigma, prepaid, lapsed } = event.params;
  context.Reprice.set({
    id: eventId(event),
    position_id: p.id,
    borrower: p.borrower,
    charged,
    premiumPerBlock,
    healthFactor,
    sigma,
    prepaid,
    lapsed,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
  const live = p.status === "Protected" || p.status === "Unprotected";
  context.Position.set({
    ...p,
    prepaid,
    premiumPaid: p.premiumPaid + charged,
    premiumPerBlock,
    healthFactor,
    sigma,
    repriceCount: p.repriceCount + 1,
    lastRepricedBlock: BigInt(event.block.number),
    status: live ? (lapsed ? "Unprotected" : "Protected") : p.status,
  });
});

indexer.onEvent({ contract: "Repricer", event: "ToppedUp", fields }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  context.PrepaidFlow.set({
    id: eventId(event),
    position_id: p.id,
    borrower: p.borrower,
    kind: "TopUp",
    amount: event.params.amount,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
  context.Position.set({
    ...p,
    prepaid: p.prepaid + event.params.amount * USDC_TO_WAD,
    status: p.status === "Unprotected" ? "Protected" : p.status,
  });
});

indexer.onEvent({ contract: "Repricer", event: "Withdrawn", fields }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  context.PrepaidFlow.set({
    id: eventId(event),
    position_id: p.id,
    borrower: p.borrower,
    kind: "Withdraw",
    amount: event.params.amount,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
  const prepaid = p.prepaid - event.params.amount * USDC_TO_WAD;
  context.Position.set({
    ...p,
    prepaid: prepaid < 0n ? 0n : prepaid,
    status: p.status === "Protected" && prepaid <= 0n ? "Unprotected" : p.status,
  });
});

indexer.onEvent({ contract: "Repricer", event: "PriceSampled" }, async ({ event, context }) => {
  context.PriceSample.set({
    id: eventId(event),
    feedId: event.params.feedId,
    price: event.params.price,
    publishTime: event.params.publishTime,
    count: Number(event.params.count),
    blockNumber: BigInt(event.block.number),
  });
});

indexer.onEvent({ contract: "Repricer", event: "PremiumForwarded" }, async () => {
  // The vault's PremiumReceived event carries the same amount; it is counted there.
});
