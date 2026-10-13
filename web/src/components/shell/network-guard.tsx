"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { monadMainnet } from "@/lib/chains";

/** Blocks actions while the wallet is on another chain and offers the one-click fix. */
export function useWrongNetwork() {
  const { isConnected, chainId } = useAccount();
  return isConnected && chainId !== monadMainnet.id;
}

/** A Lava strip under the header while the wallet is on another chain, with one "Switch to Monad" button. */
export function NetworkGuard() {
  const wrong = useWrongNetwork();
  const { chain } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  if (!wrong) return null;
  return (
    <div role="alert" className="border-b-[2.5px] border-ink bg-lava-tint">
      <div className="c-wrap flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="m-0 font-semibold">
          Your wallet is on {chain?.name ?? "another network"}. Shield runs on Monad: switch to act on your loan. Live numbers keep showing.
          {error && <span className="mt-1 block font-normal text-danger">{error.message.split("\n")[0]}</span>}
        </p>
        <Button size="small" onClick={() => switchChain({ chainId: monadMainnet.id })} loading={isPending} loadingText="Switching">
          Switch to Monad
        </Button>
      </div>
    </div>
  );
}

/** The one-click fix as a primary action: "Switch to Monad to <action>". */
export function SwitchButton({ action, className, size = "lg" }: { action: string; className?: string; size?: "default" | "lg" | "big" }) {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <Button size={size === "big" ? "big" : "default"} className={className} onClick={() => switchChain({ chainId: monadMainnet.id })} loading={isPending} loadingText="Switching to Monad">
      {`Switch to Monad to ${action}`}
    </Button>
  );
}
