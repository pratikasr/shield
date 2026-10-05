import {
  createPublicClient,
  custom,
  decodeFunctionData,
  keccak256,
  parseTransaction,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executorAbi } from "../src/abi/Executor.js";
import { repricerAbi } from "../src/abi/Repricer.js";
import { coversPages } from "../src/accessList.js";
import type { KeeperConfig } from "../src/config.js";
import type { Head } from "../src/heads.js";
import { Keeper } from "../src/keeper.js";
import { createLogger } from "../src/log.js";
import { Submitter, TxInFlightError, type TxRequest } from "../src/submit.js";

const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const REPRICER = "0x2222222222222222222222222222222222222222" as Address;
const EXECUTOR = "0x3333333333333333333333333333333333333333" as Address;
const PYTH = "0x5555555555555555555555555555555555555555" as Address;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const KEEPER = "0x9999999999999999999999999999999999999999" as Address;
const ALICE = "0x000000000000000000000000000000000000A11c" as Address;
const BOB = "0x000000000000000000000000000000000000B0B0" as Address;
const CAROL = "0x000000000000000000000000000000000000ca01" as Address;
const DAVE = "0x000000000000000000000000000000000000dA7E" as Address;
const RECORD_SLOT = 128n * 4242n;
const VOL_SLOT = 128n * 99n;
const WAD = 10n ** 18n;
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

const cfg: KeeperConfig = {
  rpcUrl: "http://test",
  chainId: 143,
  keeperKey: ("0x" + "11".repeat(32)) as Hex,
  registry: REGISTRY,
  repricer: REPRICER,
  executor: EXECUTOR,
  hermesUrl: "https://hermes.test",
  repriceEveryNBlocks: 1,
  repriceWindowBlocks: 0,
  repriceIdleEveryNBlocks: 0,
  minBalanceForExitWei: 200_000_000_000_000_000n,
  gasBufferBps: 1_500,
  maxGasExit: 3_000_000n,
  maxGasReprice: 6_000_000n,
  repriceGasHeadroom: 25_000n,
  pollIntervalMs: 150,
  syncTimeoutMs: 2_000,
  dryRun: false,
  logLevel: "error",
};

interface RecordView {
  trigger: number;
  flags: number;
  collateralId: number;
  prepaid: bigint;
  optedInAt: bigint;
}

interface World {
  borrowers: Address[];
  /** previewExit status per borrower (default 3, AboveTrigger). */
  status?: Record<string, number>;
  hf?: Record<string, bigint>;
  record?: Record<string, Partial<RecordView>>;
  previewFails?: Set<string>;
  balance?: bigint;
  failReads?: number;
  failAssetAt?: Set<number>;
  calls: Record<string, number>;
}

const k = (a: string) => a.toLowerCase();

function world(borrowers: Address[], extra: Partial<World> = {}): World {
  return { borrowers, calls: {}, ...extra };
}

