import { indexer, type VaultFlow } from "envio";
import { eventId, fields, loadStats } from "./shared.js";

function flow(
  event: { chainId: number; logIndex: number; block: { number: number; timestamp: number }; transaction: { hash: string } },
  data: Pick<VaultFlow, "kind"> & Partial<VaultFlow>,
): VaultFlow {
  return {
    id: eventId(event),
    account: undefined,
    assets: 0n,
    shares: 0n,
    collateral: undefined,
    collateralAmount: 0n,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    ...data,
  };
}

indexer.onEvent({ contract: "ShieldVault", event: "Deposit", fields }, async ({ event, context }) => {
  const owner = event.params.owner.toLowerCase();
  context.VaultFlow.set(flow(event, { kind: "Deposit", account: owner, assets: event.params.assets, shares: event.params.shares }));
  const stats = await loadStats(context);
  const depositor = await context.Depositor.get(owner);
  context.Depositor.set({ id: owner, shares: (depositor?.shares ?? 0n) + event.params.shares });
  context.VaultStats.set({
    ...stats,
    deposited: stats.deposited + event.params.assets,
    depositors: stats.depositors + (depositor && depositor.shares > 0n ? 0 : 1),
  });
});

indexer.onEvent({ contract: "ShieldVault", event: "Withdraw", fields }, async ({ event, context }) => {
  const owner = event.params.owner.toLowerCase();
  context.VaultFlow.set(flow(event, { kind: "Withdraw", account: owner, assets: event.params.assets, shares: event.params.shares }));
  const stats = await loadStats(context);
  const depositor = await context.Depositor.get(owner);
  const before = depositor?.shares ?? 0n;
  const left = before - event.params.shares;
  context.Depositor.set({ id: owner, shares: left < 0n ? 0n : left });
  context.VaultStats.set({
    ...stats,
    withdrawn: stats.withdrawn + event.params.assets,
    depositors: stats.depositors - (before > 0n && left <= 0n && stats.depositors > 0 ? 1 : 0),
  });
});

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Share transfers between accounts. Mints and burns also emit Transfer, but Deposit and Withdraw already count
 * them, so a Transfer from or to the zero address is skipped.
 */
indexer.onEvent({ contract: "ShieldVault", event: "Transfer" }, async ({ event, context }) => {
  const from = event.params.from.toLowerCase();
  const to = event.params.to.toLowerCase();
  const value = event.params.value;
  if (from === ZERO || to === ZERO || from === to || value === 0n) return;
  const stats = await loadStats(context);
  const sender = await context.Depositor.get(from);
  const receiver = await context.Depositor.get(to);
  const senderBefore = sender?.shares ?? 0n;
  const receiverBefore = receiver?.shares ?? 0n;
  const senderAfter = senderBefore > value ? senderBefore - value : 0n;
  context.Depositor.set({ id: from, shares: senderAfter });
  context.Depositor.set({ id: to, shares: receiverBefore + value });
  const left = senderBefore > 0n && senderAfter === 0n ? 1 : 0;
  const joined = receiverBefore === 0n ? 1 : 0;
  context.VaultStats.set({ ...stats, depositors: Math.max(0, stats.depositors - left + joined) });
});

indexer.onEvent({ contract: "ShieldVault", event: "PremiumReceived", fields }, async ({ event, context }) => {
  context.VaultFlow.set(flow(event, { kind: "Premium", assets: event.params.amount }));
  const stats = await loadStats(context);
  context.VaultStats.set({ ...stats, premiumEarned: stats.premiumEarned + event.params.amount });
});

indexer.onEvent({ contract: "ShieldVault", event: "ExitFunded", fields }, async ({ event, context }) => {
  context.VaultFlow.set(flow(event, { kind: "ExitFunded", assets: event.params.amount }));
});

indexer.onEvent({ contract: "ShieldVault", event: "CollateralReceived", fields }, async ({ event, context }) => {
  context.VaultFlow.set(
    flow(event, {
      kind: "CollateralReceived",
      assets: event.params.valueUsdc,
      collateral: event.params.collateral.toLowerCase(),
      collateralAmount: event.params.aTokenAmount,
    }),
  );
  const stats = await loadStats(context);
  context.VaultStats.set({
    ...stats,
    exitsExecuted: stats.exitsExecuted + 1,
    exitFunding: stats.exitFunding + event.params.usdcSpent,
    collateralValueReceived: stats.collateralValueReceived + event.params.valueUsdc,
  });
});

indexer.onEvent({ contract: "ShieldVault", event: "Unwound", fields }, async ({ event, context }) => {
  context.VaultFlow.set(
    flow(event, {
      kind: "Unwound",
      assets: event.params.amountOut,
      collateral: event.params.collateral.toLowerCase(),
      collateralAmount: event.params.amountIn,
    }),
  );
});
