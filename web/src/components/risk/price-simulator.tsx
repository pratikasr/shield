"use client";

import { CircleCheck, ShieldAlert, TriangleAlert } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import { useMemo, useState } from "react";
import { Chip } from "@/components/data/chip";
import { Info } from "@/components/data/info";
import { Stat } from "@/components/data/stat";
import { hfTone } from "@/components/risk/risk-rail";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import type { Sigma } from "@/hooks/useSigma";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import { formatHf, formatPct, formatUsd } from "@/lib/format";
import { YEARS_24H, YEARS_7D, anchoredModel, formatChance, simulateMove, touchProbability, type Simulation } from "@/lib/risk-math";
import { cn } from "@/lib/utils";

const RANGE = 30;

/** "-12%" or "+5%" with a real minus sign; "0%" unsigned. */
function signed(pct: number, digits = 0): string {
  if (Math.abs(pct) < 0.5 * 10 ** -digits) return `${(0).toFixed(digits)}%`;
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(digits)}%`;
}

/** The slider position (whole percent) at or just past a threshold move, so the state it shows has been reached. */
function stepPast(move: number): number | undefined {
  if (!Number.isFinite(move)) return undefined;
  const p = Math.floor(move * 100 - 1e-9);
  return p >= -RANGE && p <= RANGE ? p : undefined;
}

function Status({ sim, triggerWord }: { sim: Simulation; triggerWord: string }) {
  const base = "flex items-start gap-2 text-sm font-medium";
  if (sim.liquidatable)
    return (
      <p className={cn(base, "text-danger")}>
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Below 1.00: without Shield, Aave could liquidate.
          {sim.shield ? ` With Shield, the exit would already have run at ${triggerWord}.` : ""}
        </span>
      </p>
    );
  if (sim.exitFires)
    return (
      <p className={cn(base, "text-caution")}>
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>At or below {triggerWord}: the exit would run.</span>
      </p>
    );
  return (
    <p className={cn(base, "text-safe")}>
      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{triggerWord === "no trigger" ? "Above 1.00: Aave would not liquidate." : `Above ${triggerWord}: nothing happens.`}</span>
    </p>
  );
}

/**
 * "If WETH moves": the health factor at a price from 30% below to 30% above today's, whether the exit would run or
 * Aave could liquidate there, and what each would cost. Only the chosen collateral's price moves; USDC debt and any
 * other collateral stay at their prices (lib/risk-math.ts).
 */
export function PriceSimulator({
  position,
  collateral,
  config,
  trigger,
  preview,
}: {
  position: AavePosition;
  collateral: ReserveLine;
  config: Pick<ShieldConfig, "exitDiscountBps" | "exitHfBuffer">;
  trigger?: number;
  /** The trigger is being chosen, not on chain. */
  preview: boolean;
}) {
  const [pct, setPct] = useState(0);
  const symbol = collateral.symbol;
  const input = useMemo(
    () => ({
      model: anchoredModel({
        healthFactor: position.healthFactor,
        debtUsd: position.debtUsd,
        movedSuppliedUsd: collateral.suppliedUsd,
        movedBorrowedUsd: collateral.borrowedUsd,
        liquidationThreshold: collateral.liquidationThreshold,
      }),
      priceUsd: collateral.priceUsd,
      suppliedUsd: collateral.suppliedUsd,
      liquidationThreshold: collateral.liquidationThreshold,
      bonus: collateral.liquidationBonus,
      usdcDebtUsd: position.usdc?.borrowedUsd ?? 0,
      trigger,
      discountBps: config.exitDiscountBps,
      hfBuffer: config.exitHfBuffer,
    }),
    [position, collateral, trigger, config.exitDiscountBps, config.exitHfBuffer],
  );
  const sim = simulateMove(input, pct / 100);
  const triggerWord = trigger === undefined ? "no trigger" : `${preview ? "this trigger" : "your trigger"}, ${trigger.toFixed(2)}`;
  const exitAt = stepPast(sim.exitMove);
  const liqAt = stepPast(sim.liquidationMove);
  const at = (move: number) => `${((move + RANGE / 100) / ((2 * RANGE) / 100)) * 100}%`;
  const clampMove = (m: number) => Math.min(Math.max(m, -RANGE / 100), RANGE / 100);
  const bonusPct = ((collateral.liquidationBonus - 1) * 100).toFixed(1);

  const zone = (from: number, to: number, cls: string) =>
    Number.isFinite(from) && Number.isFinite(to) && to > from ? (
      <span className={cn("absolute inset-y-0", cls)} style={{ left: at(clampMove(from)), width: `calc(${at(clampMove(to))} - ${at(clampMove(from))})` }} />
    ) : null;

  return (
    <section className="mt-6 border-t pt-5" aria-labelledby="sim-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-1">
          <h3 id="sim-heading" className="text-[0.9375rem] font-semibold">
            If {symbol} moves
          </h3>
          <Info label="How the simulator works">
            Aave&rsquo;s health factor at a {symbol} price you choose: your supplied collateral times each liquidation threshold, over your debt. Only {symbol}
            &rsquo;s price moves; USDC debt and any other collateral stay where they are, and interest is left out. The exit is sized the way the Executor sizes it,
            at the price where it would run on the way down.
          </Info>
        </div>
        <p className="num text-sm text-muted-foreground" aria-live="off">
          <span className="reading text-[1.25rem] font-semibold text-foreground">{signed(pct)}</span> to {formatUsd(sim.priceUsd)}
        </p>
      </div>

      <SliderPrimitive.Root
        className="relative mt-4 flex h-6 w-full touch-none select-none items-center"
        min={-RANGE}
        max={RANGE}
        step={1}
        value={[pct]}
        onValueChange={(v) => setPct(v[0] ?? 0)}
      >
        {/* The same colours as the gauge above: red where Aave could liquidate, amber where the exit would run. */}
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted">
          {zone(-RANGE / 100, sim.liquidationMove, "bg-danger/80")}
          {zone(Number.isFinite(sim.liquidationMove) ? Math.max(sim.liquidationMove, -RANGE / 100) : -RANGE / 100, sim.exitMove, "bg-caution/45")}
        </SliderPrimitive.Track>
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-muted-foreground/60" aria-hidden />
        {Number.isFinite(sim.liquidationMove) && Math.abs(sim.liquidationMove) <= RANGE / 100 && (
          <span className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger" style={{ left: at(sim.liquidationMove) }} aria-hidden />
        )}
        {Number.isFinite(sim.exitMove) && Math.abs(sim.exitMove) <= RANGE / 100 && (
          <span className="pointer-events-none absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-caution" style={{ left: at(sim.exitMove) }} aria-hidden />
        )}
        <SliderPrimitive.Thumb
          aria-label={`${symbol} price move`}
          aria-valuetext={`${symbol} ${signed(pct)}, ${formatUsd(sim.priceUsd)}, health factor ${formatHf(sim.healthFactor)}`}
          className="relative block size-5 rounded-full border-2 border-foreground bg-card shadow-sm ring-ring/40 transition-[box-shadow] after:absolute after:-inset-2.5 hover:ring-4 focus-visible:outline-hidden focus-visible:ring-4"
        />
      </SliderPrimitive.Root>
      <div className="mt-1.5 flex justify-between text-[0.6875rem] text-muted-foreground num" aria-hidden>
        <span>{signed(-RANGE)}</span>
        <span>Today</span>
        <span>{signed(RANGE)}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Jump to a price">
        <Chip active={pct === 0} onClick={() => setPct(0)}>
          Today
        </Chip>
        {exitAt !== undefined && exitAt !== 0 && (
          <Chip active={pct === exitAt} onClick={() => setPct(exitAt)}>
            Exit price, {signed(exitAt)}
          </Chip>
        )}
        {liqAt !== undefined && liqAt !== 0 && (
          <Chip active={pct === liqAt} onClick={() => setPct(liqAt)}>
            Liquidation price, {signed(liqAt)}
          </Chip>
        )}
      </div>

      <div className="mt-4">
        <Status sim={sim} triggerWord={triggerWord} />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Stat
          size="sm"
          label="Health factor"
          value={formatHf(sim.healthFactor)}
          tone={hfTone(sim.healthFactor)}
          hint={`At ${symbol} ${formatUsd(sim.priceUsd)}`}
        />
        <Stat
          size="sm"
          label="Without Shield"
          value={sim.aave ? `${formatUsd(sim.aave.penaltyUsd)} penalty` : "No liquidation"}
          tone={sim.aave ? "danger" : undefined}
          hint={
            sim.aave
              ? `Aave's ${bonusPct}% bonus on ${formatUsd(sim.aave.repayUsd)} a liquidator may repay${sim.healthFactor <= 0.95 ? ", all of the USDC debt below 0.95" : ""}`
              : "Aave liquidates only below 1.00"
          }
        />
        <Stat
          size="sm"
          label="With Shield"
          value={sim.shield ? `${formatUsd(sim.shield.costUsd)} exit cost` : trigger === undefined ? "No trigger" : "No exit"}
          tone={sim.shield ? "safe" : undefined}
          hint={
            sim.shield
              ? `${formatPct(config.exitDiscountBps / 10_000, 0)} of ${formatUsd(sim.shield.repayUsd)} repaid ${sim.shield.move === 0 ? "now" : `at ${formatUsd(sim.shield.priceUsd)}`}; health factor ${formatHf(sim.shield.healthFactorAfter)} after, at this price`
              : trigger === undefined
                ? "Set a trigger to compare"
                : `Runs only at or below ${trigger.toFixed(2)}`
          }
        />
      </dl>
    </section>
  );
}

