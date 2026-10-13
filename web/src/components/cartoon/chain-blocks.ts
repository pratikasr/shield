import { useSyncExternalStore } from "react";

/**
 * A light, shared view of Monad's newest blocks for pages that do not load the wallet stack (the landing page) and
 * for the block ticker everywhere. One poller for every subscriber: `eth_blockNumber` every 300 ms while the tab is
 * visible, and every 1.2 s `eth_getLogs` for Shield's own on-chain transactions (Repricer `Repriced`, Executor
 * `Exited`), so a block is marked only when it really carries one. Plain fetch, no viem or wagmi.
 */

const RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL || (process.env.NEXT_PUBLIC_CHAIN_ID === "10143" ? "https://testnet-rpc.monad.xyz" : "https://rpc.monad.xyz");
/** True when the build reads a local fork (test rehearsals only). */
export const isLocalRpc = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(RPC_URL);
const REPRICER = (process.env.NEXT_PUBLIC_SHIELD_REPRICER ?? "").trim();
const EXECUTOR = (process.env.NEXT_PUBLIC_SHIELD_EXECUTOR ?? "").trim();
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const WATCHED = [REPRICER, EXECUTOR].filter(isAddr);

/** keccak256("Repriced(address,uint256,uint256,uint256,uint256,uint256,bool)"); checked against the ABI in chain-blocks.test.ts. */
export const REPRICED_TOPIC = "0xb245d12bc149ce655b7466c319f2f908004162a84c46e5f956b66c33ebe7887d";
/** keccak256("Exited(address,address,uint256,uint256,uint256,uint256,uint256,uint256)"). */
export const EXITED_TOPIC = "0x60d07dbee244732f25c764b0682faec5d991001c2be707658ecaf4d12db76c23";

const POLL_MS = 300;
const LOGS_EVERY = 4;
const KEEP = 16;
const STALE_MS = 2_000;

export interface BlockMark {
  /** Shield transactions' events in the block. */
  count: number;
  /** The first Shield transaction in the block, for the explorer link. */
  txHash?: string;
  /** "exited" when the block holds a rescue. */
  kind: "repriced" | "exited";
}

export interface ChainBlocks {
  /** Newest first. */
  blocks: number[];
  latest?: number;
  /** Browser ms when the latest block number arrived. */
  seenAt?: number;
  /** No answer from the RPC yet after several tries. */
  failed: boolean;
  /** Shield transactions by block number. */
  marks: Record<number, BlockMark>;
  /** False when the build has no Shield addresses or the RPC refused the log query. */
  marksAvailable: boolean;
}

let state: ChainBlocks = { blocks: [], failed: false, marks: {}, marksAvailable: WATCHED.length > 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let ticks = 0;
let misses = 0;
let lastLogBlock: number | undefined;
let inFlight = false;
let logsInFlight = false;

function set(next: Partial<ChainBlocks>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const json = (await res.json()) as { result?: T; error?: unknown };
  if (json.error !== undefined || json.result === undefined) throw new Error(method);
  return json.result;
}

const hex = (n: number) => `0x${n.toString(16)}`;

async function pollLogs(latest: number) {
  if (!WATCHED.length || logsInFlight) return;
  const from = lastLogBlock === undefined ? Math.max(0, latest - KEEP) : lastLogBlock + 1;
  if (from > latest) return;
  logsInFlight = true;
  try {
    const logs = await rpc<{ blockNumber: string; transactionHash: string; topics: string[]; removed?: boolean }[]>("eth_getLogs", [
      { fromBlock: hex(from), toBlock: hex(latest), address: WATCHED, topics: [[REPRICED_TOPIC, EXITED_TOPIC]] },
    ]);
    lastLogBlock = latest;
    if (!logs.length) return;
    const marks = { ...state.marks };
    for (const l of logs) {
      if (l.removed) continue;
      const n = Number.parseInt(l.blockNumber, 16);
      const exited = l.topics[0]?.toLowerCase() === EXITED_TOPIC;
      const prev = marks[n];
      marks[n] = {
        count: (prev?.count ?? 0) + 1,
        txHash: exited ? l.transactionHash : (prev?.txHash ?? l.transactionHash),
        kind: exited || prev?.kind === "exited" ? "exited" : "repriced",
      };
    }
    const keepFrom = (state.latest ?? latest) - 64;
    for (const k of Object.keys(marks)) if (Number(k) < keepFrom) delete marks[Number(k)];
    set({ marks, marksAvailable: true });
  } catch {
    set({ marksAvailable: false });
  } finally {
    logsInFlight = false;
  }
}

async function poll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const n = Number.parseInt(await rpc<string>("eth_blockNumber", []), 16);
    misses = 0;
    if (state.latest === undefined || n > state.latest) {
      const from = state.latest === undefined ? n - KEEP + 1 : Math.max(state.latest + 1, n - KEEP + 1);
      const fresh: number[] = [];
      for (let b = n; b >= from; b--) fresh.push(b);
      set({ latest: n, seenAt: Date.now(), failed: false, blocks: [...fresh, ...state.blocks].slice(0, KEEP) });
    }
    if (ticks++ % LOGS_EVERY === 0) void pollLogs(n);
  } catch {
    misses += 1;
    if (misses >= 3 && state.latest === undefined) set({ failed: true });
  } finally {
    inFlight = false;
  }
}

function loop() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    timer = setTimeout(loop, 1000);
    return;
  }
  void poll();
  // Back off while the RPC is unreachable, so a dead endpoint is not hammered.
  timer = setTimeout(loop, misses >= 3 ? Math.min(10_000, POLL_MS * 2 ** Math.min(misses - 2, 5)) : POLL_MS);
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (listeners.size === 1 && timer === undefined) loop();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

const serverSnapshot: ChainBlocks = { blocks: [], failed: false, marks: {}, marksAvailable: WATCHED.length > 0 };

/** The shared block view; re-renders on every new block. */
export function useChainBlocks(enabled = true): ChainBlocks {
  return useSyncExternalStore(
    enabled ? subscribe : () => () => {},
    () => (enabled ? state : serverSnapshot),
    () => serverSnapshot,
  );
}

/** True when no new block has arrived for two seconds (Monad makes one about every 0.3 s). */
export function isStale(b: ChainBlocks, now = Date.now()): boolean {
  return b.seenAt !== undefined && now - b.seenAt > STALE_MS;
}
