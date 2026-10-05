import { createPublicClient, custom, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/log.js";
import { GasCeilingError, Submitter, isSyncUnsupported, withBuffer } from "../src/submit.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const TO = "0x1111111111111111111111111111111111111111";
const silent = createLogger("error", () => {});

function receipt(hash: string, status = "0x1", gasUsed = "0x186a0") {
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: "0x" + "ab".repeat(32),
    blockNumber: "0x10",
    from: privateKeyToAccount(KEY).address,
    to: TO,
    cumulativeGasUsed: gasUsed,
    gasUsed,
    effectiveGasPrice: "0x174876e800",
    contractAddress: null,
    logs: [],
    logsBloom: "0x" + "00".repeat(256),
    status,
    type: "0x2",
  };
}

interface Script {
  estimate?: bigint;
  sync?: "receipt" | "unsupported" | "nonce-too-low" | "timeout" | "reverted-oog";
  nonce?: number;
}

function client(script: Script, calls: string[]) {
  let nonceCalls = 0;
  return createPublicClient({
    chain: monad,
    transport: custom({
      async request({ method, params }) {
        calls.push(method);
        switch (method) {
          case "eth_chainId":
            return "0x8f";
          case "eth_estimateGas":
            return `0x${(script.estimate ?? 100_000n).toString(16)}`;
          case "eth_getTransactionCount":
            nonceCalls += 1;
            return `0x${((script.nonce ?? 7) + nonceCalls - 1).toString(16)}`;
          case "eth_getBlockByNumber":
            return { baseFeePerGas: "0x174876e800", number: "0x10", timestamp: "0x1", transactions: [] };
          case "eth_maxPriorityFeePerGas":
            return "0x77359400";
          case "eth_sendRawTransactionSync": {
            if (script.sync === "unsupported") throw Object.assign(new Error("Method not found"), { code: -32601 });
            if (script.sync === "nonce-too-low") throw Object.assign(new Error("nonce too low"), { code: -32000 });
            if (script.sync === "timeout") throw Object.assign(new Error("request timed out"), { code: 4 });
            const raw = (params as Hex[])[0]!;
            const { keccak256 } = await import("viem");
            if (script.sync === "reverted-oog") return receipt(keccak256(raw), "0x0", "0x1c138");
            return receipt(keccak256(raw));
          }
          case "eth_sendRawTransaction": {
            const { keccak256 } = await import("viem");
            return keccak256((params as Hex[])[0]!);
          }
          case "eth_getTransactionReceipt": {
            const hash = (params as string[])[0]!;
            return receipt(hash);
          }
          case "eth_blockNumber":
            return "0x10";
          default:
            throw new Error(`unexpected ${method}`);
        }
      },
    }),
  });
}

function submitter(script: Script, calls: string[]) {
  return new Submitter(client(script, calls) as never, privateKeyToAccount(KEY), monad, silent, {
    gasBufferBps: 1_500,
    syncTimeoutMs: 2_000,
  });
}

describe("Submitter", () => {
  it("uses a measured limit: estimate plus the buffer", async () => {
    const calls: string[] = [];
    const s = submitter({ estimate: 200_000n }, calls);
    expect(await s.measureGas({ label: "exit", to: TO, data: "0x", maxGas: 1_000_000n })).toBe(230_000n);
    expect(withBuffer(100_000n, 0)).toBe(100_000n);
  });

  it("refuses a limit above the ceiling", async () => {
    const s = submitter({ estimate: 2_000_000n }, []);
    await expect(s.measureGas({ label: "exit", to: TO, data: "0x", maxGas: 1_000_000n })).rejects.toBeInstanceOf(
      GasCeilingError,
    );
  });

  it("sends with eth_sendRawTransactionSync and gets the receipt in one call", async () => {
    const calls: string[] = [];
    const s = submitter({ sync: "receipt" }, calls);
    const r = await s.send({ label: "exit", to: TO, data: "0x1234", maxGas: 1_000_000n });
    expect(r.mode).toBe("sync");
    expect(r.receipt.status).toBe("success");
    expect(r.gasLimit).toBe(115_000n);
    expect(calls).toContain("eth_sendRawTransactionSync");
    expect(calls).not.toContain("eth_sendRawTransaction");
  });

  it("falls back to eth_sendRawTransaction when the RPC lacks the sync method, and remembers it", async () => {
    const calls: string[] = [];
    const s = submitter({ sync: "unsupported" }, calls);
    const r = await s.send({ label: "exit", to: TO, data: "0x1234", maxGas: 1_000_000n });
    expect(r.mode).toBe("async");
    expect(s.syncSupported).toBe(false);
    expect(calls).toContain("eth_sendRawTransaction");
    expect(calls).toContain("eth_getTransactionReceipt");
    const before = calls.filter((c) => c === "eth_sendRawTransactionSync").length;
    await s.send({ label: "exit", to: TO, data: "0x1234", maxGas: 1_000_000n });
    expect(calls.filter((c) => c === "eth_sendRawTransactionSync").length).toBe(before);
  });

  it("waits for the receipt when the sync call times out", async () => {
    const calls: string[] = [];
    const s = submitter({ sync: "timeout" }, calls);
    const r = await s.send({ label: "exit", to: TO, data: "0x1234", maxGas: 1_000_000n });
    expect(r.mode).toBe("async");
    expect(s.syncSupported).toBe(true);
  });

  it("resyncs the nonce after a nonce error", async () => {
    const calls: string[] = [];
    const s = submitter({ sync: "nonce-too-low" }, calls);
    await expect(s.send({ label: "exit", to: TO, data: "0x", maxGas: 1_000_000n })).rejects.toThrow();
    expect(calls.filter((c) => c === "eth_getTransactionCount").length).toBe(2);
  });

  it("raises the gas buffer after an out-of-gas revert", async () => {
    const calls: string[] = [];
    const s = submitter({ sync: "reverted-oog" }, calls);
    const r = await s.send({ label: "exit", to: TO, data: "0x", maxGas: 1_000_000n });
    expect(r.receipt.status).toBe("reverted");
    expect(s.extraBufferBps.get("exit")).toBe(2_000);
    expect(await s.measureGas({ label: "exit", to: TO, data: "0x", maxGas: 1_000_000n })).toBe(135_000n);
  });

  it("adds fixed headroom on top of the buffered estimate", async () => {
    const s = submitter({ estimate: 100_000n }, []);
    expect(await s.measureGas({ label: "repriceMany", to: TO, data: "0x", maxGas: 1_000_000n, headroom: 40_000n })).toBe(
      155_000n,
    );
  });

  it("recognises unsupported-method errors", () => {
    expect(isSyncUnsupported(Object.assign(new Error("x"), { code: -32601 }))).toBe(true);
    expect(isSyncUnsupported(new Error("the method eth_sendRawTransactionSync does not exist"))).toBe(true);
    expect(isSyncUnsupported(new Error("execution reverted"))).toBe(false);
  });
});