/**
 * The chance the collateral's price touches the exit price within 24 hours and 7 days: a zero-drift lognormal
 * estimate with the volatility the Repricer prices the cover with (lib/risk-math.ts). Labelled as an estimate, with
 * the model and what it leaves out one tap away.
 */
export function ExitChance({ symbol, priceUsd, exitPriceUsd, sigma, preview }: { symbol: string; priceUsd: number; exitPriceUsd: number; sigma?: Sigma; preview: boolean }) {
  if (!sigma || !(priceUsd > 0) || !(exitPriceUsd > 0)) return null;
  const p24 = touchProbability({ spot: priceUsd, barrier: exitPriceUsd, sigma: sigma.value, years: YEARS_24H });
  const p7 = touchProbability({ spot: priceUsd, barrier: exitPriceUsd, sigma: sigma.value, years: YEARS_7D });
  const atOrBelow = exitPriceUsd >= priceUsd;
  const sigmaText = `${formatPct(sigma.value, 0)} a year`;
  return (
    <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-lg bg-raised px-4 py-3 text-[0.8125rem]">
      <p className="text-muted-foreground">
        Estimated chance {symbol} touches the exit price{preview ? " at this trigger" : ""}{" "}
        <Info label="How this estimate is made">
          An estimate, not a forecast. It assumes {symbol}&rsquo;s price moves as a random walk with no drift and a constant volatility of {sigmaText}, the
          {sigma.source === "measured" ? " volatility the Repricer measures from recent Pyth prices" : " Repricer's fallback volatility, used until enough Pyth prices are recorded"}
          . Chance = 2 &times; &Phi;(ln(exit price &divide; price now) &divide; (volatility &times; &radic;time)), with the price now {formatUsd(priceUsd)} and
          the exit price {formatUsd(exitPriceUsd)}. It looks at the price only and ignores interest on your debt, new borrowing, repayments and changes to
          other collateral, which all move the exit price.
        </Info>
      </p>
      {atOrBelow ? (
        <p className="font-medium text-caution">At or below the exit price now</p>
      ) : (
        <p className="num text-muted-foreground">
          <strong className="font-semibold text-foreground">{formatChance(p24)}</strong> within 24 hours,{" "}
          <strong className="font-semibold text-foreground">{formatChance(p7)}</strong> within 7 days
        </p>
      )}
    </div>
  );
}
