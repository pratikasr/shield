"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { zeroHash, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { Label } from "@/components/ui/label";
import { useOnBlock } from "@/hooks/useLiveBlock";
import { assetConfigOf, type ShieldConfig } from "@/hooks/useShieldConfig";
import { pythAbi, repricerAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { pythAddress, shield } from "@/lib/env";
import { toNumber } from "@/lib/format";

export const chainId = monadMainnet.id;
export const AAVE_APP = "https://app.aave.com/?marketName=proto_monad_v3";
/** Blocks an exit may stay due before the page offers to run it from this wallet. */
export const KEEPER_IDLE_BLOCKS = 10;

export interface Quote {
  perBlockUsd: number;
  sigma: number;
  annualUsd: number;
}

function parseQuote(d: unknown): Quote | undefined {
  const q = d as readonly [bigint, bigint, bigint, bigint] | undefined;
  return q ? { perBlockUsd: toNumber(q[0], 18), sigma: toNumber(q[2], 18), annualUsd: toNumber(q[3], 18) } : undefined;
}

/** The live premium for a trigger that is not on chain yet (setup, or a new trigger for an active cover). */
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
  return parseQuote(q.data);
}

/** The live premium for several triggers in one read per block: the preset cards' cost a month. */
export function useQuotes(user: Address | undefined, collateral: Address | undefined, triggers: number[], enabled = true) {
  const on = enabled && Boolean(shield.repricer && user && collateral) && triggers.length > 0;
  const key = triggers.join(",");
  const contracts = useMemo(
    () =>
      on
        ? triggers.map((t) => ({ address: shield.repricer!, abi: repricerAbi, functionName: "quoteFor", args: [user!, collateral!, Math.round(t * 1e4)], chainId }) as const)
        : [],
    // The trigger list is compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on, user, collateral, key],
  );
  const q = useReadContracts({ allowFailure: true, contracts, query: { enabled: on } });
  useOnBlock(() => {
    if (on) void q.refetch({ cancelRefetch: false });
  });
  return useMemo(() => {
    const out: Record<string, Quote | undefined> = {};
    triggers.forEach((t, i) => {
      const r = q.data?.[i];
      out[t.toFixed(2)] = r?.status === "success" ? parseQuote(r.result) : undefined;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, key]);
}

/** Pyth's price for the collateral, the one the Executor checks against Aave's; read only while `enabled`. */
export function usePythPrice(config: ShieldConfig | undefined, asset: Address | undefined, enabled: boolean) {
  const feed = assetConfigOf(config, asset)?.pythFeedId;
  const on = enabled && Boolean(feed && feed !== zeroHash);
  const p = useReadContract({ address: pythAddress, abi: pythAbi, functionName: "getPriceUnsafe", args: [feed ?? zeroHash], chainId, query: { enabled: on } });
  useOnBlock(() => {
    if (on) void p.refetch({ cancelRefetch: false });
  });
  const d = on ? p.data : undefined;
  return d ? { price: Number(d.price) * 10 ** d.expo, conf: Number(d.conf) * 10 ** d.expo, publishTime: Number(d.publishTime), raw: d } : undefined;
}

export function SectionLabel({ htmlFor, children, aside }: { htmlFor?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-sm font-semibold">
          {children}
        </Label>
      ) : (
        <p className="text-sm font-semibold">{children}</p>
      )}
      {aside}
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

/** Setup choices survive a reload in the same tab (sessionStorage), keyed by wallet. */
export interface SavedSetup {
  preset?: string;
  fuel?: string;
  source?: "monad" | "other";
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
