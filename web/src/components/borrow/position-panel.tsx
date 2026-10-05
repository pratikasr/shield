"use client";

import { useRef } from "react";
import { Info } from "@/components/data/info";
import { Sparkline } from "@/components/data/sparkline";
import { Stat } from "@/components/data/stat";
import { RiskRail, hfTone } from "@/components/risk/risk-rail";
import { Skeleton } from "@/components/ui/skeleton";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import type { Cover } from "@/hooks/useShieldPosition";
import { EXIT_BUFFER, aavePenaltyUsd, formatRunway, runwayDays, shieldExitUsd } from "@/lib/economics";
import { formatHf, formatPct, formatToken, formatUsd } from "@/lib/format";

/** The collateral reserve a cover seizes: the cover's own, else the largest covered one the wallet supplies. */
export function pickCollateral(position: AavePosition, cover?: Cover): ReserveLine | undefined {
  const covered = position.reserves.filter((r) => r.supplied > 0 && (r.symbol === "WETH" || r.symbol === "cbBTC"));
  if (cover?.collateral) {
    const own = position.reserves.find((r) => r.asset.toLowerCase() === cover.collateral!.toLowerCase());
    if (own) return own;
  }
  return covered.sort((a, b) => b.suppliedUsd - a.suppliedUsd)[0];
}

export function PositionPanel({
  position,
  cover,
  previewTrigger,
  premiumHistory,
}: {
  position: AavePosition;
  cover?: Cover;
  /** The trigger being chosen in the opt-in form, before it is on chain. */
  previewTrigger?: number;
  /** Recent per-block premiums from the indexer, oldest first, in USD. */
  premiumHistory: number[];
}) {
  const { data: block } = useLiveBlock();
  const trail = useRef<number[]>([]);
  const hf = position.healthFactor;
  if (Number.isFinite(hf) && trail.current.at(-1) !== hf) trail.current = [...trail.current, hf].slice(-30);

  const active = cover?.active ?? false;
  const trigger = active ? cover!.trigger : previewTrigger;
  const collateral = pickCollateral(position, cover);
  const tone = hfTone(hf);
  const usdcDebt = position.reserves.find((r) => r.symbol === "USDC")?.borrowedUsd ?? 0;

  // Premium accrued since the last reprice keeps counting up block by block between keeper transactions.
  const sinceReprice = active && block && cover ? Number(block - cover.lastRepricedBlock) : 0;
  const accruedLive = active && cover && !cover.lapsed ? cover.premiumPaidUsd + cover.premiumPerBlockUsd * Math.max(sinceReprice, 0) : cover?.premiumPaidUsd ?? 0;
  const prepaidLive = active && cover && !cover.lapsed ? Math.max(cover.prepaidUsd - cover.premiumPerBlockUsd * Math.max(sinceReprice, 0), 0) : cover?.prepaidUsd ?? 0;

  const penalty = collateral ? aavePenaltyUsd(position.debtUsd, position.collateralUsd, collateral.liquidationBonus) : 0;
  const shieldCost =
    collateral && trigger
      ? shieldExitUsd({ debtUsd: usdcDebt, trigger, liquidationThreshold: collateral.liquidationThreshold, discountBps: 100 })
      : undefined;

  return (
    <section aria-labelledby="position-heading" className="rounded-xl border bg-card">
      <div className="p-5 sm:p-7">
        <h2 id="position-heading" className="sr-only">
          Your Aave position
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat
            className="col-span-2 sm:col-span-1"
            size="lg"
            label="Health factor"
            value={formatHf(hf)}
            tone={tone}
            hint={trigger ? `Trigger ${trigger.toFixed(2)}${active ? "" : ", not set yet"}` : "Aave liquidates at 1.00"}
          />
          <Stat label="Collateral" value={formatUsd(position.collateralUsd)} hint={collateral ? formatToken(collateral.supplied, collateral.symbol) : undefined} />
          <Stat label="Debt" value={formatUsd(position.debtUsd)} hint={usdcDebt > 0 ? `${formatUsd(usdcDebt)} in USDC` : "No USDC debt"} />
          <Stat
            label="Liquidation threshold"
            value={formatPct(position.liquidationThreshold, 1)}
            hint={collateral ? `Bonus to a liquidator ${formatPct(collateral.liquidationBonus - 1, 1)}` : undefined}
          />
        </dl>

        <RiskRail
          className="mt-10"
          healthFactor={hf}
          trigger={trigger}
          exitTarget={trigger ? trigger + EXIT_BUFFER : undefined}
          trail={trail.current}
          armed={active && !cover?.lapsed}
        />

        {shieldCost && penalty > 0 && (
          <p className="mt-8 text-base">
            Aave penalty if liquidated: <strong className="reading font-semibold text-danger">{formatUsd(penalty)}</strong>. Shield:{" "}
            <strong className="reading font-semibold text-safe">{formatUsd(shieldCost.costUsd)}</strong>
            <span className="text-muted-foreground">
              {" "}
              (1% of the {formatUsd(shieldCost.repayUsd)} an exit at {trigger!.toFixed(2)} repays, plus the premium)
            </span>
            <Info>
              Aave: a liquidation just below 1.00 repays half your debt (all of it under $2,000) and pays the liquidator a{" "}
              {collateral ? ((collateral.liquidationBonus - 1) * 100).toFixed(1) : "5.5"}% bonus from your collateral. Shield: the exit
              repays enough to bring HF back to trigger + 0.06 and takes 1% on that amount.
            </Info>
          </p>
        )}
      </div>

      {active && cover && (
        <div className="grid gap-x-6 gap-y-5 border-t p-5 sm:grid-cols-3 sm:p-7">
          <div>
            <p className="flex items-center text-[0.8125rem] text-muted-foreground">
              Cover this block
              <Info>
                k x volatility x debt / max(HF - trigger, 0.01), for one 300 ms block. k is 0.00125, so a position 0.05 above its
                trigger at 80% volatility pays 2% of its debt a year. The keeper reprices every block.
              </Info>
            </p>
            <p className="reading mt-0.5 flex items-center gap-3 text-xl font-semibold" aria-live="off">
              {cover.lapsed ? "Paused" : formatUsd(cover.livePremiumPerBlockUsd)}
              <Sparkline values={[...premiumHistory, cover.livePremiumPerBlockUsd]} />
            </p>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">{formatUsd(cover.annualPremiumUsd)} a year at this rate</p>
          </div>
          <Stat
            label="Prepaid balance"
            value={formatUsd(prepaidLive)}
            tone={cover.lapsed ? "caution" : undefined}
            hint={cover.lapsed ? "Used up: top up to re-arm" : `Lasts ${formatRunway(runwayDays(prepaidLive, cover.livePremiumPerBlockUsd))}`}
          />
          <Stat label="Premium paid so far" value={formatUsd(accruedLive)} hint={`Volatility ${formatPct(cover.sigma, 0)} a year, from Pyth`} />
        </div>
      )}
    </section>
  );
}

