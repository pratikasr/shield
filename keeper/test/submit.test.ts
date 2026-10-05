import { HttpRequestError, createPublicClient, custom, keccak256, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/log.js";
import {
  FeeCapError,
  GasCeilingError,
  InsufficientFundsError,
  Submitter,
  TxInFlightError,
  isNodeSyncTimeout,
  isSyncUnsupported,
  withBuffer,
} from "../src/submit.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const TO = "0x1111111111111111111111111111111111111111";
const silent = createLogger("error", () => {});

/** A receipt; `gasUsed` defaults to the transaction's own limit, as Monad reports it for every transaction. */
function receipt(raw: Hex | undefined, hash: string, status = "0x1", gasUsed?: string) {
  const gas = gasUsed ?? (raw ? `0x${parseTransaction(raw).gas!.toString(16)}` : "0x186a0");
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: "0x" + "ab".repeat(32),
    blockNumber: "0x10",
    from: privateKeyToAccount(KEY).address,
    to: TO,
    cumulativeGasUsed: gas,
    gasUsed: gas,
    effectiveGasPrice: "0x174876e800",
    contractAddress: null,
    logs: [],
    logsBloom: "0x" + "00".repeat(256),
    status,
    type: "0x2",
  };
}

function txObject(hash: string) {
  return {
    hash,
    nonce: "0x7",
    blockHash: null,
    blockNumber: null,
    transactionIndex: null,
    from: privateKeyToAccount(KEY).address,
    to: TO,
    value: "0x0",
    gas: "0x186a0",
    maxFeePerGas: "0x174876e800",
    maxPriorityFeePerGas: "0x77359400",
    input: "0x",
    type: "0x2",
    chainId: "0x8f",
    v: "0x0",
    r: "0x1",
    s: "0x1",
    accessList: [],
  };
}

interface Script {
  estimate?: bigint;
  /** What eth_sendRawTransactionSync does on its nth call (1-based). Default: a successful receipt. */
  sync?: (raw: Hex, n: number) => unknown;
  /** eth_call replay of a reverted tx: throw this message, or succeed when undefined. */
  replayError?: string;
  /** Per-block replay errors, keyed by the block parameter ("0x10" or "latest"); overrides replayError. */
  replayAt?: Record<string, string>;
  /** Hashes whose receipt eth_getTransactionReceipt returns. */
  mined?: Set<string>;
  /** Hashes eth_getTransactionByHash knows (in the mempool). */
  known?: Set<string>;
  nonce?: number;
}

