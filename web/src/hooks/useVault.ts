"use client";

import { useMemo } from "react";
import type { Address, ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import { erc20Abi, shieldVaultAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { aave, shield } from "@/lib/env";
import { toNumber } from "@/lib/format";
import { useOnBlock } from "./useLiveBlock";

const chainId = monadMainnet.id;

export interface VaultState {
  nav: number;
  idle: number;
  collateralHeld: number;
  premiumEarned: number;
  premiumPending: number;
  usdcOnHand: number;
  exitsExecuted: number;
  averageDiscountBps: number;
  sharePrice: number;
  user?: { shares: bigint; assets: number; maxWithdraw: number; usdcBalance: number; usdcAllowance: bigint };
}

/** The ShieldVault's live readings and, when connected, the wallet's share of it. Refreshed every block. */
export function useVault(user?: Address) {
  const v = shield.vault;
  const calls: (ContractFunctionParameters & { chainId?: number })[] = v
      ? [
          { address: v, abi: shieldVaultAbi, functionName: "totalAssets", chainId },
          { address: v, abi: shieldVaultAbi, functionName: "availableLiquidity", chainId },
          { address: v, abi: shieldVaultAbi, functionName: "premiumEarned", chainId },
          { address: v, abi: shieldVaultAbi, functionName: "exitsExecuted", chainId },
          { address: v, abi: shieldVaultAbi, functionName: "averageDiscountBps", chainId },
          { address: v, abi: shieldVaultAbi, functionName: "convertToAssets", args: [10n ** 12n], chainId },
          { address: v, abi: shieldVaultAbi, functionName: "totalPremiumEarned", chainId },
          ...(user
            ? ([
                { address: v, abi: shieldVaultAbi, functionName: "balanceOf", args: [user], chainId },
                { address: v, abi: shieldVaultAbi, functionName: "maxWithdraw", args: [user], chainId },
                { address: aave.usdc, abi: erc20Abi, functionName: "balanceOf", args: [user], chainId },
                { address: aave.usdc, abi: erc20Abi, functionName: "allowance", args: [user, v], chainId },
              ] as const)
            : []),
        ]
      : [];
  const reads = useReadContracts({ allowFailure: true, contracts: calls, query: { enabled: Boolean(v) } });
  useOnBlock(() => {
    if (v) void reads.refetch();
  });

  const state = useMemo<VaultState | undefined>(() => {
    const d = reads.data;
    if (!d || d[0]?.status !== "success") return undefined;
    const n = (i: number) => (d[i]?.status === "success" ? (d[i]!.result as bigint) : 0n);
    const nav = toNumber(n(0), 6);
    const idle = toNumber(n(1), 6);
    const shares = n(7);
    const premiumEarned = toNumber(n(2), 6);
    const premiumPending = Math.max(premiumEarned - toNumber(n(6), 6), 0);
    return {
      nav,
      idle,
      collateralHeld: Math.max(nav - idle, 0),
      premiumEarned,
      premiumPending,
      usdcOnHand: Math.max(idle - premiumPending, 0),
      exitsExecuted: Number(n(3)),
      averageDiscountBps: Number(n(4)),
      sharePrice: toNumber(n(5), 6),
      user: user
        ? {
            shares,
            assets: toNumber(shares, 12) * toNumber(n(5), 6),
            maxWithdraw: toNumber(n(8), 6),
            usdcBalance: toNumber(n(9), 6),
            usdcAllowance: n(10),
          }
        : undefined,
    };
  }, [reads.data, user]);

  return { vault: state, isLoading: reads.isLoading, error: reads.error, refetch: reads.refetch };
}
