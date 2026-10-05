"use client";

import { Check, Clock3, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useOnBlock } from "@/hooks/useLiveBlock";
import { useTx } from "@/hooks/useTx";
import { executorAbi, repricerAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import type { Check as CoverCheck } from "@/lib/cover-status";
import { shield } from "@/lib/env";
import { toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const chainId = monadMainnet.id;
export const AAVE_APP = "https://app.aave.com/?marketName=proto_monad_v3";
/** Blocks an exit may stay due before the page offers to run it from this wallet. */
export const KEEPER_IDLE_BLOCKS = 10;

/** The live premium for a trigger that is not on chain yet (setup, or a new trigger in the manage panel). */
export function useQuote(user: Address, collateral: Address, trigger: number, enabled = true) {
  const on = enabled && Boolean(shield.repricer);
  const q = useReadContract({
    address: shield.repricer,
    abi: repricerAbi,
    functionName: "quoteFor",
    args: [user, collateral, Math.round(trigger * 1e4)],
    chainId,
    query: { enabled: on },
  });
  useOnBlock(() => {
    if (on) void q.refetch({ cancelRefetch: false });
  });
  const d = q.data as readonly [bigint, bigint, bigint, bigint] | undefined;
  return d ? { perBlockUsd: toNumber(d[0], 18), sigma: toNumber(d[2], 18), annualUsd: toNumber(d[3], 18) } : undefined;
}

export function SectionLabel({ htmlFor, children, aside }: { htmlFor?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {children}
        </Label>
      ) : (
        <p className="text-sm font-medium">{children}</p>
      )}
      {aside}
    </div>
  );
}

export function Steps({ step, items }: { step: number; items: { title: string; detail: string }[] }) {
  return (
    <ol className="grid gap-0" aria-label="Steps">
      {items.map((it, i) => {
        const n = i + 1;
        const state = step > n ? "done" : step === n ? "current" : "todo";
        return (
          <li key={it.title} className="relative grid grid-cols-[1.5rem_1fr] gap-x-3 pb-3 last:pb-0" aria-current={state === "current" ? "step" : undefined}>
            {i < items.length - 1 && <span className={cn("absolute left-[0.6875rem] top-6 h-[calc(100%-1.25rem)] w-px", state === "done" ? "bg-safe" : "bg-border")} aria-hidden />}
            <span
              className={cn(
                "relative mt-0.5 inline-flex size-6 items-center justify-center rounded-full border text-[0.6875rem] font-semibold num",
                state === "done" && "border-safe bg-safe text-white dark:text-background",
                state === "current" && "border-foreground bg-foreground text-background",
                state === "todo" && "bg-card text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3.5" aria-label="Done" /> : n}
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm font-medium", state === "todo" && "text-muted-foreground")}>{it.title}</p>
              <p className="text-[0.8125rem] text-muted-foreground">{it.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Every condition an exit needs, each with a tick, a cross, or a clock for the waiting period. */
export function ProtectionCheck({ checks }: { checks: CoverCheck[] }) {
  if (!checks.length) return null;
  return (
    <div>
      <h3 className="text-sm font-medium">Protection check</h3>
      <ul className="mt-2.5 grid gap-2 text-[0.8125rem]">
        {checks.map((c) => {
          const waiting = !c.ok && c.id === "warm";
          return (
            <li key={c.id} className="grid grid-cols-[1rem_1fr] items-start gap-2">
              {c.ok ? (
                <Check className="mt-0.5 size-4 text-safe" aria-hidden />
              ) : waiting ? (
                <Clock3 className="mt-0.5 size-4 text-caution" aria-hidden />
              ) : (
                <X className="mt-0.5 size-4 text-danger" aria-hidden />
              )}
              <span className="min-w-0">
                <span className={c.ok ? "text-foreground" : waiting ? "text-caution" : "text-danger"}>{c.label}</span>
                <span className="sr-only">{c.ok ? ": passes" : waiting ? ": not yet" : ": fails"}</span>
                {!c.ok && c.detail && <span className="block text-muted-foreground">{c.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * After a transaction succeeds, its button stays disabled until the refetched chain state moves on, so a second click
 * cannot send the same step again. `key` names the step and amount; a new key (the step advanced, or the amount changed)
 * releases it, and so does a timeout in case the RPC never shows the change.
 */
export function useSentLock(timeoutMs = 20_000) {
  const [held, setHeld] = useState<string>();
  useEffect(() => {
    if (held === undefined) return;
    const t = setTimeout(() => setHeld(undefined), timeoutMs);
    return () => clearTimeout(t);
  }, [held, timeoutMs]);
  const isHeld = useCallback((key: string) => held === key, [held]);
  return { hold: setHeld, isHeld };
}

/** Executor.exit is permissionless: when the keeper is late, any wallet may run it. */
export function RunExitButton({ borrower, disabled, onDone, className }: { borrower: Address; disabled?: boolean; onDone: () => void; className?: string }) {
  const tx = useTx();
  return (
    <div className={cn("grid gap-2", className)}>
      <p className="text-[0.8125rem] text-muted-foreground">The keeper has not run the exit for {KEEPER_IDLE_BLOCKS} blocks. Anyone may run it; this wallet pays the gas.</p>
      <Button
        size="sm"
        className="w-fit"
        disabled={disabled || tx.busy}
        onClick={async () => {
          if (await tx.send("Exit", { address: shield.executor!, abi: executorAbi, functionName: "exit", args: [borrower, []] })) onDone();
        }}
      >
        {tx.busy ? "Check your wallet" : "Run the exit yourself"}
      </Button>
      <TxStatus state={tx.state} />
    </div>
  );
}

/** Setup choices survive a reload in the same tab (sessionStorage), keyed by wallet. */
export interface SavedSetup {
  trigger?: number;
  maxDiscount?: number;
  prepay?: string;
  preset?: number;
}

export function readSetup(key: string): SavedSetup {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SavedSetup) : {};
  } catch {
    return {};
  }
}

export function writeSetup(key: string, value: SavedSetup) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode): the choices simply do not survive a reload.
  }
}
