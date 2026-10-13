"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { Skeleton } from "@/components/ui/skeleton";
import { parseStoredTransfer, transferKey, type FundingKind } from "@/lib/aurora";
import { shield } from "@/lib/env";
import { cn } from "@/lib/utils";

/** Sized like the panel's first block, so the switch does not jump while the chunk loads. */
function CrossChainSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading cross-chain top-up">
      <Skeleton className="h-36 w-full rounded-lg" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

/** The Aurora Intents flow loads only when someone chooses "From another chain"; no page pays for it up front. */
export const CrossChainFunding = dynamic(() => import("@/components/aurora/cross-chain-funding"), { ssr: false, loading: () => <CrossChainSkeleton /> });

export interface CrossChainProps {
  kind: FundingKind;
  /** The borrower whose premium it funds; for the vault, the account sending (refunds go there). */
  owner: Address;
  /** Where Aurora refunds on the source chain: the connected wallet's address, valid on every EVM chain. */
  refundTo: Address;
  /** The wallet is on another network: the sweep asks to switch, the rest still works. */
  wrongNetwork: boolean;
  onSwept?: () => void;
}

/** True when this browser is following a cross-chain transfer for this account, so the switch opens on it. */
export function hasStoredTransfer(kind: FundingKind, owner: Address): boolean {
  try {
    return Boolean(parseStoredTransfer(window.localStorage.getItem(transferKey(kind, owner)), undefined, Date.now()));
  } catch {
    return false;
  }
}

/**
 * "USDC on Monad" or "From another chain" above a funding form. The Monad form is the children; the other side is
 * the lazy cross-chain panel. A build without the forwarder contract shows the Monad form alone.
 */
export function FundingSource({ children, monadLabel = "USDC on Monad", ...props }: CrossChainProps & { children: ReactNode; monadLabel?: string }) {
  const [source, setSource] = useState<"monad" | "other">("monad");
  // After mount, so the server and first client render agree.
  useEffect(() => {
    if (hasStoredTransfer(props.kind, props.owner)) setSource("other");
  }, [props.kind, props.owner]);
  if (!shield.forwarders) return <div className="space-y-3">{children}</div>;
  const option = (value: "monad" | "other", label: string) => (
    <button
      type="button"
      onClick={() => setSource(value)}
      aria-pressed={source === value}
      className={cn(
        "hit relative h-9 rounded-md border text-[0.8125rem] font-medium",
        source === value ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Pay from">
        {option("monad", monadLabel)}
        {option("other", "From another chain")}
      </div>
      {source === "monad" ? <div className="space-y-3">{children}</div> : <CrossChainFunding {...props} />}
    </div>
  );
}
