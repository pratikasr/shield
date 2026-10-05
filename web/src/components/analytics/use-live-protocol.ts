"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { encodeEventTopics, type Address, type ContractFunctionParameters, type Hex } from "viem";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { useOnBlock } from "@/hooks/useLiveBlock";
import { aavePoolAbi, erc20Abi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { type RepriceReceipt, repriceCost } from "@/lib/analytics";
import { monadMainnet } from "@/lib/chains";
import { aave, multicall3, pythAddress, shield } from "@/lib/env";
import { toNumber } from "@/lib/format";

const chainId = monadMainnet.id;
/** Covers read per page load; the table says so if there are more. */
export const ACTIVE_READ_LIMIT = 200;
const FLAG_LAPSED = 2;
/** Pyth MON/USD on Monad, verified 5 Oct 2026 (docs/TECH-DECISIONS.md, Verified facts). */
const MON_USD_FEED: Hex = "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1";

const pythAbi = [
  {
    type: "function",
    name: "getPriceUnsafe",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
] as const;

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

export interface LiveProtocol {
  shareBps?: number;
  maxShareBps?: number;
  treasury?: Address;
  activeCount?: number;
  /** Protocol share charged and not yet swept, in dollars (from the 18-decimal counter, so sub-micro amounts show). */
  pendingProtocol?: number;
  covers?: LiveCover[];
  /** USDC debt of active covers that are paid up. */
  protectedDebt?: number;
  lapsedCount?: number;
  /** True once the first full read has answered. */
  loaded: boolean;
  error: Error | null;
}

/**
 * The protocol's live state on Monad, refreshed every block: the protocol share and treasury, active covers with their
 * Aave health factor and USDC debt, and the protocol premium waiting for the next sweep.
 */
export function useLiveProtocol(): LiveProtocol {
  const enabled = Boolean(shield.registry && shield.repricer);
  const baseCalls: (ContractFunctionParameters & { chainId?: number })[] = enabled
    ? [
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "protocolShareBps", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "MAX_PROTOCOL_SHARE_BPS", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "treasury", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "activeCount", chainId },
        { address: shield.registry!, abi: positionRegistryAbi, functionName: "activeBorrowers", args: [0n, BigInt(ACTIVE_READ_LIMIT)], chainId },
        { address: shield.repricer!, abi: repricerAbi, functionName: "pendingToTreasury", chainId },
        { address: aave.pool, abi: aavePoolAbi, functionName: "getReserveVariableDebtToken", args: [aave.usdc], chainId },
      ]
    : [];
  const base = useReadContracts({ allowFailure: true, contracts: baseCalls, query: { enabled } });
  const ok = <T,>(i: number): T | undefined => (base.data?.[i]?.status === "success" ? (base.data[i]!.result as T) : undefined);
  const borrowers = ok<readonly Address[]>(4);
  const debtToken = ok<Address>(6);

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

  const pending = ok<bigint>(5);
  return {
    shareBps: ok<number>(0) !== undefined ? Number(ok<number>(0)) : undefined,
    maxShareBps: ok<number>(1) !== undefined ? Number(ok<number>(1)) : undefined,
    treasury: ok<Address>(2),
    activeCount: ok<bigint>(3) !== undefined ? Number(ok<bigint>(3)) : undefined,
    pendingProtocol: pending !== undefined ? toNumber(pending, 18) : undefined,
    covers,
    protectedDebt: covers?.filter((c) => !c.lapsed).reduce((s, c) => s + c.usdcDebt, 0),
    lapsedCount: covers?.filter((c) => c.lapsed).length,
    loaded: base.isSuccess && (covers !== undefined || !borrowers),
    error: base.error ?? null,
  };
}

/** Chain time (latest block timestamp, seconds), read every 15 s; the wall clock until it answers. */
export function useChainTime(): number {
  const q = useReadContract({ address: multicall3, abi: multicallAbi, functionName: "getCurrentBlockTimestamp", chainId, query: { refetchInterval: 15_000 } });
  return q.data !== undefined ? Number(q.data) : Math.floor(Date.now() / 1000);
}

/** Pyth's MON/USD price on Monad, for showing a MON cost in dollars. */
export function useMonPrice(): number | undefined {
  const q = useReadContract({ address: pythAddress, abi: pythAbi, functionName: "getPriceUnsafe", args: [MON_USD_FEED], chainId, query: { refetchInterval: 60_000 } });
  if (!q.data) return undefined;
  const p = q.data as { price: bigint; expo: number };
  const v = Number(p.price) * 10 ** Number(p.expo);
  return v > 0 ? v : undefined;
}

const REPRICED_TOPIC = encodeEventTopics({ abi: repricerAbi, eventName: "Repriced" })[0] as Hex;

/**
 * Gas and MON per reprice from the receipts of the latest keeper reprice transactions (sent to the Repricer; reprices
 * inside an exit or an opt-out are left out). Receipts never change, so each is fetched once.
 */
export function useRepriceCost(txHashes: string[], sample: number) {
  const client = usePublicClient({ chainId });
  const key = txHashes.join(",");
  const q = useQuery({
    queryKey: ["reprice-receipts", key, sample],
    enabled: Boolean(client && shield.repricer && txHashes.length),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const receipts = await Promise.all(txHashes.map((hash) => client!.getTransactionReceipt({ hash: hash as Hex }).catch(() => null)));
      const repricer = shield.repricer!.toLowerCase();
      const rows: RepriceReceipt[] = [];
      for (const r of receipts) {
        if (!r || r.status !== "success" || r.to?.toLowerCase() !== repricer) continue;
        const reprices = r.logs.filter((l) => l.address.toLowerCase() === repricer && l.topics[0] === REPRICED_TOPIC).length;
        rows.push({ gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice, reprices });
      }
      return rows.slice(0, sample);
    },
  });
  return { cost: q.data ? repriceCost(q.data) : undefined, isLoading: q.isPending && Boolean(txHashes.length), error: q.error };
}
