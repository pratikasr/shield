"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { monadMainnet } from "@/lib/chains";

/** Blocks actions while the wallet is on another chain and offers the one-click fix. */
export function useWrongNetwork() {
  const { isConnected, chainId } = useAccount();
  return isConnected && chainId !== monadMainnet.id;
}

export function NetworkGuard() {
  const wrong = useWrongNetwork();
  const { chain } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  if (!wrong) return null;
  return (
    <div role="alert" className="border-b border-danger/40 bg-danger-soft">
      <div className="mx-auto flex max-w-[76rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <p className="text-sm">
          Your wallet is on {chain?.name ?? "another network"}. Shield runs on Monad; switch to see your position and act on it.
          {error && <span className="block text-danger">{error.message.split("\n")[0]}</span>}
        </p>
        <Button size="sm" onClick={() => switchChain({ chainId: monadMainnet.id })} disabled={isPending}>
          {isPending ? "Switching" : "Switch to Monad"}
        </Button>
      </div>
    </div>
  );
}

/** The one-click fix as a primary action: "Switch to Monad to <action>". */
export function SwitchButton({ action, className, size = "lg" }: { action: string; className?: string; size?: "default" | "lg" }) {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <Button size={size} className={className} onClick={() => switchChain({ chainId: monadMainnet.id })} disabled={isPending}>
      {isPending ? "Switching to Monad" : `Switch to Monad to ${action}`}
    </Button>
  );
}
