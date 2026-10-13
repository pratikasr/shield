"use client";

import { useEffect, useRef, useState } from "react";
import { decodeEventLog, encodeEventTopics, type Address, type Hex } from "viem";
import type { BlockMark } from "@/components/cartoon/chain-blocks";
import { usePublicClient } from "wagmi";
import { useLiveBlock, usePageVisible } from "@/hooks/useLiveBlock";
import { applyHead, applyPolledBlock, parseHead, pushWindow, type HeadMessage, type StreamBlock } from "@/lib/analytics";
import { executorAbi, repricerAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { isFork } from "@/lib/env";

/** Monad's public WebSocket; NEXT_PUBLIC_MONAD_WS_URL overrides it. */
export const MONAD_WS_URL = process.env.NEXT_PUBLIC_MONAD_WS_URL || "wss://rpc.monad.xyz";

const REPRICED_TOPIC = encodeEventTopics({ abi: repricerAbi, eventName: "Repriced" })[0] as Hex;
const EXITED_TOPIC = encodeEventTopics({ abi: executorAbi, eventName: "Exited" })[0] as Hex;
/** React sees the stream at most this often; messages arrive about 13 times a second. */
const FLUSH_MS = 120;
const BACKOFF_MAX_MS = 15_000;

export type StreamMode = "socket" | "poll";
export type StreamStatus = "connecting" | "live" | "reconnecting" | "paused" | "unavailable" | "unsupported";

export interface StreamState {
  mode: StreamMode;
  status: StreamStatus;
  /** When the next reconnect attempt runs (browser ms), while reconnecting. */
  retryAt?: number;
  blocks: StreamBlock[];
  /** Shield reprices seen per block number since the page opened. */
  repricesByBlock: Record<number, number>;
  repricesSeen: number;
  /** Rescues (Executor Exited events) seen since the page opened. */
  exitsSeen: number;
  /** Blocks that carry a real Shield transaction, for the ticker's stamps, with the first such transaction. */
  marks: Record<number, BlockMark>;
  /** Sum of `charged` over the reprices seen, 18-decimal USDC units. */
  chargedSeen: bigint;
  /** False when the RPC refused the log subscription, so reprices cannot be marked. */
  logsAvailable: boolean;
  /** (block number, browser ms) of recent proposals, or polled blocks on a fork, for the block-time average. */
  proposals: { n: number; t: number }[];
  /** Recent Proposed-to-Finalized times, ms. */
  finalizeMs: number[];
}

function initial(mode: StreamMode): StreamState {
  return {
    mode,
    status: mode === "socket" ? "connecting" : "live",
    blocks: [],
    repricesByBlock: {},
    repricesSeen: 0,
    exitsSeen: 0,
    marks: {},
    chargedSeen: 0n,
    logsAvailable: true,
    proposals: [],
    finalizeMs: [],
  };
}

/** Folds a head into the state: the block list, and the timing windows when it is a new proposal or a finalization. */
function withHead(s: StreamState, head: HeadMessage, at: number): StreamState {
  const blocks = applyHead(s.blocks, head, at);
  if (blocks === s.blocks) return { ...s, status: "live", retryAt: undefined };
  let { proposals, finalizeMs } = s;
  if (head.commitState === "Proposed" && !proposals.some((p) => p.n === head.number)) proposals = pushWindow(proposals, { n: head.number, t: at });
  if (head.commitState === "Finalized") {
    const b = blocks.find((x) => x.number === head.number);
    if (b?.at.Proposed !== undefined && b.at.Finalized !== undefined) finalizeMs = pushWindow(finalizeMs, b.at.Finalized - b.at.Proposed);
  }
  return { ...s, status: "live", retryAt: undefined, blocks, proposals, finalizeMs };
}

interface RawLog {
  blockNumber?: string | bigint | null;
  transactionHash?: string | null;
  logIndex?: string | number | null;
  data?: Hex;
  topics?: Hex[];
  removed?: boolean;
}

/** A block's stamp after one more Shield event: a rescue outranks reprices, and the first transaction is kept. */
function withMark(marks: Record<number, BlockMark>, block: number, kind: BlockMark["kind"], txHash: string): Record<number, BlockMark> {
  const m = marks[block];
  return {
    ...marks,
    [block]: { count: (m?.count ?? 0) + 1, txHash: kind === "exited" || !m?.txHash ? txHash : m.txHash, kind: m?.kind === "exited" ? "exited" : kind },
  };
}

/** Adds one Shield log (Repriced from the Repricer, Exited from the Executor) to the state, once per transaction and log index. */
function addLog(s: StreamState, seen: Set<string>, log: RawLog): StreamState {
  if (log.removed || !log.transactionHash || log.logIndex === undefined || log.logIndex === null || !log.data || !log.topics?.length) return s;
  const key = `${log.transactionHash.toLowerCase()}:${String(log.logIndex)}`;
  if (seen.has(key)) return s;
  const block = typeof log.blockNumber === "bigint" ? Number(log.blockNumber) : Number.parseInt(String(log.blockNumber ?? "0"), 16);
  if (log.topics[0] === EXITED_TOPIC) {
    seen.add(key);
    return { ...s, exitsSeen: s.exitsSeen + 1, marks: withMark(s.marks, block, "exited", log.transactionHash) };
  }
  if (log.topics[0] !== REPRICED_TOPIC) return s;
  let charged = 0n;
  try {
    const decoded = decodeEventLog({ abi: repricerAbi, eventName: "Repriced", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    charged = (decoded.args as { charged: bigint }).charged;
  } catch {
    return s;
  }
  seen.add(key);
  return {
    ...s,
    repricesByBlock: { ...s.repricesByBlock, [block]: (s.repricesByBlock[block] ?? 0) + 1 },
    repricesSeen: s.repricesSeen + 1,
    chargedSeen: s.chargedSeen + charged,
    marks: withMark(s.marks, block, "repriced", log.transactionHash),
  };
}

/**
 * Monad's block stream in the browser. On Monad: one WebSocket subscribed to `monadNewHeads` (each block as Proposed,
 * Voted, Finalized, Verified) and to `monadLogs` for the Repricer's Repriced events, which arrive with the proposed
 * block. Closed while the tab is hidden and on unmount; reconnects with backoff. On a local fork, which has no
 * `monadNewHeads`, it polls the block number and the Repricer's logs instead. Nothing here can throw into React.
 */
export function useBlockStream(repricer?: Address, executor?: Address): StreamState {
  const mode: StreamMode = isFork ? "poll" : "socket";
  const watched = [repricer, executor].filter((a): a is Address => Boolean(a));
  const watchKey = watched.join(",");
  const [state, setState] = useState<StreamState>(() => initial(mode));
  const visible = usePageVisible();
  const store = useRef<StreamState>(initial(mode));
  const seen = useRef(new Set<string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flushSoon = () => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = undefined;
      setState(store.current);
    }, FLUSH_MS);
  };
  const update = (fn: (s: StreamState) => StreamState) => {
    store.current = fn(store.current);
    flushSoon();
  };

  // ---------------------------------------------------------------- Monad: WebSocket
  useEffect(() => {
    if (mode !== "socket") return;
    if (typeof WebSocket === "undefined") {
      store.current = { ...store.current, status: "unavailable" };
      flushSoon();
      return;
    }
    if (!visible) {
      store.current = { ...store.current, status: "paused", retryAt: undefined };
      flushSoon();
      return;
    }
    let ws: WebSocket | undefined;
    let closedByUs = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let headsSub: string | undefined;
    let logsSub: string | undefined;

    const connect = () => {
      // A fresh list on every connection: blocks from before a pause would sit at a stale commit state.
      store.current = { ...store.current, status: attempt ? "reconnecting" : "connecting", blocks: [] };
      flushSoon();
      try {
        ws = new WebSocket(MONAD_WS_URL);
      } catch {
        scheduleRetry();
        return;
      }
      ws.onopen = () => {
        try {
          ws!.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }));
          if (watched.length) {
            ws!.send(
              JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_subscribe", params: ["monadLogs", { address: watched, topics: [[REPRICED_TOPIC, EXITED_TOPIC]] }] }),
            );
          }
        } catch {
          // onclose follows and reconnects.
        }
      };
      ws.onmessage = (event) => {
        let m: { id?: number; result?: unknown; error?: unknown; params?: { subscription?: string; result?: unknown } };
        try {
          m = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (m.id === 1) {
          if (typeof m.result === "string") headsSub = m.result;
          else {
            // This RPC has no monadNewHeads: retrying would not help.
            closedByUs = true;
            update((s) => ({ ...s, status: "unsupported", retryAt: undefined }));
            try {
              ws?.close();
            } catch {
              // Already closed.
            }
          }
          return;
        }
        if (m.id === 2) {
          if (typeof m.result === "string") logsSub = m.result;
          else update((s) => ({ ...s, logsAvailable: false }));
          return;
        }
        const sub = m.params?.subscription;
        if (sub && sub === logsSub) {
          update((s) => addLog(s, seen.current, m.params!.result as RawLog));
          return;
        }
        if (sub && sub === headsSub) {
          const head = parseHead(m.params!.result);
          if (!head) return;
          attempt = 0;
          const at = typeof performance !== "undefined" ? performance.timeOrigin + performance.now() : Date.now();
          update((s) => withHead(s, head, at));
        }
      };
      ws.onerror = () => {
        // The close event follows; reconnecting happens there.
      };
      ws.onclose = () => {
        headsSub = undefined;
        logsSub = undefined;
        if (!closedByUs) scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      const delay = Math.min(BACKOFF_MAX_MS, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
      attempt += 1;
      store.current = { ...store.current, status: "reconnecting", retryAt: Date.now() + delay };
      flushSoon();
      retry = setTimeout(connect, delay);
    };

    connect();
    return () => {
      closedByUs = true;
      clearTimeout(retry);
      try {
        ws?.close();
      } catch {
        // Already closed.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the socket depends only on visibility and the watched addresses
  }, [mode, visible, watchKey]);

  // ---------------------------------------------------------------- Local fork: polling
  const { data: block } = useLiveBlock();
  const client = usePublicClient({ chainId: monadMainnet.id });
  const lastLogBlock = useRef<bigint | undefined>(undefined);
  const logsInFlight = useRef(false);
  useEffect(() => {
    if (mode !== "poll" || block === undefined) return;
    const n = Number(block);
    const at = Date.now();
    update((s) =>
      s.blocks.some((b) => b.number === n)
        ? s
        : { ...s, status: "live", blocks: applyPolledBlock(s.blocks, n, at), proposals: pushWindow(s.proposals, { n, t: at }) },
    );
    if (!watched.length || !client || logsInFlight.current) return;
    // Count reprices from the block the page opened at onward.
    const from = lastLogBlock.current === undefined ? block : lastLogBlock.current + 1n;
    if (from > block) return;
    logsInFlight.current = true;
    client
      .getLogs({ address: watched, fromBlock: from, toBlock: block })
      .then((logs) => {
        lastLogBlock.current = block;
        update((s) => logs.reduce((acc, l) => addLog(acc, seen.current, l as RawLog), s));
      })
      .catch(() => {
        // The next block retries the same range.
      })
      .finally(() => {
        logsInFlight.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per polled block
  }, [mode, block, watchKey, client]);

  useEffect(() => () => clearTimeout(flushTimer.current), []);

  return state;
}
