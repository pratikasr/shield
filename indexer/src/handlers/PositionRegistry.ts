import { indexer } from "envio";
import { fields, loadPosition } from "./shared.js";

indexer.onEvent({ contract: "PositionRegistry", event: "OptedIn", fields }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  context.Position.set({
    ...p,
    collateral: event.params.collateral.toLowerCase(),
    status: p.prepaid > 0n ? "Protected" : "Unprotected",
    trigger: Number(event.params.trigger),
    maxDiscountBps: Number(event.params.maxDiscountBps),
    premiumPerBlock: 0n,
    optedInAt: BigInt(event.block.timestamp),
    optedInTx: event.transaction.hash,
    lastRepricedBlock: BigInt(event.block.number),
    exitedAt: undefined,
  });
});

indexer.onEvent({ contract: "PositionRegistry", event: "TriggerSet" }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  context.Position.set({ ...p, trigger: Number(event.params.trigger) });
});

indexer.onEvent({ contract: "PositionRegistry", event: "MaxDiscountSet" }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  context.Position.set({ ...p, maxDiscountBps: Number(event.params.maxDiscountBps) });
});

indexer.onEvent({ contract: "PositionRegistry", event: "OptedOut" }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  context.Position.set({ ...p, status: "OptedOut", premiumPerBlock: 0n });
});

indexer.onEvent({ contract: "PositionRegistry", event: "CoverLapsed" }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  if (p.status === "Protected") context.Position.set({ ...p, status: "Unprotected" });
});

indexer.onEvent({ contract: "PositionRegistry", event: "CoverRestored" }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  if (p.status === "Unprotected") context.Position.set({ ...p, status: "Protected" });
});

indexer.onEvent({ contract: "PositionRegistry", event: "RecordClosed" }, async ({ event, context }) => {
  const p = await loadPosition(context, event.params.borrower);
  context.Position.set({ ...p, premiumPerBlock: 0n });
});