/** A read client stub that answers the reads the Keeper makes and counts them. */
function fakeClient(w: World) {
  const count = (name: string) => (w.calls[name] = (w.calls[name] ?? 0) + 1);
  const rec = (b: string): RecordView => ({ trigger: 10_400, flags: 1, collateralId: 0, prepaid: WAD, optedInAt: 0n, ...w.record?.[k(b)] });
  return {
    chain: { contracts: { multicall3: { address: MULTICALL3 } } },
    async readContract({ functionName, args }: { functionName: string; args?: unknown[] }) {
      count(functionName);
      switch (functionName) {
        case "activeBorrowers":
          if (w.failReads && w.failReads > 0) {
            w.failReads -= 1;
            throw new Error("rpc unavailable");
          }
          return w.borrowers;
        case "recordSlot":
          return RECORD_SLOT;
        case "record":
          return rec(String(args?.[0]));
        case "assetAt":
          if (w.failAssetAt?.has(Number(args?.[0]))) throw new Error("rpc: 429 too many requests");
          return "0x4444444444444444444444444444444444444444";
        case "assetConfig":
          return { pythFeedId: ("0x" + "ab".repeat(32)) as Hex };
        case "volSlot":
          return VOL_SLOT;
        case "pyth":
          return PYTH;
        case "getUpdateFee":
          return 7n;
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
    async multicall({ contracts }: { contracts: { functionName: string; args: [Address] }[] }) {
      count("multicall");
      return contracts.map((c) => {
        const b = k(c.args[0]);
        if (c.functionName === "previewExit") {
          if (w.previewFails?.has(b)) return { status: "failure", error: new Error("reverted") };
          return { status: "success", result: [w.status?.[b] ?? 3, 1_000n, 2_000n, w.hf?.[b] ?? 1_038_000_000_000_000_000n] };
        }
        if (c.functionName === "getEthBalance") return { status: "success", result: w.balance ?? 10n ** 21n };
        return { status: "success", result: rec(b) };
      });
    },
    async createAccessList() {
      count("createAccessList");
      return { accessList: [], gasUsed: 0n };
    },
    async getBalance() {
      count("getBalance");
      return w.balance ?? 10n ** 21n;
    },
  };
}

interface Sent extends TxRequest {
  gas?: bigint;
}

/** A submitter stub: records each send; `estimate` can throw to simulate a revert. */
function fakeSubmitter(sent: Sent[], opts: { estimate?: (tx: TxRequest) => bigint; send?: (tx: TxRequest) => Promise<void> } = {}) {
  const s = {
    address: KEEPER,
    pending: undefined as unknown,
    measured: 0,
    async resolvePending() {
      return "none" as const;
    },
    async measureGas(tx: TxRequest) {
      s.measured += 1;
      return opts.estimate ? opts.estimate(tx) : 200_000n;
    },
    async send(tx: TxRequest, gas?: bigint) {
      if (gas === undefined) await s.measureGas(tx);
      if (opts.send) await opts.send(tx);
      sent.push({ ...tx, gas });
      return {
        hash: ("0x" + "cd".repeat(32)) as Hex,
        receipt: { status: "success", blockNumber: 11n, transactionHash: ("0x" + "cd".repeat(32)) as Hex },
        gasLimit: gas ?? 1n,
        mode: "sync" as const,
        latencyMs: 1,
        outOfGas: false,
      };
    },
  };
  return s;
}

/** A chain for the real Submitter: estimates come from `estimate(borrowers)`; every send succeeds. */
function chainForSubmitter(estimate: (data: Hex) => bigint, sent: Hex[]) {
  return createPublicClient({
    chain: monad,
    transport: custom({
      async request({ method, params }) {
        switch (method) {
          case "eth_chainId":
            return "0x8f";
          case "eth_estimateGas": {
            const p = (params as { data?: Hex; input?: Hex }[])[0]!;
            return `0x${estimate((p.data ?? p.input)!).toString(16)}`;
          }
          case "eth_getTransactionCount":
            return "0x7";
          case "eth_getBlockByNumber":
            return { baseFeePerGas: "0x174876e800", number: "0x10", timestamp: "0x1", transactions: [] };
          case "eth_maxPriorityFeePerGas":
            return "0x77359400";
          case "eth_sendRawTransactionSync": {
            const raw = (params as Hex[])[0]!;
            sent.push(raw);
            const gas = `0x${parseTransaction(raw).gas!.toString(16)}`;
            return {
              transactionHash: keccak256(raw),
              transactionIndex: "0x0",
              blockHash: "0x" + "ab".repeat(32),
              blockNumber: "0x10",
              from: privateKeyToAccount(KEY).address,
              to: REPRICER,
              cumulativeGasUsed: gas,
              gasUsed: gas,
              effectiveGasPrice: "0x17bfac7c00",
              contractAddress: null,
              logs: [],
              logsBloom: "0x" + "00".repeat(256),
              status: "0x1",
              type: "0x2",
            };
          }
          default:
            throw new Error(`unexpected ${method}`);
        }
      },
    }),
  });
}

function realSubmitter(estimate: (data: Hex) => bigint, sent: Hex[]) {
  return new Submitter(chainForSubmitter(estimate, sent) as never, privateKeyToAccount(KEY), monad, createLogger("error", () => {}), {
    gasBufferBps: 1_500,
    syncTimeoutMs: 2_000,
  });
}

const batchOf = (data: Hex) => (decodeFunctionData({ abi: repricerAbi, data }).args![0] as Address[]).map(k);

function head(n: number): Head {
  return { number: BigInt(n), source: "poll", receivedAt: Date.now() };
}

function keeper(w: World, submitter: unknown, lines: string[] = [], overrides: Partial<KeeperConfig> = {}) {
  const logger = createLogger("debug", (l) => lines.push(l));
  return new Keeper(fakeClient(w) as never, submitter as never, { ...cfg, ...overrides }, logger);
}

const events = (lines: string[]) => lines.map((l) => JSON.parse(l) as { event: string; level: string; [k: string]: unknown });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Keeper", () => {
  it("exits a Ready borrower before repricing the rest, with the right access list", async () => {
    const sent: Sent[] = [];
    const lines: string[] = [];
    const kp = keeper(world([ALICE, BOB], { status: { [k(ALICE)]: 0 } }), fakeSubmitter(sent), lines);
    await kp.onHead(head(100));
    expect(sent.map((t) => t.label)).toEqual(["exit", "repriceMany"]);
    const exit = decodeFunctionData({ abi: executorAbi, data: sent[0]!.data });
    expect(exit.functionName).toBe("exit");
    expect(String(exit.args?.[0]).toLowerCase()).toBe(ALICE.toLowerCase());
    expect(coversPages(sent[0]!.accessList!, REGISTRY, [RECORD_SLOT, RECORD_SLOT + 2n])).toBe(true);
    expect(coversPages(sent[0]!.accessList!, REPRICER, [VOL_SLOT])).toBe(true);
    expect(sent[0]!.value).toBe(0n); // no Hermes update, no Pyth fee
    expect(batchOf(sent[1]!.data)).toEqual([k(BOB)]);
    expect(sent[1]!.headroom).toBe(25_000n);
    const block = events(lines).find((l) => l.event === "block")!;
    expect(block.block).toBe("100");
    expect(block.decision).toBe("exit");
    expect((block.positions as { hf: number }[])[0]!.hf).toBe(1.038);
  });

  it("holds when nothing is due and repricing is off", async () => {
    const sent: Sent[] = [];
    const kp = keeper(world([ALICE]), fakeSubmitter(sent), [], { repriceEveryNBlocks: 0 });
    await kp.onHead(head(5));
    expect(sent).toEqual([]);
  });

  it("logs an RPC failure and recovers on the next block", async () => {
    const sent: Sent[] = [];
    const lines: string[] = [];
    const kp = keeper(world([ALICE], { status: { [k(ALICE)]: 0 }, failReads: 1 }), fakeSubmitter(sent), lines);
    await kp.onHead(head(1));
    expect(sent).toEqual([]);
    expect(events(lines).some((l) => l.event === "block.read_failed")).toBe(true);
    await kp.onHead(head(2));
    expect(sent.map((t) => t.label)).toContain("exit");
  });

  it("sends nothing in dry-run mode", async () => {
    const sent: Sent[] = [];
    const lines: string[] = [];
    const kp = keeper(world([ALICE], { status: { [k(ALICE)]: 0 } }), fakeSubmitter(sent), lines, { dryRun: true });
    await kp.onHead(head(3));
    expect(sent).toEqual([]);
    // The exit only: a borrower being exited is not also repriced in the same block.
    expect(events(lines).filter((l) => l.event === "tx.dry_run")).toHaveLength(1);
  });

  it("collapses heads that arrive during a pass into the newest one", async () => {
    const sent: Sent[] = [];
    const kp = keeper(world([BOB]), fakeSubmitter(sent));
    await Promise.all([kp.onHead(head(10)), kp.onHead(head(11)), kp.onHead(head(12))]);
    expect(sent.length).toBe(2); // block 10, then only the newest queued head (12)
  });

  it("keeps only the last 500 results in memory", async () => {
    const sent: Sent[] = [];
    const kp = keeper(world([BOB]), fakeSubmitter(sent));
    for (let n = 1; n <= 600; n++) await kp.onHead(head(n));
    expect(sent).toHaveLength(600);
    expect(kp.results).toHaveLength(500);
  });
});

