import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { decodeEventLog, type Address } from "viem";
import { executorAbi } from "../src/lib/abi/Executor";
import { positionRegistryAbi } from "../src/lib/abi/PositionRegistry";
import { repricerAbi } from "../src/lib/abi/Repricer";
import { AAVE_ORACLE, WETH, borrower, client, deployment, openNerds, oracleAbi, setWethPrice, statValue, usd } from "./helpers";

/**
 * The SPEC.md video script, walked through the real app on a fork: connect, turn on Shield, premium ticks, the
 * price moves, the keeper exits, the Exited event lands, the borrower sees the penalty avoided, the vault updates.
 * Every on-screen claim is checked against receipts and logs from the fork.
 */
const result: Record<string, unknown> = { borrower, deployment };


test("the video script, end to end on a Monad mainnet fork", async ({ page }) => {
  // 1. Position page, connect. Version 3 leads with a sentence, not the health factor, which sits in the closed
  // "Stats for nerds" drawer.
  await page.goto("/app/borrow");
  await page.getByRole("button", { name: /^connect/i }).first().click();
  await page.getByText("Fork test wallet", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^ETH can fall/ })).toBeVisible({ timeout: 90_000 });
  await openNerds(page);
  const hfText = await statValue(page, "Health factor");
  result.hfAtStart = hfText;
  expect(Number(hfText)).toBeGreaterThan(1.06);

  // 2. Turn on Shield through the UI: the Early card (a 1.06 line at the fork's health factor of 1.07), the
  // preselected fuel, and one button that runs the four wallet steps.
  const early = page.getByRole("radio", { name: /^Early/ });
  await early.click();
  await expect(early).toBeChecked();
  await expect(page.getByText(/Aave.s liquidators would take/).first()).toBeVisible();
  await page.getByRole("button", { name: "Turn on Shield" }).first().click();
  // New cover waits out the Executor's waiting period (20 s on the fork stack) before an exit can run; the page
  // counts it down, then says Shield is on.
  await expect(page.getByRole("heading", { level: 1, name: /^Shield is arming|^Shield is on/ })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { level: 1, name: /^Shield is on/ })).toBeVisible({ timeout: 90_000 });

  const optIns = await client.getContractEvents({
    address: deployment.PositionRegistry as Address,
    abi: positionRegistryAbi,
    eventName: "OptedIn",
    args: { borrower },
    fromBlock: BigInt(deployment.block),
  });
  expect(optIns).toHaveLength(1);
  expect(Number(optIns[0]!.args.trigger)).toBe(10_600);
  result.optInTx = optIns[0]!.transactionHash;
  result.optInBlock = optIns[0]!.blockNumber.toString();

  // 3. The premium ticks every block.
  // The keeper's first reprice sets the stored rate; from then on the amount paid rises every block.
  const paid = async () => {
    await openNerds(page);
    return usd(await statValue(page, "Premium paid so far"));
  };
  await expect.poll(paid, { timeout: 90_000 }).toBeGreaterThan(0);
  const paid0 = await paid();
  await expect.poll(paid, { timeout: 30_000 }).toBeGreaterThan(paid0);
  result.premiumPerBlockShown = await statValue(page, "Cover this block");
  const reprices = await client.getContractEvents({
    address: deployment.Repricer as Address,
    abi: repricerAbi,
    eventName: "Repriced",
    args: { borrower },
    fromBlock: optIns[0]!.blockNumber,
  });
  const blocks = reprices.map((r) => r.blockNumber);
  let run = 1;
  let best: typeof reprices = [];
  for (let i = 1; i < blocks.length; i++) {
    run = blocks[i] === blocks[i - 1]! + 1n ? run + 1 : 1;
    if (run >= 3 && best.length === 0) best = reprices.slice(i - 2, i + 1);
  }
  expect(best.length).toBe(3);
  const times = await Promise.all(best.map(async (r) => (await client.getBlock({ blockNumber: r.blockNumber })).timestamp));
  result.consecutiveReprices = best.map((r, i) => ({ block: r.blockNumber.toString(), tx: r.transactionHash, timestamp: times[i]!.toString() }));

  // 4. The price moves: WETH down 1.6%, inside the exit's 2% Aave-versus-Pyth bound, HF under the 1.06 trigger.
  const price = await client.readContract({ address: AAVE_ORACLE, abi: oracleAbi, functionName: "getAssetPrice", args: [WETH] });
  const moved = await setWethPrice((price * 984n) / 1000n);
  result.priceMove = { from: price.toString(), to: ((price * 984n) / 1000n).toString(), tx: moved.tx };

  // 5. The keeper exits, the Exited event lands, the borrower sees the penalty avoided.
  await expect(page.getByText(/penalty avoided/).first()).toBeVisible({ timeout: 90_000 });
  const exits = await client.getContractEvents({
    address: deployment.Executor as Address,
    abi: executorAbi,
    eventName: "Exited",
    args: { borrower },
    fromBlock: optIns[0]!.blockNumber,
  });
  expect(exits).toHaveLength(1);
  const exit = exits[0]!;
  const receipt = await client.getTransactionReceipt({ hash: exit.transactionHash });
  expect(receipt.status).toBe("success");
  const decoded = decodeEventLog({ abi: executorAbi, data: exit.data, topics: exit.topics });
  const args = decoded.args as unknown as { repaid: bigint; savedVsAave: bigint; healthFactorBefore: bigint; healthFactorAfter: bigint };
  expect(args.healthFactorAfter).toBeGreaterThan(10n ** 18n);
  expect(args.healthFactorAfter).toBeGreaterThan(args.healthFactorBefore);
  const saved = Number(args.savedVsAave) / 1e6;
  await expect(page.getByText(`$${saved.toFixed(2)}`).filter({ visible: true }).first()).toBeVisible();
  result.exitTx = exit.transactionHash;
  result.exitBlock = exit.blockNumber.toString();
  result.repaidUsdc = (Number(args.repaid) / 1e6).toFixed(6);
  result.savedVsAaveUsdc = saved.toFixed(6);
  result.hfBefore = (Number(args.healthFactorBefore) / 1e18).toFixed(4);
  result.hfAfter = (Number(args.healthFactorAfter) / 1e18).toFixed(4);
  await page.screenshot({ path: "e2e-results/borrower-after-exit.png", fullPage: true });

  // 6. The vault page updates: one exit executed, premium earned, and the exit transaction listed by the indexer
  // (skipped when the stack runs without it, STACK_INDEXER=0).
  await page.goto("/app/vault");
  await expect(page.locator("dt", { hasText: "Rescues paid for" }).first()).toBeVisible();
  await expect.poll(async () => statValue(page, "Rescues paid for"), { timeout: 60_000 }).toBe("1");
  if (process.env.E2E_INDEXER !== "0") await expect(page.getByTitle(exit.transactionHash).first()).toBeVisible({ timeout: 60_000 });
  expect(usd(await statValue(page, "Earned so far"))).toBeGreaterThan(0);
  await page.getByText("Stats for nerds").first().click();
  result.vault = {
    exitsExecuted: await statValue(page, "Rescues paid for"),
    premiumEarned: await statValue(page, "Earned so far"),
    averageDiscount: await statValue(page, "Average discount captured"),
  };
  await page.screenshot({ path: "e2e-results/lp-after-exit.png", fullPage: true });

  writeFileSync(process.env.E2E_RESULT ?? "e2e-results/result.json", JSON.stringify(result, null, 2));
});
