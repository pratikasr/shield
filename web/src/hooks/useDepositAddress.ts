"use client";

import type { Abi, Address } from "viem";
import { useReadContract } from "wagmi";
import { usePageVisible } from "@/hooks/useLiveBlock";
import { erc20Abi, repricerAbi, shieldForwarderFactoryAbi, shieldVaultAbi } from "@/lib/abis";
import type { FundingKind } from "@/lib/aurora";
import { appChain } from "@/lib/chains";
import { aave, shield } from "@/lib/env";

const chainId = appChain.id;
/** How often the USDC waiting at a deposit address is read: often enough to see a delivery land, without a read per block. */
const BALANCE_POLL_MS = 1_500;

/**
 * A Shield deposit address on Monad (ShieldForwarderFactory, ADR-039) and the USDC waiting there. "premium" is the
 * borrower's own address, swept into their prepaid premium; "vault" is the treasury's, swept into the vault. The
 * address is a CREATE2 address, known before anything is deployed there.
 */
export function useDepositAddress(kind: FundingKind, owner?: Address) {
  const factory = shield.forwarders;
  const visible = usePageVisible();
  const addr = useReadContract({
    address: factory,
    abi: shieldForwarderFactoryAbi,
    functionName: kind === "premium" ? "forwarderFor" : "treasuryForwarder",
    args: kind === "premium" ? [owner!] : [],
    chainId,
    query: { enabled: Boolean(factory) && (kind === "vault" || Boolean(owner)), staleTime: Number.POSITIVE_INFINITY },
  });
  const address = addr.data as Address | undefined;
  const bal = useReadContract({
    address: aave.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address!],
    chainId,
    query: { enabled: Boolean(address), refetchInterval: visible ? BALANCE_POLL_MS : false },
  });
  return {
    /** Undefined until read, and on a build without the forwarder factory. */
    address,
    /** USDC (6-decimal units) waiting to be swept. */
    waitingUnits: bal.data as bigint | undefined,
    error: addr.error ?? bal.error,
    refetch: bal.refetch,
  };
}

/** The sweep that turns what waits at a deposit address into premium or vault assets. Anyone may send it. */
export function sweepRequest(kind: FundingKind, owner: Address) {
  // The sweep calls into the Repricer or the vault, so their errors are added for decoding a revert.
  const errors = [...repricerAbi, ...shieldVaultAbi].filter((x) => x.type === "error");
  const abi = [...shieldForwarderFactoryAbi, ...errors] as unknown as Abi;
  return kind === "premium"
    ? { address: shield.forwarders!, abi, functionName: "sweepPremium", args: [owner] as const }
    : { address: shield.forwarders!, abi, functionName: "sweepVault", args: [] as const };
}
