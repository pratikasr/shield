"use client";

import { useReadContract } from "wagmi";
import { repricerAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { shield } from "@/lib/env";
import { toNumber } from "@/lib/format";
import type { AssetConfig } from "./useShieldConfig";

export interface Sigma {
  /** Annualised volatility as a fraction (0.8 = 80% a year). */
  value: number;
  /** "measured": from the Repricer's window of Pyth prices; "fallback": the asset's set value, too few prices yet. */
  source: "measured" | "fallback";
}

/**
 * The volatility the Repricer prices a collateral with: `sigmaOf(feed, fallback)`, the realised volatility of the last
 * Pyth prices, or the asset's fallback while the window has fewer than 10 (ADR-023). It moves only when a new Pyth
 * price is sampled, so it refreshes every 30 s. `live` is the active cover's own quote, read every block, and wins.
 */
export function useSigma(asset: AssetConfig | undefined, live?: number): Sigma | undefined {
  const enabled = Boolean(shield.repricer && asset) && live === undefined;
  const read = useReadContract({
    address: shield.repricer,
    abi: repricerAbi,
    functionName: "sigmaOf",
    args: asset ? [asset.pythFeedId, asset.sigmaFallbackRaw] : undefined,
    chainId: monadMainnet.id,
    query: { enabled, refetchInterval: 30_000 },
  });
  const raw = read.data as bigint | undefined;
  const value = live ?? (raw !== undefined ? toNumber(raw, 18) : asset?.sigmaFallback);
  if (value === undefined || !Number.isFinite(value)) return undefined;
  // sigmaOf returns the fallback unchanged until the window has enough prices; a measured, clamped value that equals
  // it to the wei is not a realistic coincidence.
  const fallback = live === undefined ? raw === undefined || (asset !== undefined && raw === asset.sigmaFallbackRaw) : asset !== undefined && Math.abs(live - asset.sigmaFallback) < 1e-12;
  return { value, source: fallback ? "fallback" : "measured" };
}
