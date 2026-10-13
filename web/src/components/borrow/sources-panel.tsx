"use client";

import { zeroHash } from "viem";
import { useReadContract } from "wagmi";
import { HashLink } from "@/components/data/hash-link";
import { Panel } from "@/components/data/stat";
import { TokenIcon } from "@/components/data/token";
import type { ReserveLine } from "@/hooks/useAavePosition";
import { useNow, useOnBlock } from "@/hooks/useLiveBlock";
import { assetConfigOf, type ShieldConfig } from "@/hooks/useShieldConfig";
import { pythAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { aave, collateralName, pythAddress, shield } from "@/lib/env";
import { formatDuration, formatUsd, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Where the page's numbers come from, and the contracts that act on the position, each one link away. The Pyth feed,
 * the price-gap bound and the price-age bound are the ones the Executor reads, so this panel shows exactly what an exit
 * would check.
 */
export function SourcesPanel({ collateral, config }: { collateral?: ReserveLine; config?: ShieldConfig }) {
  const feed = assetConfigOf(config, collateral?.asset)?.pythFeedId;
  const enabled = Boolean(collateral && feed && feed !== zeroHash);
  const pyth = useReadContract({
    address: pythAddress,
    abi: pythAbi,
    functionName: "getPriceUnsafe",
    args: [feed ?? zeroHash],
    chainId: monadMainnet.id,
    query: { enabled },
  });
  useOnBlock(() => {
    if (enabled) void pyth.refetch({ cancelRefetch: false });
  });
  const now = useNow(1000) / 1000;
  const name = collateralName(collateral?.asset);
  const p = enabled ? pyth.data : undefined;
  const pythPrice = p ? Number(p.price) * 10 ** p.expo : undefined;
  const age = p ? now - Number(p.publishTime) : undefined;
  const maxAge = config?.exitMaxPriceAge ?? 3600;
  const tooOld = age !== undefined && age > maxAge;
  const maxGapBps = config?.maxOracleDeviationBps ?? 200;
  const gap = pythPrice && collateral ? Math.abs(collateral.priceUsd - pythPrice) / pythPrice : undefined;
  const tooFar = gap !== undefined && gap * 10_000 > maxGapBps;
  const confTooWide = p ? Number(p.conf) * 10_000 > Number(p.price) * maxGapBps : false;

  const contracts = [
    { name: "Aave V3 Pool", address: aave.pool },
    { name: "Shield Executor", address: shield.executor },
    { name: "Shield PositionRegistry", address: shield.registry },
    { name: "Shield Repricer", address: shield.repricer },
    { name: "Shield vault", address: shield.vault },
    { name: "Shield ForwarderFactory", address: shield.forwarders },
  ].filter((c) => c.address);

  return (
    <Panel title="Sources and contracts" description="What this page reads, and what can act on your position" labelledBy="sources-heading">
      {enabled && collateral && (
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Aave oracle, {name.priceName}</dt>
            <dd className="mt-1 font-semibold num">{formatUsd(collateral.priceUsd)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
              <TokenIcon symbol="PYTH" size={14} />
              Pyth, {name.priceName}
            </dt>
            <dd className="mt-1 font-semibold num">{pythPrice ? formatUsd(pythPrice) : "..."}</dd>
            {p && (
              <dd className={cn("text-[0.8125rem]", tooOld ? "text-danger" : "text-muted-foreground")}>
                Updated {timeAgo(Number(p.publishTime), now)}
                {tooOld && `, older than the ${formatDuration(maxAge)} an exit accepts`}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Gap between them</dt>
            <dd className={cn("mt-1 font-semibold num", gap !== undefined && (tooFar ? "text-danger" : "text-safe"))}>{gap !== undefined ? `${(gap * 100).toFixed(2)}%` : "..."}</dd>
            <dd className={cn("text-[0.8125rem]", confTooWide ? "text-danger" : "text-muted-foreground")}>
              {confTooWide ? "Pyth's confidence band is wider than an exit accepts" : `An exit needs ${(maxGapBps / 100).toFixed(2)}% or less`}
            </dd>
          </div>
        </dl>
      )}
      <ul className={cn("grid gap-x-6 text-sm sm:grid-cols-2", enabled && "mt-5 border-t pt-4")}>
        {contracts.map((c) => (
          <li key={c.name} className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
            <span className="min-w-0 text-muted-foreground">{c.name}</span>
            <HashLink value={c.address!} kind="address" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
