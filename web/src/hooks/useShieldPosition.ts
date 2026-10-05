"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { erc20Abi, executorAbi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { aave, shield } from "@/lib/env";

const chainId = monadMainnet.id;
import { toNumber } from "@/lib/format";
import { useOnBlock } from "./useLiveBlock";

export const EXIT_STATUS = [
  "Ready",
  "NotActive",
  "CoverLapsed",
  "AboveTrigger",
  "EModeUnsupported",
  "DiscountAboveMax",
  "NothingToRepay",
  "AllowanceTooLow",
  "PythStale",
  "OracleDeviation",
  "TargetUnreachable",
] as const;
export type ExitStatus = (typeof EXIT_STATUS)[number];

export interface Cover {
  active: boolean;
  lapsed: boolean;
  exited: boolean;
  trigger: number;
  maxDiscountBps: number;
  collateral: Address | undefined;
  prepaidUsd: number;
  premiumPaidUsd: number;
  premiumPerBlockUsd: number;
  annualPremiumUsd: number;
  sigma: number;
  lastRepricedBlock: bigint;
  exitStatus: ExitStatus;
  repayUsd: number;
  aTokenAllowance: bigint;
  usdcAllowance: bigint;
  usdcBalance: number;
}

const FLAG_ACTIVE = 1;
const FLAG_LAPSED = 2;
const FLAG_EXITED = 4;

/** The connected wallet's Shield cover: registry record, live quote and exit preview, refreshed every block. */
export function useShieldPosition(user?: Address, aToken?: Address) {
  const enabled = Boolean(user && shield.registry && shield.repricer && shield.executor);
  const reads = useReadContracts({
    allowFailure: true,
    contracts: enabled
      ? [
          { address: shield.registry!, abi: positionRegistryAbi, functionName: "record", args: [user!], chainId } as const,
          { address: shield.repricer!, abi: repricerAbi, functionName: "quote", args: [user!], chainId } as const,
          { address: shield.executor!, abi: executorAbi, functionName: "previewExit", args: [user!], chainId } as const,
          { address: shield.registry!, abi: positionRegistryAbi, functionName: "collateralOf", args: [user!], chainId } as const,
          {
            address: aToken ?? aave.weth,
            abi: erc20Abi,
            functionName: "allowance",
            args: [user!, shield.executor!],
            chainId,
          } as const,
          { address: aave.usdc, abi: erc20Abi, functionName: "allowance", args: [user!, shield.repricer!], chainId } as const,
          { address: aave.usdc, abi: erc20Abi, functionName: "balanceOf", args: [user!], chainId } as const,
        ]
      : [],
    query: { enabled },
  });
  useOnBlock(() => {
    if (enabled) void reads.refetch();
  });

  const cover = useMemo<Cover | undefined>(() => {
    const d = reads.data;
    if (!d || d[0]?.status !== "success") return undefined;
    const r = d[0].result as {
      trigger: number;
      maxDiscountBps: number;
      flags: number;
      prepaid: bigint;
      accrued: bigint;
      premiumPerBlock: bigint;
      sigma: bigint;
      lastRepricedBlock: bigint;
    };
    const q = d[1]?.status === "success" ? (d[1].result as readonly bigint[]) : undefined;
    const preview = d[2]?.status === "success" ? (d[2].result as readonly [number, bigint, bigint, bigint]) : undefined;
    const active = (r.flags & FLAG_ACTIVE) !== 0;
    return {
      active,
      lapsed: (r.flags & FLAG_LAPSED) !== 0,
      exited: (r.flags & FLAG_EXITED) !== 0,
      trigger: r.trigger / 1e4,
      maxDiscountBps: r.maxDiscountBps,
      collateral: d[3]?.status === "success" ? (d[3].result as Address) : undefined,
      prepaidUsd: toNumber(r.prepaid, 18),
      premiumPaidUsd: toNumber(r.accrued, 18),
      premiumPerBlockUsd: active ? toNumber(r.premiumPerBlock, 18) : q ? toNumber(q[0], 18) : 0,
      annualPremiumUsd: q ? toNumber(q[3], 18) : 0,
      sigma: q ? toNumber(q[2], 18) : toNumber(r.sigma, 18),
      lastRepricedBlock: r.lastRepricedBlock,
      exitStatus: preview ? (EXIT_STATUS[preview[0]] ?? "NotActive") : "NotActive",
      repayUsd: preview ? toNumber(preview[1], 6) : 0,
      aTokenAllowance: d[4]?.status === "success" ? (d[4].result as bigint) : 0n,
      usdcAllowance: d[5]?.status === "success" ? (d[5].result as bigint) : 0n,
      usdcBalance: d[6]?.status === "success" ? toNumber(d[6].result as bigint, 6) : 0,
    };
  }, [reads.data]);

  return { cover, isLoading: enabled && reads.isLoading, error: reads.error, refetch: reads.refetch };
}
