"use client";

import { useMemo } from "react";
import type { Address, ContractFunctionParameters, Hex } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { executorAbi, positionRegistryAbi } from "@/lib/abis";
import { appChain } from "@/lib/chains";
import { shield } from "@/lib/env";

const chainId = appChain.id;

export interface AssetConfig {
  asset: Address;
  enabled: boolean;
  id: number;
  pythFeedId: Hex;
  /** Pricing constant, as a fraction (0.00125). */
  k: number;
  /** Fallback volatility, as a fraction (0.8 = 80% a year). */
  sigmaFallback: number;
  /** The same, x 1e18 as stored, for passing back to the Repricer's `sigmaOf`. */
  sigmaFallbackRaw: bigint;
}

/** The owner-set parameters every rule on the page must match, read from the registry and the Executor. */
export interface ShieldConfig {
  /** Every collateral the registry lists, enabled or not, in registry id order. */
  assets: AssetConfig[];
  exitDiscountBps: number;
  /** HF an exit adds above the trigger (0.06). */
  exitHfBuffer: number;
  /** Floor on the premium's HF distance (0.01). */
  dMin: number;
  /** Seconds cover waits after opt-in, a restore or a raised trigger before it can exit. */
  minCoverSeconds: number;
  maxOracleDeviationBps: number;
  /** Oldest Pyth price an exit accepts, in seconds. */
  exitMaxPriceAge: number;
  /** Share of each premium charge that goes to the protocol treasury, in bps (ADR-037); the vault keeps the rest. */
  protocolShareBps: number;
  /** Where the protocol's share is paid. */
  treasury: Address;
}

/** Registry and Executor parameters. They change only by owner transactions, so they refresh every 30 s, not every block. */
export function useShieldConfig() {
  const enabled = Boolean(shield.registry && shield.executor);
  const list = useReadContract({
    address: shield.registry,
    abi: positionRegistryAbi,
    functionName: "assets",
    chainId,
    query: { enabled, refetchInterval: 30_000 },
  });
  const assets = useMemo(() => (list.data ?? []) as readonly Address[], [list.data]);
  const calls: (ContractFunctionParameters & { chainId?: number })[] = enabled
    ? [
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "exitDiscountBps", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "exitHfBuffer", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "dMin", chainId },
        { address: shield.executor!, abi: executorAbi, functionName: "minCoverSeconds", chainId },
        { address: shield.executor!, abi: executorAbi, functionName: "maxOracleDeviationBps", chainId },
        { address: shield.executor!, abi: executorAbi, functionName: "exitMaxPriceAge", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "protocolShareBps", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "treasury", chainId },
        ...assets.map((a) => ({ address: shield.registry!, abi: positionRegistryAbi, functionName: "assetConfig", args: [a], chainId })),
      ]
    : [];
  const reads = useReadContracts({
    allowFailure: false,
    contracts: calls,
    query: { enabled: enabled && list.isSuccess, refetchInterval: 30_000 },
  });

  const config = useMemo<ShieldConfig | undefined>(() => {
    const d = reads.data as readonly unknown[] | undefined;
    if (!d) return undefined;
    return {
      exitDiscountBps: Number(d[0]),
      exitHfBuffer: Number(d[1]) / 1e4,
      dMin: Number(d[2]) / 1e4,
      minCoverSeconds: Number(d[3]),
      maxOracleDeviationBps: Number(d[4]),
      exitMaxPriceAge: Number(d[5]),
      protocolShareBps: Number(d[6]),
      treasury: d[7] as Address,
      assets: assets.map((asset, i) => {
        const c = d[8 + i] as { enabled: boolean; id: number; pythFeedId: Hex; k: bigint; sigmaFallback: bigint };
        return { asset, enabled: c.enabled, id: Number(c.id), pythFeedId: c.pythFeedId, k: Number(c.k) / 1e18, sigmaFallback: Number(c.sigmaFallback) / 1e18, sigmaFallbackRaw: BigInt(c.sigmaFallback) };
      }),
    };
  }, [reads.data, assets]);

  return { config, isLoading: list.isLoading || reads.isLoading, error: list.error ?? reads.error };
}

/** The vault's share of each premium, as a fraction (0.9 when 10% is paid to the treasury directly). */
export function vaultPremiumShare(config: Pick<ShieldConfig, "protocolShareBps">): number {
  return 1 - config.protocolShareBps / 10_000;
}

/** The registry's settings for one collateral, if listed. */
export function assetConfigOf(config: ShieldConfig | undefined, asset: Address | undefined): AssetConfig | undefined {
  if (!config || !asset) return undefined;
  return config.assets.find((a) => a.asset.toLowerCase() === asset.toLowerCase());
}
