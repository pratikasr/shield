"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Disclosure, NerdGrid } from "@/components/cartoon/disclosure";
import { usePythPrice } from "@/components/borrow/cover-shared";
import { HashLink } from "@/components/data/hash-link";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import { useNow } from "@/hooks/useLiveBlock";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import { aave, collateralName, shield } from "@/lib/env";
import { formatDuration, formatHf, formatPct, formatToken, formatUsd, timeAgo } from "@/lib/format";

/** Open state of the <details> inside `ref`, so the Pyth price is read only while someone looks at it. */
function useDetailsOpen(ref: React.RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = ref.current?.querySelector("details");
    if (!d) return;
    const on = () => setOpen(d.open);
    d.addEventListener("toggle", on);
    return () => d.removeEventListener("toggle", on);
  }, [ref]);
  return open;
}

/**
 * "Stats for nerds": the numbers behind the picture. Health factor, Aave's threshold and bonus, Aave's price against
 * Pyth's (the gap an exit checks), the trigger and where an exit takes the loan, the premium, and every contract that
 * can act on the position, each one link away.
 */
export function StatsForNerds({
  position,
  collateral,
  config,
  trigger,
  extra = [],
}: {
  position: AavePosition;
  collateral?: ReserveLine;
  config?: ShieldConfig;
  /** Shield's line as a health factor: the cover's, or the one being picked. */
  trigger?: number;
  extra?: (readonly [ReactNode, ReactNode])[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const open = useDetailsOpen(box);
  const pyth = usePythPrice(config, collateral?.asset, open);
  const now = useNow(1000) / 1000;
  const name = collateralName(collateral?.asset);
  const maxGapBps = config?.maxOracleDeviationBps ?? 200;
  const maxAge = config?.exitMaxPriceAge ?? 3600;
  const gap = pyth && collateral && pyth.price > 0 ? Math.abs(collateral.priceUsd - pyth.price) / pyth.price : undefined;
  const age = pyth ? now - pyth.publishTime : undefined;

  const rows: (readonly [ReactNode, ReactNode])[] = [
    ["Health factor", formatHf(position.healthFactor)],
    ["Aave liquidates at health factor", "1.00"],
  ];
  if (trigger !== undefined) {
    rows.push(["Shield steps in at health factor", trigger.toFixed(2)]);
    if (config) rows.push(["A rescue lifts it back to", (trigger + config.exitHfBuffer).toFixed(2)]);
  }
  if (collateral) {
    rows.push([`${name.priceName} price on Aave`, formatUsd(collateral.priceUsd)]);
    rows.push([
      `${name.priceName} price on Pyth`,
      !open ? "Open to read" : pyth ? `${formatUsd(pyth.price)}${gap !== undefined ? ` (${(gap * 100).toFixed(2)}% apart)` : ""}` : "Reading",
    ]);
    if (open && pyth && age !== undefined) {
      rows.push(["Pyth price updated", `${timeAgo(pyth.publishTime, now)}${age > maxAge ? `, older than the ${formatDuration(maxAge)} a rescue accepts` : ""}`]);
    }
    rows.push(["Prices must agree within", `${(maxGapBps / 100).toFixed(2)}%`]);
    rows.push(["Collateral", `${formatToken(collateral.supplied, collateral.symbol)} (${formatUsd(collateral.suppliedUsd)})`]);
    rows.push(["Aave liquidation threshold", formatPct(collateral.liquidationThreshold, 1)]);
    rows.push(["Aave liquidation bonus", formatPct(collateral.liquidationBonus - 1, 1)]);
  }
  if (position.usdc) rows.push(["Borrowed", `${formatToken(position.usdc.borrowed)} USDC`]);
  if (config) rows.push(["Rescue price", `${config.exitDiscountBps / 100}% of what it repays`]);
  rows.push(...extra);

  const contracts = [
    { name: "Aave V3 Pool", address: aave.pool },
    { name: "Shield Executor", address: shield.executor },
    { name: "Shield PositionRegistry", address: shield.registry },
    { name: "Shield Repricer", address: shield.repricer },
    { name: "Shield vault", address: shield.vault },
    { name: "Shield ForwarderFactory", address: shield.forwarders },
  ].filter((c) => c.address);
  for (const c of contracts) rows.push([c.name, <HashLink key={c.name} value={c.address!} kind="address" />]);

  return (
    <div ref={box}>
      <Disclosure note="Live from Aave, Pyth and Shield's contracts on Monad.">
        <NerdGrid rows={rows} />
      </Disclosure>
    </div>
  );
}
