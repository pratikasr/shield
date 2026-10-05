import { createPublicClient, http, type Hex } from "viem";
import { monad } from "viem/chains";
import { describe, expect, it } from "vitest";
import type { KeeperConfig } from "../src/config.js";
import { secretsOf } from "../src/config.js";
import { Keeper } from "../src/keeper.js";
import { REDACTED, createLogger, redact, redactionsFor } from "../src/log.js";

const SECRET_URL = "http://127.0.0.1:9/v2/SECRET-API-KEY-123";

const cfg: KeeperConfig = {
  rpcUrl: SECRET_URL,
  chainId: 143,
  keeperKey: ("0x" + "11".repeat(32)) as Hex,
  registry: "0x1111111111111111111111111111111111111111",
  repricer: "0x2222222222222222222222222222222222222222",
  executor: "0x3333333333333333333333333333333333333333",
  hermesUrl: "https://hermes.test",
  repriceEveryNBlocks: 1,
  repriceWindowBlocks: 0,
  repriceIdleEveryNBlocks: 0,
  minBalanceForExitWei: 0n,
  gasBufferBps: 1_500,
  maxGasExit: 3_000_000n,
  maxGasReprice: 6_000_000n,
  repriceGasHeadroom: 25_000n,
  pollIntervalMs: 150,
  syncTimeoutMs: 2_000,
  dryRun: false,
  logLevel: "error",
};

describe("logs never carry an RPC URL (audit M7)", () => {
  it("logs a failed read by its short message, without the URL and its API key", async () => {
    const client = createPublicClient({ chain: monad, transport: http(SECRET_URL, { retryCount: 0, timeout: 1_000 }) });
    const lines: string[] = [];
    // No redaction list: the error serialiser alone must keep the URL out.
    const k = new Keeper(client as never, { address: cfg.registry } as never, cfg, createLogger("info", (l) => lines.push(l)));
    await k.onHead({ number: 1n, source: "poll", receivedAt: Date.now() });
    const failed = lines.find((l) => JSON.parse(l).event === "block.read_failed")!;
    expect(failed).toBeDefined();
    expect(failed).not.toContain("SECRET-API-KEY-123");
    expect(failed).not.toContain("127.0.0.1:9");
    expect(JSON.parse(failed).error.message).toMatch(/HTTP request failed/);
  });

  it("redacts every configured URL, its path and its query from any line", () => {
    const lines: string[] = [];
    const logger = createLogger("info", (l) => lines.push(l), {
      redact: secretsOf({ rpcUrl: "https://monad.example/v2/KEY-1", wsUrl: "wss://ws.example/?apikey=KEY-2", fallbackRpcUrls: [] }),
    });
    logger.info("x", {
      a: "posting to https://monad.example/v2/KEY-1 failed",
      b: "path /v2/KEY-1",
      c: "query apikey=KEY-2",
      d: new Error("connect wss://ws.example/?apikey=KEY-2"),
    });
    expect(lines[0]).not.toMatch(/KEY-1|KEY-2/);
    expect(lines[0]).toContain(REDACTED);
  });

  it("leaves lines alone when there is nothing secret", () => {
    expect(redactionsFor(["https://rpc.monad.xyz"])).not.toContain("/");
    expect(redact('{"event":"block","source":"poll"}', redactionsFor(["https://rpc.monad.xyz"]))).toBe(
      '{"event":"block","source":"poll"}',
    );
  });
});

