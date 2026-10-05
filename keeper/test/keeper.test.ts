import { decodeFunctionData, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { executorAbi } from "../src/abi/Executor.js";
import { repricerAbi } from "../src/abi/Repricer.js";
import { coversPages } from "../src/accessList.js";
import type { KeeperConfig } from "../src/config.js";
import type { Head } from "../src/heads.js";
import { Keeper } from "../src/keeper.js";
import { createLogger } from "../src/log.js";
import type { TxRequest } from "../src/submit.js";

const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const REPRICER = "0x2222222222222222222222222222222222222222" as Address;
const EXECUTOR = "0x3333333333333333333333333333333333333333" as Address;
const ALICE = "0x000000000000000000000000000000000000A11c" as Address;
const BOB = "0x000000000000000000000000000000000000B0B0" as Address;
const RECORD_SLOT = 128n * 4242n;
const VOL_SLOT = 128n * 99n;

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
  gasBufferBps: 1_500,
  maxGasExit: 3_000_000n,
  maxGasReprice: 6_000_000n,
  repriceGasHeadroom: 25_000n,
  pollIntervalMs: 150,
  syncTimeoutMs: 2_000,
  dryRun: false,
  logLevel: "error",
};

interface World {
  statuses: Record<Address, number>;
  failReads?: number;
}

/** A client stub that answers the reads the Keeper makes. */
function fakeClient(world: World) {
  return {
    async readContract({ functionName }: { functionName: string; args?: unknown[] }) {
      if (world.failReads && world.failReads > 0) {
        world.failReads -= 1;
        throw new Error("rpc unavailable");
      }
      switch (functionName) {
        case "activeCount":
          return BigInt(Object.keys(world.statuses).length);
        case "activeBorrowers":
          return Object.keys(world.statuses);
        case "recordSlot":
          return RECORD_SLOT;
        case "record":
          return { trigger: 10_400, flags: 1, collateralId: 0 };
        case "assetAt":
          return "0x4444444444444444444444444444444444444444";
        case "assetConfig":
          return { pythFeedId: ("0x" + "ab".repeat(32)) as Hex };
        case "volSlot":
          return VOL_SLOT;
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
    async multicall({ contracts }: { contracts: { functionName: string; args: [Address] }[] }) {
      return contracts.map((c) => {
        if (c.functionName === "previewExit") {
          const status = world.statuses[c.args[0]] ?? 1;
          return { status: "success", result: [status, 1_000n, 2_000n, 1_038_000_000_000_000_000n] };
        }
        return { status: "success", result: { trigger: 10_400, flags: 1 } };
      });
    },
    async createAccessList() {
      return { accessList: [], gasUsed: 0n };
    },
  };
}

function fakeSubmitter(sent: TxRequest[]) {
  return {
    address: "0x9999999999999999999999999999999999999999" as Address,
    async send(tx: TxRequest) {
      sent.push(tx);
      return {
        hash: ("0x" + "cd".repeat(32)) as Hex,
        receipt: { status: "success", blockNumber: 11n, transactionHash: ("0x" + "cd".repeat(32)) as Hex },
        gasLimit: 1n,
        mode: "sync" as const,
        latencyMs: 1,
      };
    },
  };
}

function head(n: number): Head {
  return { number: BigInt(n), source: "poll", receivedAt: Date.now() };
}

function keeper(world: World, sent: TxRequest[], lines: string[], overrides: Partial<KeeperConfig> = {}) {
  const logger = createLogger("debug", (l) => lines.push(l));
  return new Keeper(fakeClient(world) as never, fakeSubmitter(sent) as never, { ...cfg, ...overrides }, logger);
}

describe("Keeper", () => {
  it("exits a Ready borrower before repricing the rest, with the right access list", async () => {
    const sent: TxRequest[] = [];
    const lines: string[] = [];
    const k = keeper({ statuses: { [ALICE]: 0, [BOB]: 3 } }, sent, lines);
    await k.onHead(head(100));
    expect(sent.map((t) => t.label)).toEqual(["exit", "repriceMany"]);
    const exit = decodeFunctionData({ abi: executorAbi, data: sent[0]!.data });
    expect(exit.functionName).toBe("exit");
    expect(String(exit.args?.[0]).toLowerCase()).toBe(ALICE.toLowerCase());
    expect(coversPages(sent[0]!.accessList!, REGISTRY, [RECORD_SLOT, RECORD_SLOT + 2n])).toBe(true);
    expect(coversPages(sent[0]!.accessList!, REPRICER, [VOL_SLOT])).toBe(true);
    const reprice = decodeFunctionData({ abi: repricerAbi, data: sent[1]!.data });
    expect((reprice.args?.[0] as string[]).map((a) => a.toLowerCase())).toEqual([BOB.toLowerCase()]);
    expect(sent[1]!.headroom).toBe(25_000n);
    const block = lines.map((l) => JSON.parse(l)).find((l) => l.event === "block");
    expect(block.block).toBe("100");
    expect(block.decision).toBe("exit");
    expect(block.positions[0].hf).toBe(1.038);
  });

  it("holds when nothing is due and repricing is off", async () => {
    const sent: TxRequest[] = [];
    const k = keeper({ statuses: { [ALICE]: 3 } }, sent, [], { repriceEveryNBlocks: 0 });
    await k.onHead(head(5));
    expect(sent).toEqual([]);
  });

  it("logs an RPC failure and recovers on the next block", async () => {
    const sent: TxRequest[] = [];
    const lines: string[] = [];
    const world: World = { statuses: { [ALICE]: 0 }, failReads: 1 };
    const k = keeper(world, sent, lines);
    await k.onHead(head(1));
    expect(sent).toEqual([]);
    expect(lines.some((l) => JSON.parse(l).event === "block.read_failed")).toBe(true);
    await k.onHead(head(2));
    expect(sent.map((t) => t.label)).toContain("exit");
  });

  it("sends nothing in dry-run mode", async () => {
    const sent: TxRequest[] = [];
    const lines: string[] = [];
    const k = keeper({ statuses: { [ALICE]: 0 } }, sent, lines, { dryRun: true });
    await k.onHead(head(3));
    expect(sent).toEqual([]);
    // The exit only: a borrower being exited is not also repriced in the same block.
    expect(lines.filter((l) => JSON.parse(l).event === "tx.dry_run")).toHaveLength(1);
  });

  it("collapses heads that arrive during a pass into the newest one", async () => {
    const sent: TxRequest[] = [];
    const k = keeper({ statuses: { [BOB]: 3 } }, sent, []);
    await Promise.all([k.onHead(head(10)), k.onHead(head(11)), k.onHead(head(12))]);
    expect(sent.length).toBe(2); // block 10, then only the newest queued head (12)
  });
});
