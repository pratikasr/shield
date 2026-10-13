import { indexer } from "envio";
import { eventId, fields } from "./shared.js";

/** A borrower's salt is its address, left-padded to 32 bytes; the treasury's is a hash (ShieldForwarderFactory). */
const BORROWER_SALT_PREFIX = "0x000000000000000000000000";

indexer.onEvent({ contract: "ShieldForwarderFactory", event: "ForwarderDeployed", fields }, async ({ event, context }) => {
  const salt = event.params.salt.toLowerCase();
  const isBorrower = salt.startsWith(BORROWER_SALT_PREFIX);
  context.Forwarder.set({
    id: event.params.forwarder.toLowerCase(),
    kind: isBorrower ? "Premium" : "Vault",
    account: isBorrower ? `0x${salt.slice(BORROWER_SALT_PREFIX.length)}` : undefined,
    salt,
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "ShieldForwarderFactory", event: "PremiumSwept", fields }, async ({ event, context }) => {
  const borrower = event.params.borrower.toLowerCase();
  context.ForwarderSweep.set({
    id: eventId(event),
    kind: "Premium",
    account: borrower,
    forwarder: event.params.forwarder.toLowerCase(),
    amount: event.params.amount,
    shares: 0n,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
  // Repricer.topUpFor emitted ToppedUp earlier in this transaction, and its handler wrote a "TopUp" flow. Mark the
  // nearest one before this log (same borrower and amount) as a cross-chain top-up, so the history shows where the
  // money came from without counting it twice.
  const flows = await context.PrepaidFlow.getWhere({ txHash: { _eq: event.transaction.hash } });
  const logIndexOf = (id: string) => Number(id.slice(id.lastIndexOf("-") + 1));
  const topUp = flows
    .filter((f) => f.kind === "TopUp" && f.borrower === borrower && f.amount === event.params.amount && logIndexOf(f.id) < event.logIndex)
    .sort((a, b) => logIndexOf(b.id) - logIndexOf(a.id))[0];
  if (topUp) context.PrepaidFlow.set({ ...topUp, kind: "CrossChainTopUp" });
});

indexer.onEvent({ contract: "ShieldForwarderFactory", event: "VaultFunded", fields }, async ({ event, context }) => {
  // The vault's Deposit event in this transaction already counts the assets in VaultStats and the earnings buckets.
  context.ForwarderSweep.set({
    id: eventId(event),
    kind: "Vault",
    account: event.params.treasury.toLowerCase(),
    forwarder: event.params.forwarder.toLowerCase(),
    amount: event.params.assets,
    shares: event.params.shares,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
});