describe("Keeper funds (audit H3, H4)", () => {
  it("below MIN_BALANCE_FOR_EXIT_WEI stops repricing, still exits, and logs keeper.low_balance once a minute", async () => {
    const sent: Sent[] = [];
    const lines: string[] = [];
    const w = world([ALICE, BOB], { balance: 150_000_000_000_000_000n }); // 0.15 MON
    const kp = keeper(w, fakeSubmitter(sent), lines);
    for (let n = 1; n <= 4; n++) await kp.onHead(head(n));
    expect(sent).toEqual([]);
    w.status = { [k(ALICE)]: 0 }; // Alice falls under her trigger
    for (let n = 5; n <= 10; n++) await kp.onHead(head(n));
    expect(sent.map((t) => t.label)).toEqual(Array(6).fill("exit"));
    const low = events(lines).filter((l) => l.event === "keeper.low_balance");
    expect(low).toHaveLength(1);
    expect(low[0]!.level).toBe("error");
    // Funded again: repricing resumes.
    w.balance = 10n ** 21n;
    w.status = {};
    await kp.onHead(head(11));
    expect(sent.at(-1)!.label).toBe("repriceMany");
  });

  it("does not pay to reprice covers that cannot be charged: lapsed or with nothing prepaid", async () => {
    const sybils = Array.from({ length: 5 }, (_, i) => `0x${(0xdead00 + i).toString(16).padStart(40, "0")}` as Address);
    const record: Record<string, Partial<RecordView>> = {};
    for (const s of sybils.slice(0, 3)) record[k(s)] = { flags: 3, prepaid: 0n }; // ACTIVE | LAPSED
    for (const s of sybils.slice(3)) record[k(s)] = { flags: 1, prepaid: 0n };
    const status = Object.fromEntries(sybils.slice(0, 3).map((s) => [k(s), 2])); // CoverLapsed
    const sent: Sent[] = [];
    const kp = keeper(world(sybils, { record, status }), fakeSubmitter(sent));
    for (let n = 1; n <= 10; n++) await kp.onHead(head(n));
    expect(sent).toHaveLength(0);
  });
});

