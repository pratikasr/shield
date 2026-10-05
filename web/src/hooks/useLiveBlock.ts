"use client";

import { useEffect, useRef } from "react";
import { useBlockNumber } from "wagmi";
import { monadMainnet } from "@/lib/chains";

/** The latest (proposed) block number, refreshed as blocks arrive; Monad produces one about every 300 ms. */
export function useLiveBlock() {
  return useBlockNumber({ chainId: monadMainnet.id, watch: { pollingInterval: 300 }, query: { refetchInterval: false } });
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
