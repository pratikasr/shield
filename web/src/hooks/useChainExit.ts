"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { executorAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { shield } from "@/lib/env";
import type { Cover } from "./useShieldPosition";

export interface ChainExit {
  txHash: string;
  blockNumber: bigint;
  collateral: string;
  repaid: bigint;
  seized: bigint;
  savedVsAave: bigint;
  healthFactorBefore: bigint;
  healthFactorAfter: bigint;
  flashLoanAmount: bigint;
}

/**
 * The borrower's latest exit read straight from the chain, so the page can say "penalty avoided" even before the
 * indexer has it. An exit's final accrual stamps the record, so its last-repriced block is the exit block: a
 * one-block log query.
 */
export function useChainExit(borrower: Address | undefined, cover: Cover | undefined) {
  const client = usePublicClient({ chainId: monadMainnet.id });
  const block = cover?.exited && !cover.active ? cover.lastRepricedBlock : undefined;
  return useQuery({
    queryKey: ["chain-exit", borrower, block?.toString()],
    enabled: Boolean(client && borrower && block !== undefined && shield.executor),
    staleTime: Infinity,
    queryFn: async (): Promise<ChainExit | null> => {
      const logs = await client!.getContractEvents({
        address: shield.executor!,
        abi: executorAbi,
        eventName: "Exited",
        args: { borrower: borrower! },
        fromBlock: block!,
        toBlock: block!,
      });
      const last = logs.at(-1);
      if (!last) return null;
      const a = last.args as {
        collateral: Address;
        repaid: bigint;
        seized: bigint;
        savedVsAave: bigint;
        healthFactorBefore: bigint;
        healthFactorAfter: bigint;
        flashLoanAmount: bigint;
      };
      return {
        txHash: last.transactionHash,
        blockNumber: last.blockNumber,
        collateral: a.collateral,
        repaid: a.repaid,
        seized: a.seized,
        savedVsAave: a.savedVsAave,
        healthFactorBefore: a.healthFactorBefore,
        healthFactorAfter: a.healthFactorAfter,
        flashLoanAmount: a.flashLoanAmount,
      };
    },
  });
}