describe("Keeper batches (audit M4, M6)", () => {
  it("leaves a borrower whose preview fails out of the batch, so the rest are still repriced", async () => {
    const sent: Hex[] = [];
    const sub = realSubmitter((data) => {
      if (batchOf(data).includes(k(CAROL))) throw Object.assign(new Error("execution reverted"), { code: 3 });
      return 300_000n;
    }, sent);
    const kp = keeper(world([ALICE, BOB, CAROL], { previewFails: new Set([k(CAROL)]) }), sub);
    for (let n = 1; n <= 5; n++) await kp.onHead(head(n));
    expect(sent).toHaveLength(5);
    for (const raw of sent) expect(batchOf(parseTransaction(raw).data!).sort()).toEqual([k(ALICE), k(BOB)].sort());
  });

  it("splits repriceMany into chunks under MAX_GAS_REPRICE, riskiest borrowers first", async () => {
    const borrowers = Array.from({ length: 60 }, (_, i) => `0x${(0x1000 + i).toString(16).padStart(40, "0")}` as Address);
    // HF falls with the index, so the last borrower is the riskiest.
    const hf = Object.fromEntries(borrowers.map((b, i) => [k(b), 2n * WAD - BigInt(i) * 10n ** 16n]));
    const sent: Hex[] = [];
    const sub = realSubmitter((data) => 150_000n + 100_000n * BigInt(batchOf(data).length), sent);
    const lines: string[] = [];
    const kp = keeper(world(borrowers, { hf }), sub, lines);
    await kp.onHead(head(100));
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const batches = sent.map((raw) => parseTransaction(raw));
    for (const tx of batches) expect(tx.gas!).toBeLessThanOrEqual(6_000_000n);
    const all = batches.flatMap((tx) => batchOf(tx.data!));
    expect(new Set(all)).toEqual(new Set(borrowers.map(k)));
    expect(batchOf(batches[0]!.data!)[0]).toBe(k(borrowers[59]!));
    expect(events(lines).some((l) => l.event === "reprice.split")).toBe(true);
    // The next block starts from the chunk size that fits, without a failed estimate first.
    sent.length = 0;
    lines.length = 0;
    await kp.onHead(head(101));
    expect(events(lines).some((l) => l.event === "tx.gas_ceiling")).toBe(false);
    expect(sent.flatMap((raw) => batchOf(parseTransaction(raw).data!))).toHaveLength(60);
  });

  it("isolates a borrower whose reprice reverts and skips it for a while", async () => {
    const borrowers = [ALICE, BOB, CAROL, DAVE, ...Array.from({ length: 4 }, (_, i) => `0x${(0x2000 + i).toString(16).padStart(40, "0")}` as Address)];
    const sent: Hex[] = [];
    let estimates = 0;
    const sub = realSubmitter((data) => {
      estimates += 1;
      if (batchOf(data).includes(k(DAVE))) throw Object.assign(new Error("execution reverted"), { code: 3 });
      return 300_000n;
    }, sent);
    const lines: string[] = [];
    const kp = keeper(world(borrowers), sub, lines);
    await kp.onHead(head(1));
    const first = sent.flatMap((raw) => batchOf(parseTransaction(raw).data!));
    expect(new Set(first)).toEqual(new Set(borrowers.filter((b) => b !== DAVE).map(k)));
    const skipped = events(lines).filter((l) => l.event === "reprice.borrower_skipped");
    expect(skipped.map((l) => String(l.borrower).toLowerCase())).toEqual([k(DAVE)]);
    sent.length = 0;
    estimates = 0;
    await kp.onHead(head(2));
    expect(sent).toHaveLength(1);
    expect(batchOf(parseTransaction(sent[0]!).data!)).not.toContain(k(DAVE));
    expect(estimates).toBe(1);
  });
});

