import { describe, expect, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const { Addresses } = TestHelpers;

describe("scaffold", () => {
  it("indexes OptedIn into a Position", async () => {
    const indexer = createTestIndexer();
    const borrower = Addresses.defaultAddress;
    await indexer.process({
      chains: {
        143: {
          simulate: [
            {
              contract: "PositionRegistry",
              event: "OptedIn",
              params: { borrower, collateral: borrower, trigger: 10400n, maxDiscountBps: 100n },
            },
          ],
        },
      },
    });
    const position = await indexer.Position.get(borrower);
    expect(position?.trigger).toBe(10400);
  });
});
