import { indexer } from "envio";
import { USDC_TO_WAD, addEarnings, eventId, fields, loadConfig, loadPosition, protocolPart } from "./shared.js";

indexer.onEvent({ contract: "Repricer", event: "Repriced", fields }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  const { charged, premiumPerBlock, healthFactor, sigma, prepaid, lapsed } = event.params;
  const config = await loadConfig(context);
  const protocolShare = protocolPart(charged, config.protocolShareBps);
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
    protocolShare,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
  // The Repricer only emits Repriced for an active record, and in an opt-out or exit transaction it comes before
  // OptedOut or Exited. So the event's lapsed flag always sets the status, including for a borrower first seen
  // here because the indexer started after the OptedIn.
  context.Position.set({
    ...p,
    prepaid,
    premiumPaid: p.premiumPaid + charged,
    premiumPerBlock,
    healthFactor,
    sigma,
    repriceCount: p.repriceCount + 1,
    lastRepricedBlock: BigInt(event.block.number),
    status: lapsed ? "Unprotected" : "Protected",
  });
  await addEarnings(context, event.block.timestamp, {
    premiumCharged: charged,
    premiumToProtocol: protocolShare,
    premiumToVault: charged - protocolShare,
    reprices: 1,
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

indexer.onEvent({ contract: "Repricer", event: "ProtocolPremiumPaid", fields }, async ({ event, context }) => {
  context.ProtocolPayout.set({
    id: eventId(event),
    treasury: event.params.treasury.toLowerCase(),
    amount: event.params.amount,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
  await addEarnings(context, event.block.timestamp, { protocolPaid: event.params.amount });
});
