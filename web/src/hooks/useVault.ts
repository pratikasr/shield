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
/** Reads about the vault itself; the connected account's reads come after them. */
const BASE_READS = 13;

export interface VaultState {
  /** totalAssets: what the shares are worth now (gross assets less exit gains still unlocking). */
  nav: number;
  /** grossAssets: idle USDC, premium at the Repricer and seized collateral at Aave's oracle. */
  gross: number;
  /** Exit gains not yet in the share price; they unlock linearly over six hours. */
  lockedProfit: number;
  /** availableLiquidity: USDC the vault can pay out now, including premium not yet swept. */
  idle: number;
  /** Seized collateral valued at Aave's oracle. */
  collateralHeld: number;
  /** The vault's share of every premium charged so far (ADR-037), swept in or not, in whole USDC units. */
  premiumEarned: number;
  /**
   * What exits earned the vault: the collateral value it received (at Aave's oracle when each exit ran) above the USDC
   * it paid into them. Gross: a later sale of the collateral can fetch more or less.
   */
  exitGains: number;
  /** The vault's share charged and still waiting at the Repricer for a sweep. */
  premiumPending: number;
  usdcOnHand: number;
  exitsExecuted: number;
  averageDiscountBps: number;
  sharePrice: number;
  profitUnlockSeconds: number;
  /** Most a sale of seized collateral may fall short of Aave's price, in bps. */
  maxSwapSlippageBps: number;
  user?: {
    shares: bigint;
    assets: number;
    maxWithdraw: bigint;
    maxRedeem: bigint;
    usdcBalance: bigint;
    usdcAllowance: bigint;
    /**
     * Whether this account may deposit (the vault's depositor allowlist, ADR-039): at launch only the protocol
     * treasury. Undefined when the read failed, for example on a vault deployed before the allowlist.
     */
    depositAllowed?: boolean;
  };
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
        { address: v, abi: shieldVaultAbi, functionName: "grossAssets", chainId },
        { address: v, abi: shieldVaultAbi, functionName: "lockedProfit", chainId },
        { address: v, abi: shieldVaultAbi, functionName: "PROFIT_UNLOCK_SECONDS", chainId },
        { address: v, abi: shieldVaultAbi, functionName: "maxSwapSlippageBps", chainId },
        { address: v, abi: shieldVaultAbi, functionName: "totalExitFunding", chainId },
        { address: v, abi: shieldVaultAbi, functionName: "totalCollateralValueReceived", chainId },
        ...(user
          ? [
              { address: v, abi: shieldVaultAbi, functionName: "balanceOf", args: [user], chainId },
              { address: v, abi: shieldVaultAbi, functionName: "maxWithdraw", args: [user], chainId },
              { address: v, abi: shieldVaultAbi, functionName: "maxRedeem", args: [user], chainId },
              { address: aave.usdc, abi: erc20Abi, functionName: "balanceOf", args: [user], chainId },
              { address: aave.usdc, abi: erc20Abi, functionName: "allowance", args: [user, v], chainId },
              { address: v, abi: shieldVaultAbi, functionName: "depositorAllowed", args: [user], chainId },
            ]
          : []),
      ]
    : [];
  const reads = useReadContracts({ allowFailure: true, contracts: calls, query: { enabled: Boolean(v) } });
  useOnBlock(() => {
    if (v) void reads.refetch({ cancelRefetch: false });
  });

  const state = useMemo<VaultState | undefined>(() => {
    const d = reads.data;
    if (!d || d[0]?.status !== "success") return undefined;
    const n = (i: number) => (d[i]?.status === "success" ? (d[i]!.result as bigint) : 0n);
    const nav = toNumber(n(0), 6);
    const idle = toNumber(n(1), 6);
    const grossRead = d[7]?.status === "success";
    const gross = grossRead ? toNumber(n(7), 6) : nav;
    const lockedProfit = toNumber(n(8), 6);
    // The user's reads follow the vault's own BASE_READS.
    const shares = n(BASE_READS);
    const premiumEarned = toNumber(n(2), 6);
    const premiumPending = Math.max(premiumEarned - toNumber(n(6), 6), 0);
    return {
      nav,
      gross,
      lockedProfit,
      idle,
      // Collateral is what gross assets hold beyond the USDC the vault can pay out (which includes pending premium).
      collateralHeld: Math.max(gross - idle, 0),
      premiumEarned,
      exitGains: Math.max(toNumber(n(12), 6) - toNumber(n(11), 6), 0),
      premiumPending,
      usdcOnHand: Math.max(idle - premiumPending, 0),
      exitsExecuted: Number(n(3)),
      averageDiscountBps: Number(n(4)),
      sharePrice: toNumber(n(5), 6),
      profitUnlockSeconds: Number(n(9)) || 6 * 3600,
      maxSwapSlippageBps: d[10]?.status === "success" ? Number(n(10)) : 300,
      user: user
        ? {
            shares,
            assets: toNumber(shares, 12) * toNumber(n(5), 6),
            maxWithdraw: n(BASE_READS + 1),
            maxRedeem: n(BASE_READS + 2),
            usdcBalance: n(BASE_READS + 3),
            usdcAllowance: n(BASE_READS + 4),
            depositAllowed: d[BASE_READS + 5]?.status === "success" ? Boolean(d[BASE_READS + 5]!.result) : undefined,
          }
        : undefined,
    };
  }, [reads.data, user]);

  return { vault: state, isLoading: reads.isLoading, error: reads.error, refetch: reads.refetch };
}
