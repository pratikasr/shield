"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { ChoiceCards } from "@/components/cartoon/choice-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { parseStoredTransfer, transferKey, type FundingKind } from "@/lib/aurora";
import { shield } from "@/lib/env";

/** Sized like the panel's first block, so the switch does not jump while the chunk loads. */
function CrossChainSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading cross-chain top-up">
      <Skeleton className="h-36 w-full rounded-2xl bg-sky-2" />
      <Skeleton className="h-11 w-full rounded-xl bg-sky-2" />
      <Skeleton className="h-14 w-full rounded-[14px] bg-sky-2" />
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
  return (
    <div className="space-y-4">
      <ChoiceCards
        variant="pills"
        label="Pay from"
        value={source}
        onChange={setSource}
        options={[
          { value: "monad", name: monadLabel },
          { value: "other", name: "From another chain" },
        ]}
      />
      {source === "monad" ? <div className="space-y-3">{children}</div> : <CrossChainFunding {...props} />}
    </div>
  );
}
