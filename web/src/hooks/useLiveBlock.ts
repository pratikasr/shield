"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBlockNumber } from "wagmi";
import { appChain } from "@/lib/chains";

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** False while the tab is hidden, so the app stops polling the public RPC nobody is looking at. */
export function usePageVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => true,
  );
}

/**
 * The latest (proposed) block number, refreshed as blocks arrive; Monad produces one about every 300 ms. Every caller
 * shares one poller (viem dedupes watchers with the same parameters).
 */
export function useLiveBlock() {
  const visible = usePageVisible();
  return useBlockNumber({ chainId: appChain.id, watch: { enabled: visible, pollingInterval: 300 }, query: { refetchInterval: false } });
}

/** Runs `onBlock` once per new block. */
export function useOnBlock(onBlock: (block: bigint) => void) {
  const { data: block } = useLiveBlock();
  const cb = useRef(onBlock);
  cb.current = onBlock;
  useEffect(() => {
    if (block !== undefined) cb.current(block);
  }, [block]);
}

/** Wall-clock milliseconds, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Monad makes a block about every 300 ms: no new block for this long means the RPC stopped answering. */
export const STALE_AFTER_MS = 2_000;

/**
 * Whether the page's readings are live: the latest block and how long ago it arrived. `stale` turns the network chip
 * amber and shows "Reconnecting, values from block N" instead of a pulsing dot on a frozen block.
 */
export function useChainFreshness() {
  const q = useLiveBlock();
  const visible = usePageVisible();
  const now = useNow(500);
  const ageMs = q.data === undefined ? Number.POSITIVE_INFINITY : now - q.dataUpdatedAt;
  return { block: q.data, ageMs, stale: visible && q.data !== undefined && ageMs > STALE_AFTER_MS, failed: q.data === undefined && q.isError };
}
