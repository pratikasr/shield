"use client";

import { WifiOff } from "lucide-react";
import { useChainFreshness } from "@/hooks/useLiveBlock";

/**
 * Says so when the readings stop moving: Monad makes a block every 300 ms, so two seconds without one means the RPC is
 * not answering and every value on the page is from an older block.
 */
export function StaleBanner() {
  const { block, stale } = useChainFreshness();
  if (!stale || block === undefined) return null;
  return (
    <div role="status" aria-live="polite" className="border-b border-caution/40 bg-caution-soft">
      <p className="mx-auto flex max-w-[76rem] items-center gap-2 px-4 py-2.5 text-sm sm:px-6">
        <WifiOff className="size-4 shrink-0 text-caution" aria-hidden />
        <span>
          Reconnecting, values from block <span className="num">{block.toLocaleString("en-US")}</span>. They update when the Monad RPC answers again.
        </span>
      </p>
    </div>
  );
}
