"use client";

import { ShieldCheck, ShieldOff, ShieldAlert } from "lucide-react";
import { useRef } from "react";
import { Info } from "@/components/data/info";
import { Sparkline } from "@/components/data/sparkline";
import { Panel, Stat } from "@/components/data/stat";
import { TokenIcon, TokenPair } from "@/components/data/token";
import { RiskRail, hfTone } from "@/components/risk/risk-rail";
import { Skeleton } from "@/components/ui/skeleton";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import type { Cover } from "@/hooks/useShieldPosition";
import { BLOCKS_PER_DAY, EXIT_BUFFER, aavePenaltyUsd, formatRunway, runwayDays, shieldExitUsd } from "@/lib/economics";
import { formatHf, formatPct, formatToken, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The collateral reserve a cover seizes: the cover's own, else the largest covered one the wallet supplies. */
export function pickCollateral(position: AavePosition, cover?: Cover): ReserveLine | undefined {
  const covered = position.reserves.filter((r) => r.supplied > 0 && (r.symbol === "WETH" || r.symbol === "cbBTC"));
  if (cover?.collateral) {
    const own = position.reserves.find((r) => r.asset.toLowerCase() === cover.collateral!.toLowerCase());
    if (own) return own;
  }
  return covered.sort((a, b) => b.suppliedUsd - a.suppliedUsd)[0];
}

/** The collateral price at which the health factor reaches `hf`, holding the debt and other collateral still. */
export function priceAtHf(position: AavePosition, collateral: ReserveLine, hf: number): number {
  if (!Number.isFinite(position.healthFactor) || collateral.supplied <= 0) return Number.NaN;
  return collateral.priceUsd - ((position.healthFactor - hf) * position.debtUsd) / (collateral.supplied * collateral.liquidationThreshold);
}

function change(from: number, to: number) {
  if (!Number.isFinite(to) || from <= 0) return "";
  const p = (to - from) / from;
  return `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(1)}%`;
}

/** The page header: which market, and the four numbers a borrower checks first. */
export function PositionHeader({ position, title, cover }: { position: AavePosition; title: string; cover?: Cover }) {
  const hf = position.healthFactor;
  const status = !cover?.active
    ? { icon: ShieldOff, text: cover?.exited ? "Exited" : "Not protected", cls: "text-muted-foreground" }
    : cover.lapsed || cover.exitStatus === "AllowanceTooLow"
      ? { icon: ShieldAlert, text: "Unprotected", cls: "text-caution" }
      : { icon: ShieldCheck, text: `Protected at ${cover.trigger.toFixed(2)}`, cls: "text-safe" };
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
          <TokenPair a="AAVE" b="MON" size={18} />
          Aave V3, Monad market
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className={cn("mt-1 inline-flex items-center gap-1.5 text-sm font-medium", status.cls)}>
          <status.icon className="size-4" aria-hidden />
          {status.text}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 lg:flex lg:gap-x-10">
        <Stat label="Net worth" value={formatUsd(position.collateralUsd - position.debtUsd)} />
        <Stat label="Collateral" value={formatUsd(position.collateralUsd)} />
        <Stat label="Debt" value={formatUsd(position.debtUsd)} />
        <Stat label="Health factor" value={formatHf(hf)} tone={hfTone(hf)} />
      </dl>
    </div>
  );
}

