"use client";

import { useCallback, useEffect, useState } from "react";
import type { Abi, Address, EstimateContractGasParameters, Hash, SimulateContractParameters, TransactionReceipt } from "viem";
import { useAccount, useConfig, usePublicClient } from "wagmi";
import { writeContract, type WriteContractParameters } from "wagmi/actions";
import { externalErrorsAbi } from "@/lib/abis";
import { appChain } from "@/lib/chains";
import { explainError, type ErrorContext } from "@/lib/errors";

export { explainError } from "@/lib/errors";

const chainId = appChain.id;

export type TxPhase = "idle" | "checking" | "signing" | "pending" | "proposed" | "finalized" | "error";

export interface TxState {
  phase: TxPhase;
  /** What is being sent, as it starts a sentence: "Approval", "USDC approval", "Opt-in". */
  label: string;
  /** Increases with every send on the page, so a panel can show whichever of its transactions is newest. */
  seq: number;
  hash?: Hash;
  block?: bigint;
  error?: string;
}

export interface TxRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export interface SendOptions {
  /** Which out-of-gas sentence fits: a borrower's cover moves every block, the vault only on deposits and exits. */
  context?: "cover" | "vault";
  errorContext?: ErrorContext;
}

let sequence = 0;

/** Gas limit for a Monad transaction: Monad bills the limit, so it is measured, with headroom for a keeper reprice
 * that lands between the estimate and inclusion (QA saw withdrawUnused run out of gas without it). */
export function gasWithHeadroom(estimate: bigint): bigint {
  return (estimate * 125n) / 100n + 30_000n;
}

const OUT_OF_GAS = {
  cover: "Ran out of gas while the keeper was updating your cover. Retry.",
  vault: "Ran out of gas while the vault was updating. Retry.",
};

/**
 * Sends a contract write the safe way and follows it through Monad's two states. Before any wallet prompt it simulates
 * the call and estimates gas; a call that would revert shows its decoded reason and never reaches the wallet. Then:
 * included in a proposed block (the receipt), then finalised (the `finalized` tag reaches that block).
 */
export function useTx() {
  const client = usePublicClient({ chainId });
  const config = useConfig();
  const { address } = useAccount();
  const [state, setState] = useState<TxState>({ phase: "idle", label: "", seq: 0 });

  const send = useCallback(
    async (label: string, req: TxRequest, opts: SendOptions = {}): Promise<TransactionReceipt | undefined> => {
      const seq = ++sequence;
      const fail = (error: string, hash?: Hash) => setState({ phase: "error", label, seq, hash, error });
      setState({ phase: "checking", label, seq });
      if (!client || !address) {
        fail("Connect a wallet on Monad first.");
        return undefined;
      }
      const call = { address: req.address, abi: [...req.abi, ...externalErrorsAbi] as Abi, functionName: req.functionName, args: req.args, account: address };

      let gas: bigint;
      try {
        await client.simulateContract(call as unknown as SimulateContractParameters);
        gas = gasWithHeadroom(await client.estimateContractGas(call as unknown as EstimateContractGasParameters));
      } catch (err) {
        fail(explainError(err, opts.errorContext));
        return undefined;
      }

      setState({ phase: "signing", label, seq });
      let hash: Hash;
      try {
        hash = await writeContract(config, { address: req.address, abi: req.abi, functionName: req.functionName, args: req.args, chainId, gas } as unknown as WriteContractParameters);
      } catch (err) {
        fail(explainError(err, opts.errorContext));
        return undefined;
      }

      setState({ phase: "pending", label, seq, hash });
      let cancelled = false;
      try {
        const receipt = await client.waitForTransactionReceipt({
          hash,
          pollingInterval: 200,
          onReplaced: (r) => {
            if (r.reason === "cancelled") cancelled = true;
            else {
              hash = r.transaction.hash;
              setState((s) => (s.seq === seq ? { ...s, hash } : s));
            }
          },
        });
        if (cancelled) {
          fail("The transaction was cancelled in your wallet. Nothing changed.", receipt.transactionHash);
          return undefined;
        }
        if (receipt.status !== "success") {
          // Ask the chain again: a call that still fails says why; one that now passes reverted on gas or a state race.
          let reason: string | undefined;
          try {
            await client.simulateContract(call as unknown as SimulateContractParameters);
          } catch (err) {
            reason = explainError(err, opts.errorContext);
          }
          const usedAll = receipt.gasUsed >= gas;
          fail(
            reason ?? (usedAll ? OUT_OF_GAS[opts.context ?? "cover"] : "The transaction reverted because the state changed while it was pending. Retry."),
            receipt.transactionHash,
          );
          return undefined;
        }
        setState({ phase: "proposed", label, seq, hash: receipt.transactionHash, block: receipt.blockNumber });
        return receipt;
      } catch (err) {
        fail(explainError(err, opts.errorContext), hash);
        return undefined;
      }
    },
    [client, config, address],
  );

  useEffect(() => {
    if (state.phase !== "proposed" || !client || state.block === undefined) return;
    let stop = false;
    const target = state.block;
    const seq = state.seq;
    const tick = async () => {
      while (!stop) {
        try {
          const finalized = await client.getBlock({ blockTag: "finalized" });
          if (finalized.number >= target) {
            setState((s) => (s.seq === seq ? { ...s, phase: "finalized" } : s));
            return;
          }
        } catch {
          // keep trying; finality follows within a second on Monad
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [state.phase, state.block, state.seq, client]);

  const reset = useCallback(() => setState((s) => ({ phase: "idle", label: "", seq: s.seq })), []);
  const busy = state.phase === "checking" || state.phase === "signing" || state.phase === "pending";
  return { state, send, reset, busy };
}

export type TxHandle = ReturnType<typeof useTx>;
