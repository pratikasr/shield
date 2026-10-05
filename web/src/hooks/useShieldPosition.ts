"use client";

import { useMemo } from "react";
import type { Address, ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import { erc20Abi, executorAbi, multicall3Abi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { aave, multicall3, shield } from "@/lib/env";
import { EXIT_STATUS, type ExitStatus } from "@/lib/exit-status";
import { toNumber } from "@/lib/format";
import { useOnBlock } from "./useLiveBlock";

export { EXIT_STATUS, type ExitStatus } from "@/lib/exit-status";

const chainId = monadMainnet.id;

export interface Cover {
  /** The wallet has opted in at some point, so the record's collateral and times mean something. */
  exists: boolean;
  active: boolean;
  lapsed: boolean;
  exited: boolean;
  trigger: number;
  maxDiscountBps: number;
  /** The collateral the cover seizes; only set when the record exists. */
  collateral: Address | undefined;
  /** Start of cover for the waiting period: opt-in, restore from lapse or trigger raise (unix seconds). */
  optedInAt: number;
  /** Prepaid balance in 18-decimal units (1e18 = 1 USDC). */
  prepaidWad: bigint;
  prepaidUsd: number;
  premiumPaidUsd: number;
  /** The rate stored at the last reprice. */
  premiumPerBlockUsd: number;
  /** The rate at live state: what the next reprice will set. */
  livePremiumPerBlockUsd: number;
  annualPremiumUsd: number;
  sigma: number;
  lastRepricedBlock: bigint;
  exitStatus: ExitStatus;
  repayUsd: number;
  /** aToken allowance to the Executor, by collateral asset (lowercase address). */
  aTokenAllowances: Record<string, bigint>;
  usdcAllowance: bigint;
  usdcBalanceRaw: bigint;
  usdcBalance: number;
  /** Chain time of the block these values come from (unix seconds), and when it was read (ms). */
  chainTime: number | undefined;
  readAt: number;
}

const FLAG_ACTIVE = 1;
const FLAG_LAPSED = 2;
const FLAG_EXITED = 4;

/**
 * A wallet's Shield cover: registry record, live quote, exit preview, chain time and every allowance the cover needs,
 * refreshed every block in one multicall. `coverable` (the registry's collateral and their aTokens) must be memoised.
 */
export function useShieldPosition(user: Address | undefined, coverable: { asset: Address; aToken: Address }[]) {
  const enabled = Boolean(user && shield.registry && shield.repricer && shield.executor);
  const calls: (ContractFunctionParameters & { chainId?: number })[] = enabled
    ? [
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "record", args: [user!], chainId },
        { address: shield.repricer!, abi: repricerAbi, functionName: "quote", args: [user!], chainId },
        { address: shield.executor!, abi: executorAbi, functionName: "previewExit", args: [user!], chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "collateralOf", args: [user!], chainId },
        { address: multicall3, abi: multicall3Abi, functionName: "getCurrentBlockTimestamp", chainId },
        { address: aave.usdc, abi: erc20Abi, functionName: "allowance", args: [user!, shield.repricer!], chainId },
        { address: aave.usdc, abi: erc20Abi, functionName: "balanceOf", args: [user!], chainId },
        ...coverable.map((c) => ({ address: c.aToken, abi: erc20Abi, functionName: "allowance", args: [user!, shield.executor!], chainId })),
      ]
    : [];
  const reads = useReadContracts({ allowFailure: true, contracts: calls, query: { enabled } });
  useOnBlock(() => {
    if (enabled) void reads.refetch({ cancelRefetch: false });
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
      optedInAt: bigint;
    };
    const q = d[1]?.status === "success" ? (d[1].result as readonly bigint[]) : undefined;
    const preview = d[2]?.status === "success" ? (d[2].result as readonly [number, bigint, bigint, bigint]) : undefined;
    const active = (r.flags & FLAG_ACTIVE) !== 0;
    const exists = r.optedInAt > 0n;
    const ok = (i: number) => (d[i]?.status === "success" ? (d[i]!.result as bigint) : undefined);
    const aTokenAllowances: Record<string, bigint> = {};
    coverable.forEach((c, i) => {
      aTokenAllowances[c.asset.toLowerCase()] = ok(7 + i) ?? 0n;
    });
    const usdcBalanceRaw = ok(6) ?? 0n;
    const time = ok(4);
    return {
      exists,
      active,
      lapsed: (r.flags & FLAG_LAPSED) !== 0,
      exited: (r.flags & FLAG_EXITED) !== 0,
      trigger: r.trigger / 1e4,
      maxDiscountBps: r.maxDiscountBps,
      collateral: exists && d[3]?.status === "success" ? (d[3].result as Address) : undefined,
      optedInAt: Number(r.optedInAt),
      prepaidWad: r.prepaid,
      prepaidUsd: toNumber(r.prepaid, 18),
      premiumPaidUsd: toNumber(r.accrued, 18),
      premiumPerBlockUsd: active ? toNumber(r.premiumPerBlock, 18) : 0,
      livePremiumPerBlockUsd: q ? toNumber(q[0], 18) : 0,
      annualPremiumUsd: q ? toNumber(q[3], 18) : 0,
      sigma: q ? toNumber(q[2], 18) : toNumber(r.sigma, 18),
      lastRepricedBlock: r.lastRepricedBlock,
      exitStatus: preview ? (EXIT_STATUS[preview[0]] ?? "NotActive") : "NotActive",
      repayUsd: preview ? toNumber(preview[1], 6) : 0,
      aTokenAllowances,
      usdcAllowance: ok(5) ?? 0n,
      usdcBalanceRaw,
      usdcBalance: toNumber(usdcBalanceRaw, 6),
      chainTime: time === undefined ? undefined : Number(time),
      readAt: Date.now(),
    };
  }, [reads.data, coverable]);

  return { cover, isLoading: enabled && reads.isLoading, error: reads.error, refetch: reads.refetch };
}