describe("Keeper isolation and pending sends (audit M2, M3)", () => {
  it("one borrower's failed read does not stop the other exits or the reprice", async () => {
    const sent: Sent[] = [];
    const lines: string[] = [];
    const w = world([ALICE, BOB, CAROL], {
      status: { [k(ALICE)]: 0, [k(BOB)]: 0 },
      record: { [k(ALICE)]: { collateralId: 1 } },
      failAssetAt: new Set([1]),
    });
    const kp = keeper(w, fakeSubmitter(sent), lines);
    await expect(kp.onHead(head(1))).resolves.toBeUndefined();
    expect(sent.map((t) => t.label)).toEqual(["exit", "repriceMany"]);
    expect(String(decodeFunctionData({ abi: executorAbi, data: sent[0]!.data }).args?.[0]).toLowerCase()).toBe(k(BOB));
    expect(batchOf(sent[1]!.data)).toEqual([k(CAROL)]);
    expect(events(lines).some((l) => l.event === "exit.failed")).toBe(true);
  });

  it("stops the pass when a send may still be in flight, and waits while it is pending", async () => {
    const sent: Sent[] = [];
    const lines: string[] = [];
    const sub = fakeSubmitter(sent, {
      send: async (tx) => {
        if (tx.label === "exit") throw new TxInFlightError(("0x" + "ee".repeat(32)) as Hex, "exit");
      },
    });
    const kp = keeper(world([ALICE, BOB], { status: { [k(ALICE)]: 0 } }), sub, lines);
    await kp.onHead(head(1));
    expect(sent).toEqual([]); // no reprice signed behind the unresolved exit
    expect(events(lines).some((l) => l.event === "tx.in_flight")).toBe(true);
    sub.pending = { hash: "0xee" };
    sub.resolvePending = async () => "inflight" as never;
    await kp.onHead(head(2));
    expect(events(lines).filter((l) => l.event === "block").at(-1)!.decision).toBe("wait_pending");
    expect(sent).toEqual([]);
  });

  it("stop() waits for the send in progress and takes no new heads", async () => {
    const sent: Sent[] = [];
    let release!: () => void;
    const sub = fakeSubmitter(sent, { send: () => new Promise<void>((r) => (release = r)) });
    const kp = keeper(world([ALICE], { status: { [k(ALICE)]: 0 } }), sub);
    const pass = kp.onHead(head(1));
    await new Promise((r) => setTimeout(r, 5));
    void kp.onHead(head(2)); // queued behind the pass
    let stopped: boolean | undefined;
    const stopping = kp.stop(1_000).then((v) => (stopped = v));
    await new Promise((r) => setTimeout(r, 5));
    expect(stopped).toBeUndefined(); // still waiting for the send
    release();
    await pass;
    await stopping;
    expect(stopped).toBe(true);
    expect(sent).toHaveLength(1); // block 2 was never processed
    await kp.onHead(head(3));
    expect(sent).toHaveLength(1);
  });
});

