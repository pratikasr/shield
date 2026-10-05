import { readFileSync, statSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address")
  .transform((a) => getAddress(a));

const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte private key");

/** Monad's public RPCs; the keeper reads through the next one when the configured RPC fails (chain 143 only). */
export const MONAD_PUBLIC_RPCS = ["https://rpc.monad.xyz", "https://rpc1.monad.xyz"];

const EnvSchema = z.object({
  MONAD_RPC_URL: z.string().url(),
  MONAD_WS_URL: z.string().optional(),
  CHAIN_ID: z.coerce.number().int().positive(),
  KEEPER_PRIVATE_KEY: privateKey.optional(),
  KEEPER_PRIVATE_KEY_FILE: z.string().optional(),
  KEEPER_LOCK_FILE: z.string().optional(),
  SHIELD_DEPLOYMENT_FILE: z.string().optional(),
  SHIELD_REGISTRY: address.optional(),
  SHIELD_REPRICER: address.optional(),
  SHIELD_EXECUTOR: address.optional(),
  RPC_FALLBACK_URLS: z.string().optional(),
  PYTH_HERMES_URL: z.string().url().default("https://hermes.pyth.network"),
  PYTH_HERMES_API_KEY: z.string().optional(),
  REPRICE_EVERY_N_BLOCKS: z.coerce.number().int().min(0).default(1),
  REPRICE_WINDOW_BLOCKS: z.coerce.number().int().min(0).default(600),
  REPRICE_IDLE_EVERY_N_BLOCKS: z.coerce.number().int().min(0).default(200),
  MIN_BALANCE_FOR_EXIT_WEI: z.coerce.bigint().default(200_000_000_000_000_000n),
  MAX_FEE_PER_GAS_REPRICE_WEI: z.coerce.bigint().optional(),
  GAS_BUFFER_BPS: z.coerce.number().int().min(0).max(10_000).default(1_500),
  MAX_GAS_EXIT: z.coerce.bigint().default(3_000_000n),
  MAX_GAS_REPRICE: z.coerce.bigint().default(6_000_000n),
  REPRICE_GAS_HEADROOM: z.coerce.bigint().default(25_000n),
  POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(150),
  SYNC_TIMEOUT_MS: z.coerce.number().int().min(100).default(2_000),
  DRY_RUN: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((v) => v === "1" || v === "true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface KeeperConfig {
  rpcUrl: string;
  wsUrl?: string;
  /** Extra read RPCs tried in order after rpcUrl fails or times out. Never used for sending. */
  fallbackRpcUrls?: string[];
  chainId: number;
  keeperKey: Hex;
  /** Single-instance lock; defaults to keeper/.keeper-<chainId>-<keeper address>.lock. */
  lockFile?: string;
  registry: Address;
  repricer: Address;
  executor: Address;
  hermesUrl: string;
  hermesApiKey?: string;
  repriceEveryNBlocks: number;
  repriceWindowBlocks: number;
  repriceIdleEveryNBlocks: number;
  /** Below this keeper balance, reprices stop so the balance is kept for exits. */
  minBalanceForExitWei: bigint;
  /** Reprices are skipped while maxFeePerGas is above this. */
  maxFeePerGasRepriceWei?: bigint;
  gasBufferBps: number;
  maxGasExit: bigint;
  maxGasReprice: bigint;
  repriceGasHeadroom: bigint;
  pollIntervalMs: number;
  syncTimeoutMs: number;
  dryRun: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

/** Treats an empty value as unset, so `cp .env.example .env` gives the documented defaults, not zeros. */
function withoutBlanks(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v.trim() !== "") out[k] = v.trim();
  }
  return out;
}

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

function readKeyFile(path: string): Hex {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`KEEPER_PRIVATE_KEY_FILE ${path} is readable by other users (mode ${mode.toString(8)}); run chmod 600 on it`);
  }
  const key = readFileSync(path, "utf8").trim();
  const parsed = privateKey.safeParse(key);
  if (!parsed.success) throw new Error(`KEEPER_PRIVATE_KEY_FILE ${path} does not hold a 0x-prefixed 32-byte private key`);
  return parsed.data as Hex;
}

