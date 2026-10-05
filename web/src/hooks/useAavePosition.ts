"use client";

import { useMemo } from "react";
import type { Address, ContractFunctionParameters } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { aaveDataProviderAbi, aaveOracleAbi, aavePoolAbi, erc20Abi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { aave } from "@/lib/env";

const chainId = monadMainnet.id;
import { toNumber } from "@/lib/format";
import { useOnBlock } from "./useLiveBlock";

export interface ReserveLine {
  asset: Address;
  aToken: Address;
  symbol: string;
  decimals: number;
  supplied: number;
  borrowed: number;
  priceUsd: number;
  suppliedUsd: number;
  borrowedUsd: number;
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
}

export interface AavePosition {
  reserves: ReserveLine[];
  collateralUsd: number;
  debtUsd: number;
  healthFactor: number;
  liquidationThreshold: number;
  eMode: number;
  hasPosition: boolean;
}

/**
 * The connected wallet's Aave V3 Monad position, read from the Pool, the oracle and every reserve's tokens on
 * proposed state, refreshed every block.
 */
export function useAavePosition(user?: Address) {
  const reservesList = useReadContract({ address: aave.pool, abi: aavePoolAbi, functionName: "getReservesList", chainId, query: { staleTime: Infinity } });
  const assets = useMemo(() => (reservesList.data ?? []) as readonly Address[], [reservesList.data]);

  const statics = useReadContracts({
    allowFailure: false,
    contracts: assets.flatMap((a) => [
      { address: aave.pool, abi: aavePoolAbi, functionName: "getReserveAToken", args: [a], chainId } as const,
      { address: aave.pool, abi: aavePoolAbi, functionName: "getReserveVariableDebtToken", args: [a], chainId } as const,
      { address: a, abi: erc20Abi, functionName: "symbol", chainId } as const,
      { address: aave.dataProvider, abi: aaveDataProviderAbi, functionName: "getReserveConfigurationData", args: [a], chainId } as const,
    ]),
    query: { enabled: assets.length > 0, staleTime: Infinity },
  });

  const tokens = useMemo(() => {
    if (!statics.data) return [];
    return assets.map((asset, i) => {
      const cfg = statics.data[4 * i + 3] as readonly [bigint, bigint, bigint, bigint, ...unknown[]];
      return {
        asset,
        aToken: statics.data[4 * i] as Address,
        vToken: statics.data[4 * i + 1] as Address,
        symbol: statics.data[4 * i + 2] as string,
        decimals: Number(cfg[0]),
        ltv: Number(cfg[1]) / 1e4,
        liquidationThreshold: Number(cfg[2]) / 1e4,
        liquidationBonus: Number(cfg[3]) / 1e4,
      };
    });
  }, [assets, statics.data]);

  const liveCalls: (ContractFunctionParameters & { chainId?: number })[] = user
    ? [
        { address: aave.pool, abi: aavePoolAbi, functionName: "getUserAccountData", args: [user], chainId },
        { address: aave.pool, abi: aavePoolAbi, functionName: "getUserEMode", args: [user], chainId },
        { address: aave.oracle, abi: aaveOracleAbi, functionName: "getAssetsPrices", args: [assets], chainId },
        ...tokens.flatMap((t) => [
          { address: t.aToken, abi: erc20Abi, functionName: "balanceOf", args: [user], chainId },
          { address: t.vToken, abi: erc20Abi, functionName: "balanceOf", args: [user], chainId },
        ]),
      ]
    : [];
  const live = useReadContracts({
    contracts: liveCalls,
    allowFailure: false,
    query: { enabled: Boolean(user) && tokens.length > 0 },
  });
  useOnBlock(() => {
    if (user && tokens.length) void live.refetch();
  });

  const position = useMemo<AavePosition | undefined>(() => {
    if (!live.data) return undefined;
    const account = live.data[0] as unknown as readonly bigint[];
    const prices = live.data[2] as unknown as readonly bigint[];
    const reserves: ReserveLine[] = tokens.map((t, i) => {
      const supplied = toNumber(live.data![3 + 2 * i] as bigint, t.decimals);
      const borrowed = toNumber(live.data![4 + 2 * i] as bigint, t.decimals);
      const priceUsd = Number(prices[i] ?? 0n) / 1e8;
      return {
        asset: t.asset,
        aToken: t.aToken,
        symbol: t.symbol,
        decimals: t.decimals,
        supplied,
        borrowed,
        priceUsd,
        suppliedUsd: supplied * priceUsd,
        borrowedUsd: borrowed * priceUsd,
        ltv: t.ltv,
        liquidationThreshold: t.liquidationThreshold,
        liquidationBonus: t.liquidationBonus,
      };
    });
    const debtUsd = Number(account[1]) / 1e8;
    return {
      reserves: reserves.filter((r) => r.supplied > 0 || r.borrowed > 0),
      collateralUsd: Number(account[0]) / 1e8,
      debtUsd,
      healthFactor: debtUsd === 0 ? Number.POSITIVE_INFINITY : toNumber(account[5], 18),
      liquidationThreshold: Number(account[3]) / 1e4,
      eMode: Number(live.data[1] as bigint),
      hasPosition: Number(account[0]) > 0 || debtUsd > 0,
    };
  }, [live.data, tokens]);

  return {
    position,
    isLoading: reservesList.isLoading || statics.isLoading || (Boolean(user) && live.isLoading),
    error: reservesList.error ?? statics.error ?? live.error,
  };
}