export function ReservesTable({ position }: { position: AavePosition }) {
  return (
    <section aria-labelledby="reserves-heading" className="rounded-xl border bg-card">
      <h2 id="reserves-heading" className="px-5 pt-5 text-base font-semibold sm:px-7">
        Aave reserves on this wallet
      </h2>
      <div className="overflow-x-auto px-2 pb-3 sm:px-4">
        <table className="mt-3 w-full min-w-[30rem] text-left text-sm">
          <thead>
            <tr className="text-[0.8125rem] text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-normal">Asset</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Supplied</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Borrowed</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Value</th>
            </tr>
          </thead>
          <tbody className="num">
            {position.reserves.map((r) => (
              <tr key={r.asset} className="border-t">
                <th scope="row" className="px-3 py-2.5 font-medium">{r.symbol}</th>
                <td className="px-3 py-2.5 text-right">{r.supplied > 0 ? formatToken(r.supplied) : "None"}</td>
                <td className="px-3 py-2.5 text-right">{r.borrowed > 0 ? formatToken(r.borrowed) : "None"}</td>
                <td className="px-3 py-2.5 text-right">{formatUsd(r.suppliedUsd - r.borrowedUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PositionSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5 sm:p-7" aria-busy="true" aria-label="Loading your Aave position">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-10 h-14 w-full" />
    </div>
  );
}
