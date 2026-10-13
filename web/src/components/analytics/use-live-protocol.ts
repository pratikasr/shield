"use client";

import { useMemo } from "react";
import type { Address, ContractFunctionParameters } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { useOnBlock } from "@/hooks/useLiveBlock";
import { aavePoolAbi, erc20Abi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { appChain } from "@/lib/chains";
import { aave, multicall3, shield } from "@/lib/env";
import { toNumber } from "@/lib/format";

const chainId = appChain.id;
/** Covers read per page load; the table says so if there are more. */
export const ACTIVE_READ_LIMIT = 200;
const FLAG_LAPSED = 2;
const multicallAbi = [{ type: "function", name: "getCurrentBlockTimestamp", stateMutability: "view", inputs: [], outputs: [{ name: "timestamp", type: "uint256" }] }] as const;

export interface LiveCover {
  borrower: Address;
  healthFactor: number;
  /** USDC variable debt, in USDC. */
  usdcDebt: number;
  lapsed: boolean;
  /** Live per-block premium, 18-decimal units. */
  premiumPerBlock: bigint;
}

export interface ProtocolShare {
  shareBps?: number;
  maxShareBps?: number;
  treasury?: Address;
}

/** The protocol share and its cap. Owner-set, so read every 30 s rather than every block. */
export function useProtocolShare(): ProtocolShare {
  const enabled = Boolean(shield.registry);
  const q = useReadContracts({
    allowFailure: true,
    contracts: enabled
      ? [
          { address: shield.registry!, abi: positionRegistryAbi, functionName: "protocolShareBps", chainId },
          { address: shield.registry!, abi: positionRegistryAbi, functionName: "MAX_PROTOCOL_SHARE_BPS", chainId },
          { address: shield.registry!, abi: positionRegistryAbi, functionName: "treasury", chainId },
        ]
      : [],
    query: { enabled, refetchInterval: 30_000 },
  });
  const ok = (i: number) => (q.data?.[i]?.status === "success" ? q.data[i]!.result : undefined);
  return {
    shareBps: ok(0) !== undefined ? Number(ok(0)) : undefined,
    maxShareBps: ok(1) !== undefined ? Number(ok(1)) : undefined,
    treasury: ok(2) as Address | undefined,
  };
}

export interface LiveCovers {
  activeCount?: number;
  /** Protocol share charged and not yet swept, in dollars (from the 18-decimal counter, so sub-micro amounts show). */
  pendingProtocol?: number;
  covers?: LiveCover[];
  /** USDC debt of active covers that are paid up. */
  protectedDebt?: number;
  lapsedCount?: number;
  error: Error | null;
}

/**
 * Active covers, read live on every block: the registry's active borrowers with their Aave health factor, USDC debt
 * and current rate, and the protocol premium waiting for the next sweep. Components that show these call it
 * themselves, so a block re-renders them and not the whole page; wagmi shares one query between them.
 */
export function useLiveCovers(): LiveCovers {
  const enabled = Boolean(shield.registry && shield.repricer);
  const baseCalls: (ContractFunctionParameters & { chainId?: number })[] = enabled
    ? [
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "activeCount", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "activeBorrowers", args: [0n, BigInt(ACTIVE_READ_LIMIT)], chainId },
        { address: shield.repricer!, abi: repricerAbi, functionName: "pendingToTreasury", chainId },
        { address: aave.pool, abi: aavePoolAbi, functionName: "getReserveVariableDebtToken", args: [aave.usdc], chainId },
      ]
    : [];
  const base = useReadContracts({ allowFailure: true, contracts: baseCalls, query: { enabled } });
  const ok = <T,>(i: number): T | undefined => (base.data?.[i]?.status === "success" ? (base.data[i]!.result as T) : undefined);
  const borrowers = ok<readonly Address[]>(1);
  const debtToken = ok<Address>(3);

  const coverCalls: (ContractFunctionParameters & { chainId?: number })[] =
    borrowers && debtToken
      ? borrowers.flatMap((b) => [
          { address: aave.pool, abi: aavePoolAbi, functionName: "getUserAccountData", args: [b], chainId },
          { address: debtToken, abi: erc20Abi, functionName: "balanceOf", args: [b], chainId },
          { address: shield.registry!, abi: positionRegistryAbi, functionName: "record", args: [b], chainId },
        ])
      : [];
  const per = useReadContracts({ allowFailure: true, contracts: coverCalls, query: { enabled: coverCalls.length > 0 } });

  useOnBlock(() => {
    if (!enabled) return;
    void base.refetch({ cancelRefetch: false });
    if (coverCalls.length) void per.refetch({ cancelRefetch: false });
  });

  const covers = useMemo<LiveCover[] | undefined>(() => {
    if (!borrowers) return undefined;
    if (!borrowers.length) return [];
    const d = per.data;
    if (!d) return undefined;
    return borrowers.map((borrower, i) => {
      const acct = d[i * 3]?.status === "success" ? (d[i * 3]!.result as readonly bigint[]) : undefined;
      const debt = d[i * 3 + 1]?.status === "success" ? (d[i * 3 + 1]!.result as bigint) : 0n;
      const rec = d[i * 3 + 2]?.status === "success" ? (d[i * 3 + 2]!.result as { flags: number; premiumPerBlock: bigint }) : undefined;
      return {
        borrower,
        healthFactor: acct ? toNumber(acct[5], 18) : Number.NaN,
        usdcDebt: toNumber(debt, 6),
        lapsed: rec ? (Number(rec.flags) & FLAG_LAPSED) !== 0 : false,
        premiumPerBlock: rec?.premiumPerBlock ?? 0n,
      };
    });
  }, [borrowers, per.data]);

  const pending = ok<bigint>(2);
  const count = ok<bigint>(0);
  return {
    activeCount: count !== undefined ? Number(count) : undefined,
    pendingProtocol: pending !== undefined ? toNumber(pending, 18) : undefined,
    covers,
    protectedDebt: covers?.filter((c) => !c.lapsed).reduce((s, c) => s + c.usdcDebt, 0),
    lapsedCount: covers?.filter((c) => c.lapsed).length,
    error: base.error ?? null,
  };
}

/** Chain time (latest block timestamp, seconds), read every 15 s; the wall clock until it answers. */
export function useChainTime(): number {
  const q = useReadContract({ address: multicall3, abi: multicallAbi, functionName: "getCurrentBlockTimestamp", chainId, query: { refetchInterval: 15_000 } });
  return q.data !== undefined ? Number(q.data) : Math.floor(Date.now() / 1000);
}
