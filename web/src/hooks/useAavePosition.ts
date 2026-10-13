"use client";

import { useMemo } from "react";
import type { Address, ContractFunctionParameters } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { aaveDataProviderAbi, aaveOracleAbi, aavePoolAbi, erc20Abi } from "@/lib/abis";
import { appChain } from "@/lib/chains";
import { aave } from "@/lib/env";
import { toNumber } from "@/lib/format";
import { useOnBlock } from "./useLiveBlock";

const chainId = appChain.id;

export interface ReserveLine {
  asset: Address;
  aToken: Address;
  symbol: string;
  decimals: number;
  supplied: number;
  borrowed: number;
  /** The aToken and variable-debt balances in token units, for exact comparisons (allowance against balance). */
  suppliedRaw: bigint;
  borrowedRaw: bigint;
  priceUsd: number;
  suppliedUsd: number;
  borrowedUsd: number;
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
}

export interface AavePosition {
  /** Reserves the wallet supplies or borrows. */
  reserves: ReserveLine[];
  /** Every Aave reserve, including ones the wallet does not hold (the cover's collateral after a full withdrawal). */
  allReserves: ReserveLine[];
  collateralUsd: number;
  debtUsd: number;
  healthFactor: number;
  liquidationThreshold: number;
  eMode: number;
  hasPosition: boolean;
  /** The wallet's USDC reserve line (debt Shield repays). */
  usdc?: ReserveLine;
  /**
   * LTV-0 reserves the wallet supplies and uses as collateral. Aave refuses to move other collateral while one is
   * enabled, so an exit could not take the aToken. Undefined while it is being checked.
   */
  ltv0Collateral: ReserveLine[] | undefined;
}

/**
 * A wallet's Aave V3 Monad position, read from the Pool, the oracle and every reserve's tokens on proposed state,
 * refreshed every block.
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
    // A slow read is not cancelled by the next block; it finishes and the next one starts after it.
    if (user && tokens.length) void live.refetch({ cancelRefetch: false });
  });

  const base = useMemo(() => {
    if (!live.data) return undefined;
    const account = live.data[0] as unknown as readonly bigint[];
    const prices = live.data[2] as unknown as readonly bigint[];
    const allReserves: ReserveLine[] = tokens.map((t, i) => {
      const suppliedRaw = live.data![3 + 2 * i] as bigint;
      const borrowedRaw = live.data![4 + 2 * i] as bigint;
      const supplied = toNumber(suppliedRaw, t.decimals);
      const borrowed = toNumber(borrowedRaw, t.decimals);
      const priceUsd = Number(prices[i] ?? 0n) / 1e8;
      return {
        asset: t.asset,
        aToken: t.aToken,
        symbol: t.symbol,
        decimals: t.decimals,
        supplied,
        borrowed,
        suppliedRaw,
        borrowedRaw,
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
      reserves: allReserves.filter((r) => r.suppliedRaw > 0n || r.borrowedRaw > 0n),
      allReserves,
      collateralUsd: Number(account[0]) / 1e8,
      debtUsd,
      healthFactor: account[1] === 0n ? Number.POSITIVE_INFINITY : toNumber(account[5], 18),
      liquidationThreshold: Number(account[3]) / 1e4,
      eMode: Number(live.data[1] as bigint),
      hasPosition: account[0] > 0n || account[1] > 0n,
      usdc: allReserves.find((r) => r.asset.toLowerCase() === aave.usdc.toLowerCase()),
    };
  }, [live.data, tokens]);

  // Only reserves with LTV 0 that the wallet supplies need the collateral flag; usually there are none.
  const ltv0Candidates = useMemo(() => base?.allReserves.filter((r) => r.ltv === 0 && r.suppliedRaw > 0n) ?? [], [base]);
  const ltv0 = useReadContracts({
    allowFailure: false,
    contracts: user
      ? ltv0Candidates.map((r) => ({ address: aave.dataProvider, abi: aaveDataProviderAbi, functionName: "getUserReserveData", args: [r.asset, user], chainId }) as const)
      : [],
    query: { enabled: Boolean(user) && ltv0Candidates.length > 0, refetchInterval: 10_000 },
  });

  const position = useMemo<AavePosition | undefined>(() => {
    if (!base) return undefined;
    let ltv0Collateral: ReserveLine[] | undefined = [];
    if (ltv0Candidates.length > 0) {
      ltv0Collateral = ltv0.data
        ? ltv0Candidates.filter((_, i) => (ltv0.data![i] as readonly unknown[] | undefined)?.[8] === true)
        : undefined;
    }
    return { ...base, ltv0Collateral };
  }, [base, ltv0Candidates, ltv0.data]);

  return {
    position,
    isLoading: reservesList.isLoading || statics.isLoading || (Boolean(user) && live.isLoading),
    error: reservesList.error ?? statics.error ?? live.error,
    refetch: live.refetch,
  };
}