function client(script: Script, calls: string[], sent: Hex[] = []) {
  let syncCalls = 0;
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
            return `0x${(script.nonce ?? 7).toString(16)}`;
          case "eth_getBlockByNumber":
            return { baseFeePerGas: "0x174876e800", number: "0x10", timestamp: "0x1", transactions: [] };
          case "eth_maxPriorityFeePerGas":
            return "0x77359400";
          case "eth_sendRawTransactionSync": {
            const raw = (params as Hex[])[0]!;
            sent.push(raw);
            syncCalls += 1;
            if (script.sync) return script.sync(raw, syncCalls);
            return receipt(raw, keccak256(raw));
          }
          case "eth_sendRawTransaction": {
            const raw = (params as Hex[])[0]!;
            sent.push(raw);
            return keccak256(raw);
          }
          case "eth_call": {
            const at = String((params as unknown[])[1]);
            const error = script.replayAt ? script.replayAt[at] : script.replayError;
            if (error) throw Object.assign(new Error(error), { code: -32000 });
            return "0x";
          }
          case "eth_getTransactionReceipt": {
            const hash = (params as string[])[0]!;
            if (script.mined && !script.mined.has(hash)) return null;
            return receipt(undefined, hash);
          }
          case "eth_getTransactionByHash": {
            const hash = (params as string[])[0]!;
            return script.known?.has(hash) ? txObject(hash) : null;
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

function submitter(script: Script, calls: string[], sent: Hex[] = [], lines?: string[], opts: Record<string, number> = {}) {
  const logger = lines ? createLogger("debug", (l) => lines.push(l)) : silent;
  return new Submitter(client(script, calls, sent) as never, privateKeyToAccount(KEY), monad, logger, {
    gasBufferBps: 1_500,
    syncTimeoutMs: 2_000,
    ...opts,
  });
}

const exit = { label: "exit", to: TO, data: "0x1234" as Hex, maxGas: 3_000_000n } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("Submitter", () => {
  it("uses a measured limit: estimate plus the buffer", async () => {
    const s = submitter({ estimate: 200_000n }, []);
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
    const lines: string[] = [];
    const s = submitter({}, calls, [], lines);
    const r = await s.send({ label: "exit", to: TO, data: "0x1234", maxGas: 1_000_000n });
    expect(r.mode).toBe("sync");
    expect(r.receipt.status).toBe("success");
    expect(r.gasLimit).toBe(115_000n);
    expect(calls).toContain("eth_sendRawTransactionSync");
    expect(calls).not.toContain("eth_sendRawTransaction");
    // The log names the contract, so proof tooling can tell deployments apart.
    const included = lines.map((l) => JSON.parse(l)).find((l) => l.event === "tx.included");
    expect(included.to).toBe(TO);
  });

  it("falls back to eth_sendRawTransaction when the RPC lacks the sync method, and remembers it", async () => {
    const calls: string[] = [];
    const s = submitter({ sync: () => Promise.reject(Object.assign(new Error("Method not found"), { code: -32601 })) }, calls);
    const r = await s.send({ label: "exit", to: TO, data: "0x1234", maxGas: 1_000_000n });
    expect(r.mode).toBe("async");
    expect(s.syncSupported).toBe(false);
    expect(calls).toContain("eth_sendRawTransaction");
    expect(calls).toContain("eth_getTransactionReceipt");
    const before = calls.filter((c) => c === "eth_sendRawTransactionSync").length;
    await s.send({ label: "exit", to: TO, data: "0x1234", maxGas: 1_000_000n });
    expect(calls.filter((c) => c === "eth_sendRawTransactionSync").length).toBe(before);
  });

  it("waits for the receipt when the node's sync call times out (code 4)", async () => {
    const calls: string[] = [];
    const s = submitter({ sync: () => Promise.reject(Object.assign(new Error("request timed out"), { code: 4 })) }, calls);
    const r = await s.send({ label: "exit", to: TO, data: "0x1234", maxGas: 1_000_000n });
    expect(r.mode).toBe("async");
    expect(s.syncSupported).toBe(true);
  });

  it("resyncs the nonce after a nonce error", async () => {
    const calls: string[] = [];
    const s = submitter({ sync: () => Promise.reject(Object.assign(new Error("nonce too low"), { code: -32000 })) }, calls);
    await expect(s.send({ label: "exit", to: TO, data: "0x", maxGas: 1_000_000n })).rejects.toThrow();
    expect(calls.filter((c) => c === "eth_getTransactionCount").length).toBe(2);
    expect(s.pending).toBeUndefined();
  });

  it("raises the gas buffer when a reverted transaction's replay runs out of gas", async () => {
    const lines: string[] = [];
    const s = submitter(
      { sync: (raw) => receipt(raw, keccak256(raw), "0x0"), replayError: "out of gas" },
      [],
      [],
      lines,
    );
    const r = await s.send({ label: "exit", to: TO, data: "0x", maxGas: 1_000_000n });
    expect(r.receipt.status).toBe("reverted");
    expect(r.outOfGas).toBe(true);
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
    expect(isSyncUnsupported(new Error("transaction type not supported"))).toBe(false);
  });

  it("reuses fee data for a few blocks instead of two round trips per send (audit H5)", async () => {
    const calls: string[] = [];
    const s = submitter({}, calls);
    await s.send({ label: "repriceMany", to: TO, data: "0x01", maxGas: 1_000_000n }, 200_000n);
    await s.send({ label: "repriceMany", to: TO, data: "0x02", maxGas: 1_000_000n }, 200_000n);
    expect(calls.filter((c) => c === "eth_maxPriorityFeePerGas")).toHaveLength(1);
    expect(calls.filter((c) => c === "eth_getBlockByNumber")).toHaveLength(1);
    expect(calls.filter((c) => c === "eth_estimateGas")).toHaveLength(0); // the given limit is used as is
  });

  it("skips a send whose fee is above the cap", async () => {
    const s = submitter({}, []);
    await expect(
      s.send({ label: "repriceMany", to: TO, data: "0x", maxGas: 1_000_000n, maxFeePerGasCap: 1n }),
    ).rejects.toBeInstanceOf(FeeCapError);
  });
});

describe("Submitter on Monad receipts (audit H2)", () => {
  it("does not count an ordinary revert as out of gas, so later exits keep their normal limit", async () => {
    // Monad reports gasUsed == gasLimit for every receipt. These exits revert because, say, another caller
    // exited first: the replay reverts with a reason, not out of gas.
    const lines: string[] = [];
    const script: Script = { sync: (raw) => receipt(raw, keccak256(raw), "0x0"), replayError: "execution reverted: NotActive" };
    const s = submitter(script, [], [], lines);
    for (let i = 0; i < 4; i++) {
      const r = await s.send(exit);
      expect(r.outOfGas).toBe(false);
    }
    expect(s.extraBufferBps.get("exit")).toBeUndefined();
    expect(lines.map((l) => JSON.parse(l).event)).toContain("tx.reverted");
    // A flash-loan exit measured at 1.4M gas fits under MAX_GAS_EXIT=3M: 1.4M x 1.15 = 1.61M.
    script.estimate = 1_400_000n;
    expect(await s.measureGas(exit)).toBe(1_610_000n);
  });

  it("replays on the latest block when the node has no state for the receipt's block", async () => {
    const calls: string[] = [];
    const s = submitter(
      {
        sync: (raw) => receipt(raw, keccak256(raw), "0x0"),
        replayAt: { "0x10": "missing trie node", latest: "out of gas" },
      },
      calls,
    );
    const r = await s.send(exit);
    expect(r.outOfGas).toBe(true);
    expect(calls.filter((c) => c === "eth_call")).toHaveLength(2);
    expect(s.extraBufferBps.get("exit")).toBe(2_000);
  });

  it("never refuses an exit because of an extra buffer: the ceiling ignores it and caps it", async () => {
    const s = submitter({ estimate: 1_400_000n }, []);
    s.extraBufferBps.set("exit", 10_000); // after several genuine out-of-gas reverts
    // 1.4M x (1 + 0.15 + 1.00) = 3.01M would exceed 3M; the limit is capped at the ceiling instead.
    expect(await s.measureGas(exit)).toBe(3_000_000n);
    // A transaction that does not fit even without the extra buffer is still refused.
    const big = submitter({ estimate: 2_700_000n }, []);
    await expect(big.measureGas(exit)).rejects.toBeInstanceOf(GasCeilingError);
  });
});

describe("Submitter after unclear send failures (audit M1, M2)", () => {
  it("stops waiting a few seconds after a node sync timeout instead of 180 s", async () => {
    vi.useFakeTimers();
    const s = submitter({ sync: () => Promise.reject(Object.assign(new Error("request timed out"), { code: 4 })), mined: new Set() }, []);
    let settled: string | undefined;
    const p = s.send(exit).then(
      () => (settled = "resolved"),
      (e: Error) => (settled = e.name),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    expect(settled).toBe("TxInFlightError");
    await expect(s.send(exit)).rejects.toBeInstanceOf(TxInFlightError);
    expect(s.pending?.known).toBe(true);
  });

  it("does not treat a proxy 504 mentioning a timeout as a node sync timeout; it checks the hash", async () => {
    const calls: string[] = [];
    const gateway = new HttpRequestError({ url: "https://rpc.example/key", status: 504, details: "Gateway Timeout" });
    expect(isNodeSyncTimeout(gateway)).toBe(false);
    const s = submitter({ sync: () => Promise.reject(gateway), mined: new Set() }, calls);
    await expect(s.send(exit)).rejects.toBeInstanceOf(TxInFlightError);
    expect(calls).toContain("eth_getTransactionByHash");
    expect(calls).not.toContain("eth_getTransactionReceipt"); // no 180 s receipt wait
  });

  it("never signs the next transaction with the nonce of one that may be in flight", async () => {
    // The node took the exit, but the HTTP response was lost (load balancer reset).
    const sent: Hex[] = [];
    const known = new Set<string>();
    const mined = new Set<string>();
    const script: Script = {
      known,
      mined,
      sync: (raw, n) => {
        if (n === 1) {
          known.add(keccak256(raw));
          throw new Error("upstream connect error or disconnect/reset before headers");
        }
        return receipt(raw, keccak256(raw));
      },
    };
    const lines: string[] = [];
    const s = submitter(script, [], sent, lines);
    await expect(s.send(exit)).rejects.toBeInstanceOf(TxInFlightError);
    const exitHash = keccak256(sent[0]!);
    expect(s.pending?.hash).toBe(exitHash);
    // The reprice in the same pass is refused while the exit may land; nothing new is signed.
    await expect(s.send({ label: "repriceMany", to: TO, data: "0xbbbb", maxGas: 6_000_000n })).rejects.toBeInstanceOf(
      TxInFlightError,
    );
    expect(sent).toHaveLength(1);
    // The exit lands: the next transaction takes the following nonce.
    mined.add(exitHash);
    await s.send({ label: "repriceMany", to: TO, data: "0xbbbb", maxGas: 6_000_000n });
    expect(sent.map((r) => parseTransaction(r).nonce)).toEqual([7, 8]);
    // The late inclusion is logged like any other, with the contract and the gas limit, for scripts/proof.sh.
    const late = lines.map((l) => JSON.parse(l)).find((l) => l.event === "tx.included" && l.late);
    expect(late).toMatchObject({ label: "exit", to: TO, hash: exitHash, gasLimit: "115000" });
  });

  it("reuses the nonce only after an unknown hash has stayed unknown past the grace period", async () => {
    const sent: Hex[] = [];
    const lines: string[] = [];
    const script: Script = {
      mined: new Set(),
      sync: (raw, n) => {
        if (n === 1) throw new Error("socket hang up");
        return receipt(raw, keccak256(raw));
      },
    };
    const s = submitter(script, [], sent, lines, { ambiguousGraceMs: 30 });
    await expect(s.send(exit)).rejects.toBeInstanceOf(TxInFlightError);
    expect(s.pending?.known).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    await s.send({ label: "repriceMany", to: TO, data: "0xbbbb", maxGas: 6_000_000n });
    expect(sent.map((r) => parseTransaction(r).nonce)).toEqual([7, 7]); // the first one never reached a node
    expect(lines.map((l) => JSON.parse(l).event)).toContain("tx.dropped");
  });

  it("treats 'already known' as in flight", async () => {
    const s = submitter({ sync: () => Promise.reject(Object.assign(new Error("already known"), { code: -32000 })), mined: new Set() }, []);
    await expect(s.send(exit)).rejects.toBeInstanceOf(TxInFlightError);
    expect(s.pending?.known).toBe(true);
  });

  it("resyncs the nonce after 'replacement transaction underpriced' and 'insufficient funds'", async () => {
    const calls: string[] = [];
    const s = submitter(
      { sync: () => Promise.reject(Object.assign(new Error("replacement transaction underpriced"), { code: -32000 })) },
      calls,
    );
    await expect(s.send(exit)).rejects.toThrow(/underpriced/);
    expect(calls.filter((c) => c === "eth_getTransactionCount")).toHaveLength(2);
    expect(s.pending).toBeUndefined();

    const calls2: string[] = [];
    const poor = submitter(
      { sync: () => Promise.reject(Object.assign(new Error("insufficient funds for gas * price + value"), { code: -32000 })) },
      calls2,
    );
    await expect(poor.send(exit)).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(calls2.filter((c) => c === "eth_getTransactionCount")).toHaveLength(2);
    expect(poor.pending).toBeUndefined();
  });

  it("lets a definite RPC rejection free the nonce at once", async () => {
    const sent: Hex[] = [];
    const s = submitter(
      {
        mined: new Set(),
        sync: (raw, n) => {
          if (n === 1) throw Object.assign(new Error("invalid sender"), { code: -32602 });
          return receipt(raw, keccak256(raw));
        },
      },
      [],
      sent,
    );
    await expect(s.send(exit)).rejects.toThrow();
    expect(s.pending).toBeUndefined();
    await s.send(exit);
    expect(sent.map((r) => parseTransaction(r).nonce)).toEqual([7, 7]);
  });
});
