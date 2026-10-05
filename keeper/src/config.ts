import { readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address")
  .transform((a) => getAddress(a));

const EnvSchema = z.object({
  MONAD_RPC_URL: z.string().url(),
  MONAD_WS_URL: z.string().optional(),
  CHAIN_ID: z.coerce.number().int().positive(),
  KEEPER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte private key"),
  SHIELD_DEPLOYMENT_FILE: z.string().optional(),
  SHIELD_REGISTRY: address.optional(),
  SHIELD_REPRICER: address.optional(),
  SHIELD_EXECUTOR: address.optional(),
  PYTH_HERMES_URL: z.string().url().default("https://hermes.pyth.network"),
  PYTH_HERMES_API_KEY: z.string().optional(),
  REPRICE_EVERY_N_BLOCKS: z.coerce.number().int().min(0).default(1),
  REPRICE_WINDOW_BLOCKS: z.coerce.number().int().min(0).default(0),
  REPRICE_IDLE_EVERY_N_BLOCKS: z.coerce.number().int().min(0).default(200),
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
  chainId: number;
  keeperKey: Hex;
  registry: Address;
  repricer: Address;
  executor: Address;
  hermesUrl: string;
  hermesApiKey?: string;
  repriceEveryNBlocks: number;
  repriceWindowBlocks: number;
  repriceIdleEveryNBlocks: number;
  gasBufferBps: number;
  maxGasExit: bigint;
  maxGasReprice: bigint;
  repriceGasHeadroom: bigint;
  pollIntervalMs: number;
  syncTimeoutMs: number;
  dryRun: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

/** Reads the keeper's settings from the environment; contract addresses come from env or a deployment file. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const e = EnvSchema.parse(env);
  let fromFile: Record<string, string> = {};
  if (e.SHIELD_DEPLOYMENT_FILE) {
    fromFile = JSON.parse(readFileSync(e.SHIELD_DEPLOYMENT_FILE, "utf8")) as Record<string, string>;
  }
  const pick = (envValue: Address | undefined, key: string): Address => {
    const v = envValue ?? fromFile[key];
    if (!v) throw new Error(`missing ${key} address: set SHIELD_${key.toUpperCase()} or SHIELD_DEPLOYMENT_FILE`);
    return getAddress(v);
  };
  return {
    rpcUrl: e.MONAD_RPC_URL,
    wsUrl: e.MONAD_WS_URL || undefined,
    chainId: e.CHAIN_ID,
    keeperKey: e.KEEPER_PRIVATE_KEY as Hex,
    registry: pick(e.SHIELD_REGISTRY, "PositionRegistry"),
    repricer: pick(e.SHIELD_REPRICER, "Repricer"),
    executor: pick(e.SHIELD_EXECUTOR, "Executor"),
    hermesUrl: e.PYTH_HERMES_URL,
    hermesApiKey: e.PYTH_HERMES_API_KEY || undefined,
    repriceEveryNBlocks: e.REPRICE_EVERY_N_BLOCKS,
    repriceWindowBlocks: e.REPRICE_WINDOW_BLOCKS,
    repriceIdleEveryNBlocks: e.REPRICE_IDLE_EVERY_N_BLOCKS,
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
