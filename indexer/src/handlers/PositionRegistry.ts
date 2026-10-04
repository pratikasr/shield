import { indexer } from "envio";

indexer.onEvent({ contract: "PositionRegistry", event: "OptedIn" }, async ({ event, context }) => {
  context.Position.set({
    id: event.params.borrower,
    borrower: event.params.borrower,
    collateral: event.params.collateral,
    trigger: Number(event.params.trigger),
    maxDiscountBps: Number(event.params.maxDiscountBps),
    optedInAt: BigInt(event.block.timestamp),
  });
});
