"use client";

import { parseAbi } from "viem";
import { useReadContract } from "wagmi";
import { HashLink } from "@/components/data/hash-link";
import { Panel } from "@/components/data/stat";
import { TokenIcon } from "@/components/data/token";
import type { ReserveLine } from "@/hooks/useAavePosition";
import { useOnBlock } from "@/hooks/useLiveBlock";
import { monadMainnet } from "@/lib/chains";
import { aave, shield } from "@/lib/env";
import { formatUsd, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Pyth on Monad mainnet and its ETH/USD feed, verified 5 Oct 2026 (docs/TECH-DECISIONS.md). */
const PYTH = "0x2880aB155794e7179c9eE2e38200202908C17B43" as const;
const ETH_USD = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" as const;
const pythAbi = parseAbi(["function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))"]);
/** The exit refuses a gap above this between Aave's oracle and Pyth (Executor default, 200 bps). */
const MAX_GAP = 0.02;

/** Where the page's numbers come from, and the contracts that act on the position, each one link away. */
export function SourcesPanel({ collateral }: { collateral?: ReserveLine }) {
  const pyth = useReadContract({ address: PYTH, abi: pythAbi, functionName: "getPriceUnsafe", args: [ETH_USD], chainId: monadMainnet.id, query: { enabled: collateral?.symbol === "WETH" } });
  useOnBlock(() => void pyth.refetch());
  const p = pyth.data;
  const pythPrice = p ? Number(p.price) * 10 ** p.expo : undefined;
  const gap = pythPrice && collateral ? Math.abs(collateral.priceUsd - pythPrice) / pythPrice : undefined;

  const contracts = [
    { name: "Aave V3 Pool", address: aave.pool },
    { name: "Shield Executor", address: shield.executor },
    { name: "Shield PositionRegistry", address: shield.registry },
    { name: "Shield Repricer", address: shield.repricer },
    { name: "Shield vault", address: shield.vault },
  ].filter((c) => c.address);

  return (
    <Panel title="Sources and contracts" description="What this page reads, and what can act on your position" labelledBy="sources-heading">
      {collateral?.symbol === "WETH" && (
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Aave oracle, ETH</dt>
            <dd className="mt-1 font-semibold num">{formatUsd(collateral.priceUsd)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
              <TokenIcon symbol="PYTH" size={14} />
              Pyth, ETH
            </dt>
            <dd className="mt-1 font-semibold num">{pythPrice ? formatUsd(pythPrice) : "..."}</dd>
            {p && <dd className="text-[0.8125rem] text-muted-foreground">Updated {timeAgo(Number(p.publishTime))}</dd>}
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Gap between them</dt>
            <dd className={cn("mt-1 font-semibold num", gap !== undefined && gap > MAX_GAP ? "text-danger" : "text-safe")}>
              {gap !== undefined ? `${(gap * 100).toFixed(2)}%` : "..."}
            </dd>
            <dd className="text-[0.8125rem] text-muted-foreground">An exit needs 2.00% or less</dd>
          </div>
        </dl>
      )}
      <ul className={cn("grid gap-x-6 text-sm sm:grid-cols-2", collateral?.symbol === "WETH" && "mt-5 border-t pt-4")}>
        {contracts.map((c) => (
          <li key={c.name} className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
            <span className="text-muted-foreground">{c.name}</span>
            <HashLink value={c.address!} kind="address" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
