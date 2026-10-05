"use client";

import { useCallback, useEffect, useState } from "react";
import { BaseError, type Hash } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

export type TxPhase = "idle" | "signing" | "pending" | "proposed" | "finalized" | "error";

export interface TxState {
  phase: TxPhase;
  hash?: Hash;
  block?: bigint;
  error?: string;
}

/** Turns wallet and RPC errors into one sentence that names the fix. */
export function explainError(err: unknown): string {
  const msg = err instanceof BaseError ? err.shortMessage : String((err as Error)?.message ?? err);
  if (/user rejected|denied/i.test(msg)) return "You rejected the request in your wallet. Try again when ready.";
  if (/insufficient funds/i.test(msg)) return "Not enough MON for gas. Add MON to this wallet and retry.";
  if (/exceeds balance|transfer amount exceeds/i.test(msg)) return "The amount is more than this wallet holds. Lower it and retry.";
  if (/allowance/i.test(msg)) return "The approval is missing or too low. Run the approval step again.";
  if (/TriggerOutOfRange/i.test(msg)) return "The trigger must be between 1.01 and 2.00.";
  if (/MaxDiscountOutOfRange/i.test(msg)) return "The maximum discount must be between 1% and 5%.";
  if (/AlreadyActive/i.test(msg)) return "This wallet already has active cover. Opt out first to change the collateral.";
  if (/chain|network/i.test(msg)) return "Your wallet is on another network. Switch to Monad and retry.";
  return msg.length > 160 ? `${msg.slice(0, 157)}...` : msg;
}

/**
 * Sends a contract write and follows it through Monad's two states: included in a proposed block (the receipt),
 * then finalised (the `finalized` tag reaches that block, about two blocks later).
 */
export function useTx() {
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const send = useCallback(
    async (args: Parameters<typeof writeContractAsync>[0]) => {
      setState({ phase: "signing" });
      try {
        const hash = await writeContractAsync(args);
        setState({ phase: "pending", hash });
        const receipt = await client!.waitForTransactionReceipt({ hash, pollingInterval: 200 });
        if (receipt.status !== "success") {
          setState({ phase: "error", hash, error: "The transaction reverted on chain. Open it in the explorer for the reason." });
          return undefined;
        }
        setState({ phase: "proposed", hash, block: receipt.blockNumber });
        return receipt;
      } catch (err) {
        setState((s) => ({ phase: "error", hash: s.hash, error: explainError(err) }));
        return undefined;
      }
    },
    [client, writeContractAsync],
  );

  useEffect(() => {
    if (state.phase !== "proposed" || !client || state.block === undefined) return;
    let stop = false;
    const tick = async () => {
      while (!stop) {
        try {
          const finalized = await client.getBlock({ blockTag: "finalized" });
          if (finalized.number >= state.block!) {
            setState((s) => (s.hash === state.hash ? { ...s, phase: "finalized" } : s));
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
  }, [state.phase, state.block, state.hash, client]);

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { state, send, reset };
}