function CostCompare({ penalty, shieldCost, repayUsd, trigger, bonus }: { penalty: number; shieldCost: number; repayUsd: number; trigger: number; bonus: number }) {
  const max = Math.max(penalty, shieldCost, 1e-9);
  return (
    <div className="rounded-lg bg-raised p-4 sm:p-5">
      <p className="text-[0.9375rem]">
        Aave penalty if liquidated: <strong className="font-semibold text-danger num">{formatUsd(penalty)}</strong>. Shield:{" "}
        <strong className="font-semibold text-safe num">{formatUsd(shieldCost)}</strong>
        <span className="text-muted-foreground">.</span>
        <Info>
          Aave: a liquidation just below 1.00 repays half your debt (all of it under $2,000) and pays the liquidator a{" "}
          {(bonus * 100).toFixed(1)}% bonus from your collateral. Shield: the exit at {trigger.toFixed(2)} repays about {formatUsd(repayUsd)} to
          bring the health factor back to {(trigger + EXIT_BUFFER).toFixed(2)}, and the vault takes 1% on that amount. The premium is separate.
        </Info>
      </p>
      <div className="mt-4 grid gap-3 text-[0.8125rem]">
        <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr]">
          <span className="text-muted-foreground">Aave liquidation</span>
          <span className="h-2.5 rounded-full bg-danger/80" style={{ width: `${Math.max((penalty / max) * 100, 2)}%` }} aria-hidden />
        </div>
        <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr]">
          <span className="text-muted-foreground">Shield exit at {trigger.toFixed(2)}</span>
          <span className="h-2.5 rounded-full bg-safe" style={{ width: `${Math.max((shieldCost / max) * 100, 2)}%` }} aria-hidden />
        </div>
      </div>
      {penalty > shieldCost && (
        <p className="mt-4 text-sm">
          You keep <span className="font-semibold text-safe num">{formatUsd(penalty - shieldCost)}</span> more of your collateral if the exit runs first.
        </p>
      )}
    </div>
  );
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
  const liqPrice = collateral ? priceAtHf(position, collateral, 1) : Number.NaN;
  const trigPrice = collateral && trigger ? priceAtHf(position, collateral, trigger) : Number.NaN;

  return (
    <Panel
      title="Liquidation risk"
      labelledBy="risk-heading"
      description={collateral ? `How far ${collateral.symbol} can fall before Aave liquidates, and where Shield steps in` : undefined}
    >
      <RiskRail
        healthFactor={hf}
        trigger={trigger}
        exitTarget={trigger ? trigger + EXIT_BUFFER : undefined}
        trail={trail.current}
        armed={active && !cover?.lapsed}
      />

      {collateral && (
        <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-3">
          <Stat
            size="sm"
            label={
              <>
                <TokenIcon symbol={collateral.symbol} size={14} /> {collateral.symbol} now
              </>
            }
            value={formatUsd(collateral.priceUsd)}
            hint="Aave oracle price"
          />
          <Stat size="sm" label="Liquidation price" value={Number.isFinite(liqPrice) && liqPrice > 0 ? formatUsd(liqPrice) : "n/a"} hint={`${change(collateral.priceUsd, liqPrice)} from now`} tone="danger" />
          <Stat
            size="sm"
            label={trigger ? (active ? "Exit price" : "Exit price at this trigger") : "Exit price"}
            value={trigger && Number.isFinite(trigPrice) && trigPrice > 0 ? formatUsd(trigPrice) : "No trigger"}
            hint={trigger ? `${change(collateral.priceUsd, trigPrice)} from now, health factor ${trigger.toFixed(2)}` : "Set one to see it"}
            tone={trigger ? "caution" : undefined}
          />
        </dl>
      )}

      {collateral && shieldCost && penalty > 0 && trigger && (
        <div className="mt-6">
          <CostCompare penalty={penalty} shieldCost={shieldCost.costUsd} repayUsd={shieldCost.repayUsd} trigger={trigger} bonus={collateral.liquidationBonus - 1} />
        </div>
      )}

      {active && cover && (
        <div className="mt-6 grid gap-x-6 gap-y-5 border-t pt-5 sm:grid-cols-3">
          <div>
            <p className="flex items-center gap-1 text-[0.8125rem] text-muted-foreground">
              Cover rate
              <Info>
                k x volatility x debt / max(HF - trigger, 0.01), for one 300 ms block. k is 0.00125, so a position 0.05 above its
                trigger at 80% volatility pays 2% of its debt a year. The keeper reprices every block.
              </Info>
            </p>
            <p className="reading mt-1 text-[1.25rem] font-semibold">
              {cover.lapsed ? "Paused" : formatUsd(cover.livePremiumPerBlockUsd * BLOCKS_PER_DAY * 365)}
              {!cover.lapsed && <span className="text-sm font-normal text-muted-foreground"> a year</span>}
            </p>
            <Sparkline values={[...premiumHistory, cover.livePremiumPerBlockUsd]} className="mt-1.5 h-6 w-full max-w-40 text-brand" />
            <p className="mt-1 text-[0.8125rem] text-muted-foreground" aria-live="off">
              Cover this block: <span className="num">{cover.lapsed ? "paused" : formatUsd(cover.livePremiumPerBlockUsd)}</span>
            </p>
          </div>
          <dl className="contents">
            <Stat
              label="Prepaid balance"
              value={formatUsd(prepaidLive)}
              tone={cover.lapsed ? "caution" : undefined}
              hint={cover.lapsed ? "Used up: top up to re-arm" : `Lasts ${formatRunway(runwayDays(prepaidLive, cover.livePremiumPerBlockUsd))}`}
            />
            <Stat label="Premium paid so far" value={formatUsd(accruedLive)} hint={`Volatility ${formatPct(cover.sigma, 0)} a year, from Pyth`} />
          </dl>
        </div>
      )}
    </Panel>
  );
}

export function ReservesTable({ position }: { position: AavePosition }) {
  return (
    <Panel title="Your assets on Aave" labelledBy="reserves-heading" bodyClassName="px-0 pb-2 sm:px-0 sm:pb-2">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead>
            <tr className="border-b text-[0.75rem] text-muted-foreground">
              <th scope="col" className="px-5 pb-2.5 font-medium sm:px-6">Asset</th>
              <th scope="col" className="px-3 pb-2.5 text-right font-medium">Supplied</th>
              <th scope="col" className="px-3 pb-2.5 text-right font-medium">Borrowed</th>
              <th scope="col" className="px-5 pb-2.5 text-right font-medium sm:px-6">Liquidation threshold</th>
            </tr>
          </thead>
          <tbody className="num">
            {position.reserves.map((r) => (
              <tr key={r.asset} className="border-b last:border-b-0">
                <th scope="row" className="px-5 py-3.5 font-medium sm:px-6">
                  <span className="flex items-center gap-3">
                    <TokenIcon symbol={r.symbol} size={28} />
                    {r.symbol}
                  </span>
                </th>
                <td className="px-3 py-3.5 text-right">
                  {r.supplied > 0 ? (
                    <>
                      <span className="block">{formatToken(r.supplied)}</span>
                      <span className="block text-[0.8125rem] text-muted-foreground">{formatUsd(r.suppliedUsd)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground" aria-label="None">-</span>
                  )}
                </td>
                <td className="px-3 py-3.5 text-right">
                  {r.borrowed > 0 ? (
                    <>
                      <span className="block">{formatToken(r.borrowed)}</span>
                      <span className="block text-[0.8125rem] text-muted-foreground">{formatUsd(r.borrowedUsd)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground" aria-label="None">-</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right sm:px-6">
                  {r.supplied > 0 ? formatPct(r.liquidationThreshold, 1) : <span className="text-muted-foreground" aria-label="Not collateral">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function PositionSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading your Aave position">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-56" />
        </div>
        <div className="flex gap-10">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="panel p-6">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-10 h-3 w-full" />
          <Skeleton className="mt-8 h-16 w-full" />
        </div>
        <Skeleton className="h-[28rem] w-full rounded-[14px]" />
      </div>
    </div>
  );
}
