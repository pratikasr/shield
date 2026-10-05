"use client";

import { Check, Loader2, TriangleAlert } from "lucide-react";
import { HashLink } from "@/components/data/hash-link";
import type { TxState } from "@/hooks/useTx";
import { cn } from "@/lib/utils";

/** Where a transaction is: wallet, sent, included in a proposed block, finalised; or what went wrong. */
export function TxStatus({ state, label, className }: { state: TxState; label: string; className?: string }) {
  if (state.phase === "idle") return null;
  const text =
    state.phase === "signing"
      ? `Confirm ${label} in your wallet`
      : state.phase === "pending"
        ? `Sending ${label} to Monad`
        : state.phase === "proposed"
          ? `${label} included in block ${state.block?.toLocaleString("en-US")}, finalising`
          : state.phase === "finalized"
            ? `${label} finalised in block ${state.block?.toLocaleString("en-US")}`
            : state.error;
  return (
    <div
      role={state.phase === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]",
        state.phase === "error" ? "text-danger" : state.phase === "finalized" ? "text-safe" : "text-muted-foreground",
        className,
      )}
    >
      {state.phase === "error" ? (
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
      ) : state.phase === "finalized" ? (
        <Check className="size-4 shrink-0" aria-hidden />
      ) : (
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
      )}
      <span>{text}</span>
      {state.hash && <HashLink value={state.hash} className="text-foreground" />}
    </div>
  );
}
