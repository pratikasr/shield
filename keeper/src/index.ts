/**
 * Shield keeper. Watches proposed blocks on Monad, reads every covered borrower's Aave health factor and exit
 * status, submits exits that are due and reprices covers on the configured cadence (docs/SPEC.md, Keeper).
 *
 *   pnpm --filter keeper dev      (reads keeper/.env; see keeper/.env.example)
 */
import { createPublicClient, defineChain, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";
import { loadConfig, type KeeperConfig } from "./config.js";
import { HeadWatcher } from "./heads.js";
import { Keeper } from "./keeper.js";
import { createLogger } from "./log.js";
import { Submitter } from "./submit.js";

export function chainFor(cfg: Pick<KeeperConfig, "chainId" | "rpcUrl">): Chain {
  const base = cfg.chainId === monad.id ? monad : cfg.chainId === monadTestnet.id ? monadTestnet : undefined;
  if (base) return { ...base, rpcUrls: { default: { http: [cfg.rpcUrl] } } };
  return defineChain({
    id: cfg.chainId,
    name: `chain-${cfg.chainId}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger(cfg.logLevel);
  const chain = chainFor(cfg);
  const client = createPublicClient({ chain, transport: http(cfg.rpcUrl, { retryCount: 2, timeout: 5_000 }) });
  const account = privateKeyToAccount(cfg.keeperKey);
  const submitter = new Submitter(client, account, chain, logger, {
    gasBufferBps: cfg.gasBufferBps,
    syncTimeoutMs: cfg.syncTimeoutMs,
  });
  const keeper = new Keeper(client, submitter, cfg, logger);
  const heads = new HeadWatcher({
    wsUrl: cfg.wsUrl,
    pollBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    pollIntervalMs: cfg.pollIntervalMs,
    logger,
  });

  const chainId = await client.getChainId();
  if (chainId !== cfg.chainId) throw new Error(`RPC chain id ${chainId} does not match CHAIN_ID ${cfg.chainId}`);
  logger.info("keeper.start", {
    chainId,
    keeper: account.address,
    registry: cfg.registry,
    repricer: cfg.repricer,
    executor: cfg.executor,
    heads: cfg.wsUrl ? "monadNewHeads" : "poll",
    hermes: cfg.hermesApiKey ? "on" : "off (push feeds)",
    dryRun: cfg.dryRun,
  });

  heads.on("head", (head) => {
    keeper.onHead(head).catch((err) => logger.error("keeper.pass_failed", { block: head.number, error: err }));
  });
  heads.start();

  const shutdown = () => {
    logger.info("keeper.stop");
    heads.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
