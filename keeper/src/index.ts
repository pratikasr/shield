/**
 * Shield keeper. Watches proposed blocks on Monad, reads every covered borrower's Aave health factor and exit
 * status, submits exits that are due, reprices covers on the configured cadence (docs/SPEC.md, Keeper) and sweeps
 * USDC waiting at deposit addresses into Shield (ADR-039).
 *
 *   pnpm --filter keeper dev      (reads keeper/.env; see keeper/.env.example)
 */
import { pathToFileURL } from "node:url";
import { createPublicClient, defineChain, fallback, http, type Chain, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";
import { loadConfig, secretsOf, type KeeperConfig } from "./config.js";
import { HeadWatcher } from "./heads.js";
import { Keeper } from "./keeper.js";
import { acquireLock, defaultLockPath } from "./lock.js";
import { createLogger, describeError, redact, redactionsFor } from "./log.js";
import { verifyDeployment } from "./startup.js";
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

/**
 * Reads go to the configured RPC first and, when fallbacks are configured (mainnet default: the public Monad
 * RPCs), to the next one after a 1 s timeout. Without fallbacks (a local fork) reads keep a 5 s timeout.
 */
export function readTransport(cfg: Pick<KeeperConfig, "rpcUrl" | "fallbackRpcUrls">): Transport {
  const extra = cfg.fallbackRpcUrls ?? [];
  if (extra.length === 0) return http(cfg.rpcUrl, { retryCount: 2, timeout: 5_000 });
  return fallback(
    [cfg.rpcUrl, ...extra].map((u) => http(u, { retryCount: 0, timeout: 1_000 })),
    { retryCount: 1 },
  );
}

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger(cfg.logLevel, undefined, { redact: secretsOf(cfg) });
  const chain = chainFor(cfg);
  const client = createPublicClient({ chain, transport: readTransport(cfg) });
  // Transactions go to the configured RPC only, never retried by the transport: a resend is decided by the
  // submitter after it has looked the hash up.
  const sendClient = createPublicClient({
    chain,
    transport: http(cfg.rpcUrl, { retryCount: 0, timeout: cfg.syncTimeoutMs + 3_000 }),
  });
  const account = privateKeyToAccount(cfg.keeperKey);
  // One keeper per (chain, account): a second one would race this one's nonces.
  const lock = acquireLock(cfg.lockFile ?? defaultLockPath(cfg.chainId, account.address));
  process.on("exit", () => lock.release());

  const chainId = await client.getChainId();
  if (chainId !== cfg.chainId) throw new Error(`RPC chain id ${chainId} does not match CHAIN_ID ${cfg.chainId}`);
  await verifyDeployment(client, cfg);

  const submitter = new Submitter(client, account, chain, logger, {
    gasBufferBps: cfg.gasBufferBps,
    syncTimeoutMs: cfg.syncTimeoutMs,
    sendClient,
  });
  const keeper = new Keeper(client, submitter, cfg, logger);
  const heads = new HeadWatcher({
    wsUrl: cfg.wsUrl,
    pollBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    pollIntervalMs: cfg.pollIntervalMs,
    expectedChainId: cfg.chainId,
    logger,
  });

  logger.info("keeper.start", {
    chainId,
    keeper: account.address,
    registry: cfg.registry,
    repricer: cfg.repricer,
    executor: cfg.executor,
    forwarders: cfg.forwarders ?? "none (no sweeps)",
    sweepEveryNBlocks: cfg.forwarders ? cfg.sweepEveryNBlocks : 0,
    sweepMinUnits: cfg.sweepMinUnits,
    heads: cfg.wsUrl ? "monadNewHeads" : "poll",
    readFallbacks: cfg.fallbackRpcUrls?.length ?? 0,
    hermes: cfg.hermesApiKey ? "on" : "off (push feeds)",
    repriceWindowBlocks: cfg.repriceWindowBlocks,
    repriceIdleEveryNBlocks: cfg.repriceIdleEveryNBlocks,
    minBalanceForExitWei: cfg.minBalanceForExitWei,
    lock: lock.path,
    dryRun: cfg.dryRun,
  });

  heads.on("head", (head) => {
    keeper.onHead(head).catch((err) => logger.error("keeper.pass_failed", { block: head.number, error: err }));
  });
  heads.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    heads.stop();
    logger.info("keeper.stopping", { signal });
    const idle = await keeper.stop(10_000);
    logger.info("keeper.stop", { signal, sendInFlightAtExit: !idle });
    lock.release();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/** True when this module is the process entry point (works with spaces and other escaped characters in paths). */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  return !!argv1 && moduleUrl === pathToFileURL(argv1).href;
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  main().catch((err) => {
    // Startup errors go to stderr without viem's full message, which can repeat the RPC URL.
    let secrets: string[] = [];
    try {
      secrets = redactionsFor(secretsOf(loadConfig()));
    } catch {
      // config itself failed; nothing configured to redact
    }
    const d = describeError(err);
    console.error(redact(`keeper failed to start: ${d.message}${d.details ? ` (${d.details})` : ""}`, secrets));
    process.exit(1);
  });
}
