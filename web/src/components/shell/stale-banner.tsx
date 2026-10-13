"use client";

import { useChainFreshness } from "@/hooks/useLiveBlock";

/**
 * Says so when the readings stop moving: Monad makes a block about every 0.3 s, so two seconds without one means the
 * RPC is not answering and every value on the page is from an older block.
 */
export function StaleBanner() {
  const { block, stale } = useChainFreshness();
  if (!stale || block === undefined) return null;
  return (
    <div role="status" aria-live="polite" className="border-b-[2.5px] border-ink bg-heads">
      <p className="c-wrap m-0 flex items-center gap-2.5 py-2.5 font-semibold">
        <span className="c-heart shrink-0" data-tone="off" aria-hidden />
        <span>
          Reconnecting to Monad. Numbers are from block {block.toLocaleString("en-US")} and update when the RPC answers again.
        </span>
      </p>
    </div>
  );
}
