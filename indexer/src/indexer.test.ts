import { createTestIndexer, TestHelpers } from "envio";
import { describe, expect, it } from "vitest";

const { Addresses } = TestHelpers;
const WETH = "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242";
const WAD = 10n ** 18n;

describe("Shield indexer", () => {
  it("follows a cover from opt-in through repricing, a lapse, a top-up and the exit", async () => {
    const indexer = createTestIndexer();
    const borrower = Addresses.defaultAddress;
    const id = borrower.toLowerCase();

    await indexer.process({
      chains: {
        143: {
          simulate: [
            { contract: "Repricer", event: "ToppedUp", params: { borrower, amount: 5_000_000n } },
            {
              contract: "PositionRegistry",
              event: "OptedIn",
              params: { borrower, collateral: WETH, trigger: 10_500n, maxDiscountBps: 100n },
            },
            {
              contract: "Repricer",
              event: "Repriced",
              params: {
                borrower,
                charged: 0n,
                premiumPerBlock: 1_000_000_000n,
                healthFactor: 107n * 10n ** 16n,
                sigma: 8n * 10n ** 17n,
                prepaid: 5n * WAD,
                lapsed: false,
              },
            },
            {
              contract: "Repricer",
              event: "Repriced",
              params: {
                borrower,
                charged: 1_000_000_000n,
                premiumPerBlock: 1_100_000_000n,
                healthFactor: 106n * 10n ** 16n,
                sigma: 8n * 10n ** 17n,
                prepaid: 5n * WAD - 1_000_000_000n,
                lapsed: false,
              },
            },
            { contract: "PositionRegistry", event: "TriggerSet", params: { borrower, trigger: 10_600n } },
          ],
        },
      },
    });

    let p = await indexer.Position.getOrThrow(id);
    expect(p.status).toBe("Protected");
    expect(p.collateral).toBe(WETH.toLowerCase());
    expect(p.trigger).toBe(10_600);
    expect(p.repriceCount).toBe(2);
    expect(p.premiumPaid).toBe(1_000_000_000n);
    expect(p.premiumPerBlock).toBe(1_100_000_000n);
    expect(p.healthFactor).toBe(106n * 10n ** 16n);
    expect(p.prepaid).toBe(5n * WAD - 1_000_000_000n);
    expect((await indexer.Reprice.getAll()).length).toBe(2);
    expect((await indexer.PrepaidFlow.getAll()).map((f) => f.kind)).toEqual(["TopUp"]);

    await indexer.process({
      chains: {
        143: {
          simulate: [
            { contract: "PositionRegistry", event: "CoverLapsed", params: { borrower } },
          ],
        },
      },
    });
    expect((await indexer.Position.getOrThrow(id)).status).toBe("Unprotected");

    await indexer.process({
      chains: {
        143: {
          simulate: [
            { contract: "Repricer", event: "ToppedUp", params: { borrower, amount: 1_000_000n } },
            { contract: "PositionRegistry", event: "RecordClosed", params: { borrower } },
            {
              contract: "Executor",
              event: "Exited",
              params: {
                borrower,
                collateral: WETH,
                repaid: 25_000_000n,
                seized: 9_500_000_000_000_000n,
                savedVsAave: 1_125_000n,
                healthFactorBefore: 1_044_900_000_000_000_000n,
                healthFactorAfter: 1_110_000_000_000_000_000n,
                flashLoanAmount: 0n,
              },
            },
          ],
        },
      },
    });
    p = await indexer.Position.getOrThrow(id);
    expect(p.status).toBe("Exited");
    expect(p.premiumPerBlock).toBe(0n);
    expect(p.healthFactor).toBe(1_110_000_000_000_000_000n);
    const exits = await indexer.Exit.getAll();
    expect(exits).toHaveLength(1);
    expect(exits[0]!.savedVsAave).toBe(1_125_000n);
    expect(exits[0]!.position_id).toBe(id);
  });

  it("keeps vault totals from deposits, premium, exits and withdrawals", async () => {
    const indexer = createTestIndexer();
    const lp = Addresses.mockAddresses[1]!;
    await indexer.process({
      chains: {
        143: {
          simulate: [
            { contract: "ShieldVault", event: "Deposit", params: { sender: lp, owner: lp, assets: 100_000_000n, shares: 10n ** 14n } },
            { contract: "ShieldVault", event: "PremiumReceived", params: { amount: 3_000_000n } },
            { contract: "ShieldVault", event: "ExitFunded", params: { amount: 25_000_000n } },
            {
              contract: "ShieldVault",
              event: "CollateralReceived",
              params: { collateral: WETH, aTokenAmount: 9_500_000_000_000_000n, usdcSpent: 25_000_000n, valueUsdc: 25_250_000n },
            },
            {
              contract: "ShieldVault",
              event: "Withdraw",
              params: { sender: lp, receiver: lp, owner: lp, assets: 50_000_000n, shares: 5n * 10n ** 13n },
            },
          ],
        },
      },
    });
    const stats = await indexer.VaultStats.getOrThrow("vault");
    expect(stats.deposited).toBe(100_000_000n);
    expect(stats.withdrawn).toBe(50_000_000n);
    expect(stats.premiumEarned).toBe(3_000_000n);
    expect(stats.exitsExecuted).toBe(1);
    expect(stats.exitFunding).toBe(25_000_000n);
    expect(stats.collateralValueReceived).toBe(25_250_000n);
    expect(stats.depositors).toBe(1);
    const kinds = (await indexer.VaultFlow.getAll()).map((f) => f.kind).sort();
    expect(kinds).toEqual(["CollateralReceived", "Deposit", "ExitFunded", "Premium", "Withdraw"]);
  });
});
