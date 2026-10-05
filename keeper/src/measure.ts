/**
 * Measures what the MIP-8 access list saves on Shield's per-block call. For the active borrowers it estimates
 * repriceMany three ways on proposed state: no access list, the node's eth_createAccessList result, and that
 * result reduced to one key per 128-slot page plus Shield's own pages (what the keeper sends).
 *
 *   pnpm --filter keeper measure        (same environment as the keeper)
 */
import { pathToFileURL } from "node:url";
import { createPublicClient, encodeFunctionData, http, type AccessList, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { executorAbi } from "./abi/Executor.js";
import { positionRegistryAbi } from "./abi/PositionRegistry.js";
import { repricerAbi } from "./abi/Repricer.js";
import { compressToPages } from "./accessList.js";
import { loadConfig } from "./config.js";
import { chainFor } from "./index.js";
import { Keeper } from "./keeper.js";
import { createLogger } from "./log.js";
import { Submitter } from "./submit.js";

/** EIP-2930 intrinsic cost: 2,400 per address and 1,900 per storage key. */
export function accessListIntrinsic(list: AccessList): bigint {
  return list.reduce((sum, e) => sum + 2_400n + 1_900n * BigInt(e.storageKeys.length), 0n);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger("error");
  const chain = chainFor(cfg);
  const client = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const account = privateKeyToAccount(cfg.keeperKey);
  const submitter = new Submitter(client, account, chain, logger, { gasBufferBps: 0, syncTimeoutMs: 2_000 });
  const keeper = new Keeper(client, submitter, cfg, logger);

  const count = await client.readContract({ address: cfg.registry, abi: positionRegistryAbi, functionName: "activeCount" });
  const borrowers = (await client.readContract({
    address: cfg.registry,
    abi: positionRegistryAbi,
    functionName: "activeBorrowers",
    args: [0n, count],
  })) as Address[];
  if (borrowers.length === 0) throw new Error("no active borrowers to measure");

  const data = encodeFunctionData({ abi: repricerAbi, functionName: "repriceMany", args: [borrowers, []] });
  const base = { account: account.address, to: cfg.repricer, data, blockTag: "latest" as const };
  const node = (await client.createAccessList(base)).accessList;
  const sent = await keeper.accessListFor(cfg.repricer, data, borrowers, []);
  const none = await client.estimateGas(base);
  const full = await client.estimateGas({ ...base, accessList: node });
  const paged = await client.estimateGas({ ...base, accessList: sent });
  const keys = (l: AccessList) => l.reduce((n, e) => n + e.storageKeys.length, 0);
  const exits: Record<string, unknown>[] = [];
  for (const b of borrowers) {
    const [status] = (await client.readContract({
      address: cfg.executor,
      abi: executorAbi,
      functionName: "previewExit",
      args: [b],
    })) as readonly [number, bigint, bigint, bigint];
    if (status !== 0) continue;
    const exitData = encodeFunctionData({ abi: executorAbi, functionName: "exit", args: [b, []] });
    const eBase = { account: account.address, to: cfg.executor, data: exitData, blockTag: "latest" as const };
    const eNode = (await client.createAccessList(eBase)).accessList;
    const eSent = await keeper.accessListFor(cfg.executor, exitData, [b], []);
    exits.push({
      borrower: b,
      noAccessList: (await client.estimateGas(eBase)).toString(),
      nodeAccessList: (await client.estimateGas({ ...eBase, accessList: eNode })).toString(),
      pagedAccessList: { gas: (await client.estimateGas({ ...eBase, accessList: eSent })).toString(), keys: keys(eSent) },
    });
  }
  console.log(
    JSON.stringify(
      {
        borrowers: borrowers.length,
        noAccessList: none.toString(),
        nodeAccessList: { gas: full.toString(), addresses: node.length, keys: keys(node) },
        pagedAccessList: { gas: paged.toString(), addresses: sent.length, keys: keys(sent) },
        pagesKeptOfNodeKeys: `${keys(compressToPages(node))}/${keys(node)}`,
        exits,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