function fallbacks(raw: string | undefined, rpcUrl: string, chainId: number): string[] {
  if (raw === "off") return [];
  if (raw) {
    const urls = raw.split(",").map((u) => u.trim()).filter(Boolean);
    for (const u of urls) z.string().url().parse(u);
    return urls.filter((u) => u !== rpcUrl);
  }
  // Public mainnet RPCs only make sense next to a mainnet RPC; a fork on localhost has different state.
  if (chainId !== 143 || isLocal(rpcUrl)) return [];
  const own = rpcUrl.replace(/\/+$/, "");
  return MONAD_PUBLIC_RPCS.filter((u) => u !== own);
}

/** Reads the keeper's settings from the environment; contract addresses come from env or a deployment file. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const e = EnvSchema.parse(withoutBlanks(env));
  if (e.KEEPER_PRIVATE_KEY && e.KEEPER_PRIVATE_KEY_FILE) {
    throw new Error("set KEEPER_PRIVATE_KEY or KEEPER_PRIVATE_KEY_FILE, not both");
  }
  let keeperKey: Hex;
  if (e.KEEPER_PRIVATE_KEY_FILE) keeperKey = readKeyFile(e.KEEPER_PRIVATE_KEY_FILE);
  else if (e.KEEPER_PRIVATE_KEY) keeperKey = e.KEEPER_PRIVATE_KEY as Hex;
  else throw new Error("missing keeper key: set KEEPER_PRIVATE_KEY_FILE (a chmod 600 file) or KEEPER_PRIVATE_KEY");

  let fromFile: Record<string, string> = {};
  if (e.SHIELD_DEPLOYMENT_FILE) {
    fromFile = JSON.parse(readFileSync(e.SHIELD_DEPLOYMENT_FILE, "utf8")) as Record<string, string>;
  }
  const pick = (envName: string, envValue: Address | undefined, key: string): Address => {
    const inFile = fromFile[key];
    if (envValue && inFile && getAddress(inFile) !== envValue) {
      throw new Error(
        `${envName} ${envValue} does not match ${key} ${getAddress(inFile)} in ${e.SHIELD_DEPLOYMENT_FILE}; remove one`,
      );
    }
    const v = envValue ?? inFile;
    if (!v) throw new Error(`missing ${key} address: set ${envName} or SHIELD_DEPLOYMENT_FILE`);
    return getAddress(v);
  };
  return {
    rpcUrl: e.MONAD_RPC_URL,
    wsUrl: e.MONAD_WS_URL,
    fallbackRpcUrls: fallbacks(e.RPC_FALLBACK_URLS, e.MONAD_RPC_URL, e.CHAIN_ID),
    chainId: e.CHAIN_ID,
    keeperKey,
    lockFile: e.KEEPER_LOCK_FILE,
    registry: pick("SHIELD_REGISTRY", e.SHIELD_REGISTRY, "PositionRegistry"),
    repricer: pick("SHIELD_REPRICER", e.SHIELD_REPRICER, "Repricer"),
    executor: pick("SHIELD_EXECUTOR", e.SHIELD_EXECUTOR, "Executor"),
    hermesUrl: e.PYTH_HERMES_URL,
    hermesApiKey: e.PYTH_HERMES_API_KEY,
    repriceEveryNBlocks: e.REPRICE_EVERY_N_BLOCKS,
    repriceWindowBlocks: e.REPRICE_WINDOW_BLOCKS,
    repriceIdleEveryNBlocks: e.REPRICE_IDLE_EVERY_N_BLOCKS,
    minBalanceForExitWei: e.MIN_BALANCE_FOR_EXIT_WEI,
    maxFeePerGasRepriceWei: e.MAX_FEE_PER_GAS_REPRICE_WEI,
    gasBufferBps: e.GAS_BUFFER_BPS,
    maxGasExit: e.MAX_GAS_EXIT,
    maxGasReprice: e.MAX_GAS_REPRICE,
    repriceGasHeadroom: e.REPRICE_GAS_HEADROOM,
    pollIntervalMs: e.POLL_INTERVAL_MS,
    syncTimeoutMs: e.SYNC_TIMEOUT_MS,
    dryRun: e.DRY_RUN,
    logLevel: e.LOG_LEVEL,
  };
}

/** The strings that must never reach a log line: the RPC URLs, which may carry an API key. */
export function secretsOf(cfg: Pick<KeeperConfig, "rpcUrl" | "wsUrl" | "fallbackRpcUrls">): string[] {
  return [cfg.rpcUrl, cfg.wsUrl, ...(cfg.fallbackRpcUrls ?? [])].filter((u): u is string => !!u);
}
