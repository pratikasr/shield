"use client";

import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { chainId } from "@/components/borrow/cover-shared";
import { erc20Abi } from "@/lib/abis";
import { explorerUrl, shield } from "@/lib/env";
import { truncateHex } from "@/lib/format";

/** Where to see and revoke this wallet's approvals on Monad. */
export function revokeUrl(owner: Address) {
  return `https://revoke.cash/address/${owner}?chainId=${chainId}`;
}

/**
 * What the wallet will show for the collateral approval, said plainly: unlimited, which token (its symbol read from
 * the chain), which contract (linked), what it is used for, not audited, and how to revoke it.
 */
export function ApprovalNote({ owner, aToken, asset, underlying, feePct }: { owner: Address; aToken: Address; asset: string; underlying: string; feePct: number }) {
  const sym = useReadContract({ address: aToken, abi: erc20Abi, functionName: "symbol", chainId, query: { staleTime: Infinity } });
  // Aave's aToken symbol as the wallet will show it; "a" plus the underlying symbol until it is read.
  const symbol = (sym.data as string | undefined) ?? `a${underlying}`;
  return (
    <p className="m-0 rounded-xl border-2 border-ink/30 bg-sky-2 px-3.5 py-3 text-[15px] leading-[1.5]">
      Your wallet will ask to approve <b>unlimited {symbol}</b> (your {asset} on Aave) for Shield&rsquo;s Executor,{" "}
      <a className="c-link num" href={`${explorerUrl}/address/${shield.executor}`} target="_blank" rel="noreferrer">
        {truncateHex(shield.executor ?? "")}
        <span className="sr-only"> (opens the explorer)</span>
      </a>
      . The contract only uses it in a rescue, for the repaid amount plus the rescue fee ({feePct}% today). Shield is not audited yet. You can revoke it any time at{" "}
      <a className="c-link" href={revokeUrl(owner)} target="_blank" rel="noreferrer">
        revoke.cash
      </a>
      .
    </p>
  );
}