describe("Keeper warnings and Hermes (audit M5)", () => {
  it("warns once per 200 blocks when a borrower is under the trigger but not Ready, naming the status", async () => {
    const sent: Sent[] = [];
    const lines: string[] = [];
    const w = world([ALICE], { status: { [k(ALICE)]: 11 }, hf: { [k(ALICE)]: 1_030_000_000_000_000_000n } }); // CoverWarmingUp
    const kp = keeper(w, fakeSubmitter(sent), lines, { repriceEveryNBlocks: 0 });
    for (let n = 1; n <= 20; n++) await kp.onHead(head(n));
    let warns = events(lines).filter((l) => l.event === "position.at_trigger_not_ready");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.level).toBe("warn");
    expect(warns[0]!.status).toBe("CoverWarmingUp");
    expect(sent).toEqual([]); // the waiting period is not Ready
    w.status = { [k(ALICE)]: 7 }; // AllowanceTooLow: a new status warns at once
    await kp.onHead(head(21));
    warns = events(lines).filter((l) => l.event === "position.at_trigger_not_ready");
    expect(warns.map((l) => l.status)).toEqual(["CoverWarmingUp", "AllowanceTooLow"]);
  });

  it("tries an exit with a fresh Hermes update when the price is stale, paying Pyth's fee", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ binary: { data: ["abcd"] } }), { status: 200 }));
    const sent: Sent[] = [];
    const lines: string[] = [];
    const w = world([ALICE], { status: { [k(ALICE)]: 8 }, hf: { [k(ALICE)]: 1_030_000_000_000_000_000n } }); // PythStale
    const kp = keeper(w, fakeSubmitter(sent), lines, { hermesApiKey: "key", repriceEveryNBlocks: 0 });
    await kp.onHead(head(1));
    expect(sent.map((t) => t.label)).toEqual(["exit"]);
    expect(sent[0]!.value).toBe(7n);
    const args = decodeFunctionData({ abi: executorAbi, data: sent[0]!.data }).args!;
    expect(args[1]).toEqual(["0xabcd"]);
    expect(events(lines).find((l) => l.event === "position.at_trigger_not_ready")!.status).toBe("PythStale");
  });

  it("does not retry a stale-price exit without a Hermes key", async () => {
    const sent: Sent[] = [];
    const w = world([ALICE], { status: { [k(ALICE)]: 8 }, hf: { [k(ALICE)]: 1_030_000_000_000_000_000n } });
    const kp = keeper(w, fakeSubmitter(sent), [], { repriceEveryNBlocks: 0 });
    for (let n = 1; n <= 5; n++) await kp.onHead(head(n));
    expect(sent).toEqual([]);
  });
});

describe("Keeper round trips (audit H5)", () => {
  it("reuses the record from the multicall, the access list and the measured gas for an unchanged batch", async () => {
    const sent: Sent[] = [];
    const w = world([BOB]);
    const sub = fakeSubmitter(sent);
    const kp = keeper(w, sub);
    for (let n = 1; n <= 5; n++) await kp.onHead(head(n));
    expect(sent).toHaveLength(5);
    expect(w.calls.record ?? 0).toBe(0);
    expect(w.calls.activeCount ?? 0).toBe(0);
    expect(w.calls.activeBorrowers).toBe(5);
    expect(w.calls.multicall).toBe(5);
    expect(w.calls.createAccessList).toBe(1);
    expect(sub.measured).toBe(1);
    expect(new Set(sent.map((t) => t.gas))).toEqual(new Set([200_000n]));
    // Measured again after 20 blocks, and whenever the batch changes.
    for (let n = 6; n <= 22; n++) await kp.onHead(head(n));
    expect(sub.measured).toBe(2);
    w.borrowers = [BOB, CAROL];
    await kp.onHead(head(23));
    expect(sub.measured).toBe(3);
    expect(w.calls.createAccessList).toBe(2);
  });
});
