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

describe("audit regressions (5 Oct 2026)", () => {
  const TX = "0x" + "77".repeat(32);
  const exited = (borrower: `0x${string}`, repaid: bigint) => ({
    contract: "Executor" as const,
    event: "Exited" as const,
    // Both logs in one transaction. The handler selects the hash per event, so the simulate type does not list it.
    transaction: { hash: TX } as never,
    params: {
      borrower,
      collateral: WETH as `0x${string}`,
      repaid,
      seized: 1n,
      savedVsAave: 1n,
      healthFactorBefore: 1_040_000_000_000_000_000n,
      healthFactorAfter: 1_100_000_000_000_000_000n,
      flashLoanAmount: 0n,
    },
  });

  it("keeps one Exit row per log when two borrowers are exited in the same transaction", async () => {
    // exit() is permissionless, so a contract can exit several borrowers in one transaction.
    const indexer = createTestIndexer();
    const a = Addresses.mockAddresses[1]!;
    const b = Addresses.mockAddresses[2]!;
    await indexer.process({ chains: { 143: { simulate: [exited(a, 10_000_000n), exited(b, 20_000_000n)] } } });
    const exits = await indexer.Exit.getAll();
    expect(exits).toHaveLength(2);
    expect(exits.map((e) => e.borrower).sort()).toEqual([a.toLowerCase(), b.toLowerCase()].sort());
    expect(new Set(exits.map((e) => e.id)).size).toBe(2);
    expect(exits.every((e) => e.txHash === TX)).toBe(true);
  });

  it("follows vault shares that move between accounts by Transfer", async () => {
    // LP1 deposits, sends half the shares to LP2, LP2 redeems them. LP1 still holds 50 shares.
    const indexer = createTestIndexer();
    const lp1 = Addresses.mockAddresses[1]!;
    const lp2 = Addresses.mockAddresses[2]!;
    const zero = "0x0000000000000000000000000000000000000000" as const;
    await indexer.process({
      chains: {
        143: {
          simulate: [
            { contract: "ShieldVault", event: "Transfer", params: { from: zero, to: lp1, value: 100n } },
            { contract: "ShieldVault", event: "Deposit", params: { sender: lp1, owner: lp1, assets: 100_000_000n, shares: 100n } },
            { contract: "ShieldVault", event: "Transfer", params: { from: lp1, to: lp2, value: 50n } },
          ],
        },
      },
    });
    let stats = await indexer.VaultStats.getOrThrow("vault");
    expect(stats.depositors).toBe(2);
    expect((await indexer.Depositor.getOrThrow(lp1.toLowerCase())).shares).toBe(50n);
    expect((await indexer.Depositor.getOrThrow(lp2.toLowerCase())).shares).toBe(50n);

    await indexer.process({
      chains: {
        143: {
          simulate: [
            {
              contract: "ShieldVault",
              event: "Withdraw",
              params: { sender: lp2, receiver: lp2, owner: lp2, assets: 50_000_000n, shares: 50n },
            },
            { contract: "ShieldVault", event: "Transfer", params: { from: lp2, to: zero, value: 50n } },
          ],
        },
      },
    });
    stats = await indexer.VaultStats.getOrThrow("vault");
    expect(stats.depositors).toBe(1);
    expect((await indexer.Depositor.getOrThrow(lp1.toLowerCase())).shares).toBe(50n);
    expect((await indexer.Depositor.getOrThrow(lp2.toLowerCase())).shares).toBe(0n);
  });

  it("sets the status of a borrower first seen through Repriced from the event's lapsed flag", async () => {
    // Happens when ENVIO_START_BLOCK is later than the OptedIn, for example a redeployed indexer.
    const indexer = createTestIndexer();
    const borrower = Addresses.mockAddresses[3]!;
    const repriced = (n: number, lapsed: boolean) => ({
      contract: "Repricer" as const,
      event: "Repriced" as const,
      block: { number: n },
      params: {
        borrower,
        charged: 1n,
        premiumPerBlock: 1n,
        healthFactor: 10n ** 18n,
        sigma: 1n,
        prepaid: lapsed ? 0n : WAD,
        lapsed,
      },
    });
    await indexer.process({ chains: { 143: { simulate: [repriced(10, false)] } } });
    expect((await indexer.Position.getOrThrow(borrower.toLowerCase())).status).toBe("Protected");
    await indexer.process({ chains: { 143: { simulate: [repriced(11, true)] } } });
    expect((await indexer.Position.getOrThrow(borrower.toLowerCase())).status).toBe("Unprotected");
  });
});
