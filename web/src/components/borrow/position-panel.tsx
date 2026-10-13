"use client";

import { Clock3, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { useRef } from "react";
import { Info } from "@/components/data/info";
import { Sparkline } from "@/components/data/sparkline";
import { Panel, Stat } from "@/components/data/stat";
import { TokenIcon, TokenPair } from "@/components/data/token";
import { ExitChance, PriceSimulator } from "@/components/risk/price-simulator";
import { RiskRail, hfTone } from "@/components/risk/risk-rail";
import { Skeleton } from "@/components/ui/skeleton";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import { assetConfigOf, type ShieldConfig } from "@/hooks/useShieldConfig";
import { useSigma } from "@/hooks/useSigma";
import type { Cover } from "@/hooks/useShieldPosition";
import { headerStatus, livePrepaid, type ArmState } from "@/lib/cover-status";
import { BLOCKS_PER_YEAR, aaveLiquidation, formatRunway, runwayDays, shieldExit, type AaveLiquidation, type ShieldExit } from "@/lib/economics";
import { formatHf, formatPct, formatToken, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Blocks without a reprice after which the panel says the keeper has fallen behind. */
export const KEEPER_LATE_BLOCKS = 20;

/**
 * The one collateral the page works with: the cover's own while it is active or after it exited (the registry's
 * collateral is read only when the record exists), else the largest supply the registry has enabled.
 */
export function pickCollateral(position: AavePosition, cover: Cover | undefined, config: ShieldConfig | undefined): ReserveLine | undefined {
  const own =
    cover?.exists && (cover.active || cover.exited) && cover.collateral
      ? position.allReserves.find((r) => r.asset.toLowerCase() === cover.collateral!.toLowerCase())
      : undefined;
  if (own && cover?.active) return own;
  const enabled = new Set((config?.assets ?? []).filter((a) => a.enabled).map((a) => a.asset.toLowerCase()));
  const supplies = position.reserves.filter((r) => r.suppliedRaw > 0n && enabled.has(r.asset.toLowerCase())).sort((a, b) => b.suppliedUsd - a.suppliedUsd);
  // After an exit, protecting again starts from the same collateral when it can still be covered.
  if (own && supplies.some((r) => r.asset === own.asset)) return own;
  return supplies[0] ?? own;
}

/** The collateral price at which the health factor reaches `hf`, holding the debt and other collateral still. */
export function priceAtHf(position: AavePosition, collateral: ReserveLine, hf: number): number {
  if (!Number.isFinite(position.healthFactor) || collateral.supplied <= 0 || position.debtUsd <= 0) return Number.NaN;
  return collateral.priceUsd - ((position.healthFactor - hf) * position.debtUsd) / (collateral.supplied * collateral.liquidationThreshold);
}

/** Aave's liquidation and Shield's exit for this position, on the definitions in lib/economics.ts. */
export function compareCosts(position: AavePosition, collateral: ReserveLine, trigger: number, config: Pick<ShieldConfig, "exitDiscountBps" | "exitHfBuffer">) {
  const liqPrice = priceAtHf(position, collateral, 1);
  const trigPrice = priceAtHf(position, collateral, trigger);
  const valueAt = (price: number) => (Number.isFinite(price) && price > 0 ? collateral.supplied * price : collateral.suppliedUsd);
  const aave = aaveLiquidation({
    totalDebtUsd: position.debtUsd,
    debtReserveUsd: position.usdc?.borrowedUsd ?? 0,
    collateralUsd: valueAt(liqPrice),
    bonus: collateral.liquidationBonus,
  });
  const exit = shieldExit({
    totalDebtUsd: position.debtUsd,
    usdcDebtUsd: position.usdc?.borrowedUsd ?? 0,
    trigger,
    liquidationThreshold: collateral.liquidationThreshold,
    collateralUsd: valueAt(trigPrice),
    discountBps: config.exitDiscountBps,
    hfBuffer: config.exitHfBuffer,
  });
  return { aave, exit };
}

function change(from: number, to: number) {
  if (!Number.isFinite(to) || !Number.isFinite(from) || from <= 0) return undefined;
  const p = (to - from) / from;
  return `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(1)}%`;
}

const STATUS_ICON = { armed: ShieldCheck, due: Clock3, warming: Clock3, notArmed: ShieldAlert, blocked: ShieldAlert, loading: Clock3, none: ShieldOff, exited: ShieldCheck } as const;

/** The page header: which market, the cover status (the same words as the cover panel), and the four numbers a borrower checks first. */
export function PositionHeader({ position, title, cover, arm }: { position: AavePosition; title: string; cover?: Cover; arm: ArmState }) {
  const hf = position.healthFactor;
  const Icon = STATUS_ICON[arm.kind];
  const cls = arm.tone === "safe" ? "text-safe" : arm.tone === "caution" ? "text-caution" : arm.tone === "danger" ? "text-danger" : "text-muted-foreground";
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
          <TokenPair a="AAVE" b="MON" size={18} />
          Aave V3, Monad market
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className={cn("mt-1 inline-flex items-center gap-1.5 text-sm font-medium num", cls)} aria-live="off">
          <Icon className="size-4 shrink-0" aria-hidden />
          {headerStatus(arm, cover)}
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

const BASIS_TEXT: Record<AaveLiquidation["basis"], string> = {
  half: "half the debt",
  all: "all of your USDC debt",
  collateral: "as much debt as the collateral covers",
};

function CostCompare({ aave, exit, trigger, bonus, discountBps, symbol }: { aave: AaveLiquidation; exit: ShieldExit; trigger: number; bonus: number; discountBps: number; symbol: string }) {
  const max = Math.max(aave.penaltyUsd, exit.costUsd, 1e-9);
  const repaidBy =
    aave.basis === "half" ? "half of your total debt" : aave.basis === "all" ? "all of your USDC debt" : `as much debt as your ${symbol} can pay for with the bonus`;
  return (
    <div className="rounded-lg bg-raised p-4 sm:p-5">
      <p className="text-[0.9375rem]">
        Aave penalty if liquidated: <strong className="font-semibold text-danger num">{formatUsd(aave.penaltyUsd)}</strong>. Shield:{" "}
        <strong className="font-semibold text-safe num">{formatUsd(exit.costUsd)}</strong>
        <span className="text-muted-foreground">.</span>
        <Info label="What these two numbers are">
          Aave: once your health factor is below 1.00, a liquidator may repay {repaidBy}, about {formatUsd(aave.repayUsd)} at today&rsquo;s debt, and takes a{" "}
          {((bonus - 1) * 100).toFixed(1)}% bonus in {symbol} on top: {formatUsd(aave.penaltyUsd)}. Shield: at {trigger.toFixed(2)} the exit repays about{" "}
          {formatUsd(exit.repayUsd)} of your USDC debt, enough to bring your health factor back to {exit.target.toFixed(2)}, and the vault takes{" "}
          {discountBps / 100}% of that in {symbol}: {formatUsd(exit.costUsd)}. Both are collateral you give up; the premium for cover is separate.
        </Info>
      </p>
      <div className="mt-4 grid gap-3 text-[0.8125rem]">
        <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr]">
          <span className="text-muted-foreground">Aave liquidation</span>
          <span className="h-2.5 rounded-full bg-danger/80" style={{ width: `${Math.max((aave.penaltyUsd / max) * 100, 2)}%` }} aria-hidden />
        </div>
        <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr]">
          <span className="text-muted-foreground">Shield exit at {trigger.toFixed(2)}</span>
          <span className="h-2.5 rounded-full bg-safe" style={{ width: `${Math.max((exit.costUsd / max) * 100, 2)}%` }} aria-hidden />
        </div>
      </div>
      {aave.penaltyUsd > exit.costUsd && (
        <p className="mt-4 text-sm">
          Against a liquidation of {BASIS_TEXT[aave.basis]} you keep <span className="font-semibold text-safe num">{formatUsd(aave.penaltyUsd - exit.costUsd)}</span> more
          collateral, before the premium you pay for cover.
        </p>
      )}
    </div>
  );
}

export function PositionPanel({
  position,
  cover,
  collateral,
  config,
  arm,
  previewTrigger,
  premiumHistory,
}: {
  position: AavePosition;
  cover?: Cover;
  collateral?: ReserveLine;
  config?: ShieldConfig;
  arm: ArmState;
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
  const noDebt = position.debtUsd <= 0;
  // With no debt there is nothing to trigger: no preview, no exit price.
  const trigger = active ? cover!.trigger : noDebt ? undefined : previewTrigger;
  const buffer = config?.exitHfBuffer;

  const live = active && cover ? livePrepaid(cover, block) : undefined;
  const sinceReprice = live?.blocksSince ?? 0;
  const keeperLate = active && !cover!.lapsed && sinceReprice > KEEPER_LATE_BLOCKS;

  const costs = collateral && trigger && config && !noDebt ? compareCosts(position, collateral, trigger, config) : undefined;
  const liqPrice = collateral ? priceAtHf(position, collateral, 1) : Number.NaN;
  const trigPrice = collateral && trigger ? priceAtHf(position, collateral, trigger) : Number.NaN;
  const liqChange = collateral ? change(collateral.priceUsd, liqPrice) : undefined;
  const trigChange = collateral ? change(collateral.priceUsd, trigPrice) : undefined;
  // The active cover's own quote (read every block) when it covers this collateral; else what the Repricer would use.
  const ownSigma = active && cover && collateral && cover.collateral?.toLowerCase() === collateral.asset.toLowerCase() ? cover.sigma : undefined;
  const sigma = useSigma(assetConfigOf(config, collateral?.asset), ownSigma);
  const sharePct = config ? config.protocolShareBps / 100 : undefined;

  return (
    <Panel
      title="Liquidation risk"
      labelledBy="risk-heading"
      description={collateral ? `How far ${collateral.symbol} can fall before Aave liquidates, and where Shield steps in` : undefined}
    >
      <RiskRail
        healthFactor={hf}
        trigger={trigger}
        exitTarget={trigger !== undefined && buffer !== undefined ? trigger + buffer : undefined}
        trail={trail.current}
        armed={active && arm.armed}
        triggerNote={active ? arm.triggerNote : "Trigger, preview"}
      />

      {noDebt && <p className="mt-6 border-t pt-5 text-sm text-muted-foreground">No debt on this position, so nothing can be liquidated and no exit can run.</p>}

      {collateral && !noDebt && (
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
          <Stat
            size="sm"
            label="Liquidation price"
            value={Number.isFinite(liqPrice) && liqPrice > 0 ? formatUsd(liqPrice) : "n/a"}
            hint={liqChange ? `${liqChange} from now` : "Other collateral covers the debt"}
            tone="danger"
          />
          <Stat
            size="sm"
            label={trigger ? (active ? "Exit price" : "Exit price at this trigger") : "Exit price"}
            value={trigger && Number.isFinite(trigPrice) && trigPrice > 0 ? formatUsd(trigPrice) : trigger ? "n/a" : "No trigger"}
            hint={trigger ? (trigChange ? `${trigChange} from now, health factor ${trigger.toFixed(2)}` : `At health factor ${trigger.toFixed(2)}`) : "Set one to see it"}
            tone={trigger ? "caution" : undefined}
          />
        </dl>
      )}

      {collateral && !noDebt && trigger !== undefined && Number.isFinite(trigPrice) && trigPrice > 0 && (
        <ExitChance symbol={collateral.symbol} priceUsd={collateral.priceUsd} exitPriceUsd={trigPrice} sigma={sigma} preview={!active} />
      )}

      {collateral && costs && trigger && config && costs.aave.penaltyUsd > 0 && (
        <div className="mt-6">
          <CostCompare aave={costs.aave} exit={costs.exit} trigger={trigger} bonus={collateral.liquidationBonus} discountBps={config.exitDiscountBps} symbol={collateral.symbol} />
        </div>
      )}

      {active && cover && live && (
        <div className="mt-6 border-t pt-5">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-3">
            <div>
              <p className="flex min-h-6 items-center gap-1 text-[0.8125rem] text-muted-foreground">
                Cover rate
                <Info>
                  k x volatility x debt / max(HF minus trigger, {config?.dMin.toFixed(2) ?? "0.01"}), for one 300&nbsp;ms block. At or below the trigger the
                  distance is the floor, the most expensive rate. Each reprice charges the blocks since the last one at the higher of the stored and the
                  live rate.
                  {sharePct !== undefined &&
                    ` Of what you pay, ${100 - sharePct}% goes to the vault that funds exits and ${sharePct}% to the protocol treasury directly; both belong to the protocol, and the split does not change your rate.`}
                </Info>
              </p>
              <p className="reading mt-1 text-[1.25rem] font-semibold">
                {cover.lapsed ? "Paused" : formatUsd(cover.livePremiumPerBlockUsd * BLOCKS_PER_YEAR)}
                {!cover.lapsed && <span className="text-sm font-normal text-muted-foreground"> a year</span>}
              </p>
              <Sparkline values={[...premiumHistory, cover.livePremiumPerBlockUsd]} className="mt-1.5 h-6 w-full max-w-40 text-brand" />
              <p className="mt-1 text-[0.8125rem] text-muted-foreground" aria-live="off">
                Cover this block: <span className="num">{cover.lapsed ? "paused" : formatUsd(live.rate)}</span>
              </p>
            </div>
            <dl className="contents">
              <Stat
                label="Prepaid balance"
                value={formatUsd(live.prepaidUsd)}
                tone={cover.lapsed ? "caution" : undefined}
                hint={cover.lapsed ? "Used up: top up to re-arm" : `Lasts ${formatRunway(runwayDays(live.prepaidUsd, live.rate))}`}
              />
              <Stat label="Premium paid so far" value={formatUsd(live.accruedUsd)} hint={`Volatility ${formatPct(cover.sigma, 0)} a year, from Pyth`} />
            </dl>
          </div>
          {!cover.lapsed && (
            <p className={cn("mt-4 text-[0.8125rem] num", keeperLate ? "text-caution" : "text-muted-foreground")} role={keeperLate ? "status" : undefined}>
              {keeperLate
                ? `The keeper has not repriced recently: last reprice ${sinceReprice.toLocaleString("en-US")} blocks ago. The premium still accrues on chain, and an exit stays open to anyone.`
                : `Last repriced ${sinceReprice === 0 ? "this block" : `${sinceReprice.toLocaleString("en-US")} block${sinceReprice === 1 ? "" : "s"} ago`}.`}
            </p>
          )}
        </div>
      )}

      {collateral && config && !noDebt && Number.isFinite(hf) && collateral.suppliedRaw > 0n && (
        <PriceSimulator position={position} collateral={collateral} config={config} trigger={trigger} preview={!active} />
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
                  {r.suppliedRaw > 0n ? (
                    <>
                      <span className="block">{formatToken(r.supplied)}</span>
                      <span className="block text-[0.8125rem] text-muted-foreground">{formatUsd(r.suppliedUsd)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground" aria-label="None">-</span>
                  )}
                </td>
                <td className="px-3 py-3.5 text-right">
                  {r.borrowedRaw > 0n ? (
                    <>
                      <span className="block">{formatToken(r.borrowed)}</span>
                      <span className="block text-[0.8125rem] text-muted-foreground">{formatUsd(r.borrowedUsd)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground" aria-label="None">-</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right sm:px-6">
                  {r.suppliedRaw > 0n ? formatPct(r.liquidationThreshold, 1) : <span className="text-muted-foreground" aria-label="Not collateral">-</span>}
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
    <div className="grid gap-6" aria-busy="true" aria-label="Loading the Aave position">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-56" />
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 lg:flex lg:gap-x-10">
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
