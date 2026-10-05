import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { HeadWatcher, type Head } from "../src/heads.js";
import { createLogger } from "../src/log.js";
import { Submitter } from "../src/submit.js";

/**
 * Live smoke test against a real Monad network, off by default (ADR-011).
 *   LIVE_SMOKE=1 MONAD_SMOKE_WS_URL=wss://testnet-rpc.monad.xyz MONAD_SMOKE_RPC_URL=https://testnet-rpc.monad.xyz pnpm test
 * Add MONAD_SMOKE_PRIVATE_KEY (a funded testnet key) to also send a zero-value self-transfer through
 * eth_sendRawTransactionSync and check the receipt comes back from the proposed block.
 */
const live = process.env.LIVE_SMOKE === "1";
const wsUrl = process.env.MONAD_SMOKE_WS_URL ?? "wss://rpc.monad.xyz";
const rpcUrl = process.env.MONAD_SMOKE_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const key = process.env.MONAD_SMOKE_PRIVATE_KEY as Hex | undefined;

describe.skipIf(!live)("live Monad smoke", () => {
  it("receives Proposed heads through monadNewHeads", async () => {
    const heads: Head[] = [];
    const w = new HeadWatcher({
      wsUrl,
      pollBlockNumber: async () => 0n,
      pollIntervalMs: 1_000,
      logger: createLogger("error"),
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no heads within 10 s")), 10_000);
      w.on("head", (h: Head) => {
        heads.push(h);
        if (heads.length === 5) {
          clearTimeout(timer);
          resolve();
        }
      });
      w.start();
    });
    w.stop();
    expect(heads.every((h) => h.source === "monadNewHeads" && h.commitState === "Proposed")).toBe(true);
    for (let i = 1; i < heads.length; i++) expect(heads[i]!.number).toBeGreaterThan(heads[i - 1]!.number);
  }, 15_000);

  it.skipIf(!key)("returns a receipt from eth_sendRawTransactionSync", async () => {
    const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });
    const account = privateKeyToAccount(key!);
    const s = new Submitter(client as never, account, monadTestnet, createLogger("error"), {
      gasBufferBps: 1_000,
      syncTimeoutMs: 3_000,
    });
    const r = await s.send({ label: "smoke", to: account.address, data: "0x", maxGas: 100_000n });
    expect(r.mode).toBe("sync");
    expect(r.receipt.status).toBe("success");
  }, 20_000);
});
