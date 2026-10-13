import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";

/** Shared fork helpers for the end-to-end and review specs (tests only, ADR-020). */
export const rpc = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8545";
export const deployment = JSON.parse(readFileSync(process.env.E2E_DEPLOYMENT!, "utf8")) as Record<string, string>;
export const borrower = getAddress(process.env.E2E_BORROWER!) as Address;
const chain = { ...monad, rpcUrls: { default: { http: [rpc] } } };
export const client = createPublicClient({ chain, transport: http(rpc) });
export const testClient = createTestClient({ chain, mode: "anvil", transport: http(rpc) });
const admin = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(process.env.E2E_ADMIN_KEY as Hex) });

export const WETH = getAddress("0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242");
export const AAVE_ORACLE = getAddress("0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf");
const ACL_ADMIN = getAddress("0xa9d0EAFF48cE1DF468f9eAeb7e628c413343F6A2");
export const oracleAbi = parseAbi([
  "function getAssetPrice(address) view returns (uint256)",
  "function setAssetSources(address[] assets, address[] sources)",
]);


export async function statValue(page: Page, label: string): Promise<string> {
  return (await page.locator("dt", { hasText: label }).first().locator("xpath=following-sibling::dd[1]").innerText()).trim();
}

export function usd(text: string): number {
  return Number(text.replace(/[^0-9.]/g, ""));
}

/** Retries a fork call: the fork fetches untouched mainnet state on demand and the upstream RPC can time out. */
export async function retry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
}

/** Moves Aave's WETH price on the fork the way Aave's pool admin would: a new source for the asset. */
export async function setWethPrice(price8: bigint) {
  return retry(() => setWethPriceOnce(price8));
}

async function setWethPriceOnce(price8: bigint) {
  const artifact = JSON.parse(readFileSync("../contracts/out/ForkBase.sol/FixedPriceAggregator.json", "utf8")) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };
  // Fixed gas limits: the fork's gas estimate is the call that most often fails fetching upstream state.
  const hash = await admin.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [price8], gas: 500_000n });
  const agg = (await client.waitForTransactionReceipt({ hash })).contractAddress!;
  await testClient.impersonateAccount({ address: ACL_ADMIN });
  await testClient.setBalance({ address: ACL_ADMIN, value: 10n ** 20n });
  const tx = await createWalletClient({ chain, transport: http(rpc), account: ACL_ADMIN }).writeContract({
    address: AAVE_ORACLE,
    abi: oracleAbi,
    functionName: "setAssetSources",
    args: [[WETH], [agg]],
    gas: 300_000n,
  });
  await client.waitForTransactionReceipt({ hash: tx });
  await testClient.stopImpersonatingAccount({ address: ACL_ADMIN });
  return { aggregator: agg, tx };
}


/** Opens the "Stats for nerds" drawer if it is closed (it can re-render closed when the page's state changes). */
export async function openNerds(page: Page) {
  const drawer = page.locator("details", { hasText: "Stats for nerds" }).first();
  if ((await drawer.getAttribute("open")) === null) await drawer.locator("summary").click();
}

/** Connects the fork test wallet from the header. */
export async function connectTestWallet(page: Page) {
  await page.getByRole("button", { name: /^connect/i }).first().click();
  await page.getByText("Fork test wallet", { exact: true }).click();
}

/** Full page loads drop the mock test wallet's session; reconnect when the header offers Connect. */
export async function ensureConnected(page: Page) {
  await page.waitForTimeout(2500);
  const connect = page.getByRole("button", { name: /^connect( wallet)?$/i }).first();
  if (await connect.isVisible().catch(() => false)) await connectTestWallet(page);
}
