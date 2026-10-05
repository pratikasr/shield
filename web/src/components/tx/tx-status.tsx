"use client";

import { Check, Loader2, TriangleAlert } from "lucide-react";
import { HashLink } from "@/components/data/hash-link";
import type { TxState } from "@/hooks/useTx";
import { cn } from "@/lib/utils";

/** "Approval" mid-sentence is "approval"; "USDC approval" keeps its acronym. */
function midSentence(label: string): string {
  const first = label.split(/[\s-]/)[0] ?? "";
  if (first.length > 1 && first === first.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Where a transaction is: checked, wallet, sent, included in a proposed block, finalised; or what went wrong. */
export function TxStatus({ state, className }: { state: TxState; className?: string }) {
  if (state.phase === "idle") return null;
  const label = state.label;
  const mid = midSentence(label);
  const text =
    state.phase === "checking"
      ? `Checking ${mid} against the chain`
      : state.phase === "signing"
        ? `Confirm ${mid} in your wallet`
        : state.phase === "pending"
          ? `Sending ${mid} to Monad`
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
      <span className="min-w-0">{text}</span>
      {state.hash && <HashLink value={state.hash} className="text-foreground" />}
    </div>
  );
}

/** The newest of several transactions, so one status line can serve a panel with more than one sender. */
export function latestTx(...states: TxState[]): TxState {
  return states.reduce((a, b) => (b.phase !== "idle" && b.seq > a.seq ? b : a), { phase: "idle", label: "", seq: 0 } as TxState);
}
