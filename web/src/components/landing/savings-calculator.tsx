"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { aavePenaltyUsd, shieldExitUsd } from "@/lib/economics";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const LT = 0.84;
const BONUS = 1.055;
const TRIGGER = 1.05;
const PRESETS = [10_000, 50_000, 250_000, 1_000_000];
/** Slider position 0..100 maps to $5,000..$2,000,000 on a log scale. */
const MIN = Math.log10(5_000);
const MAX = Math.log10(2_000_000);
const toDebt = (p: number) => Math.round(10 ** (MIN + ((MAX - MIN) * p) / 100) / 1000) * 1000;
const toPos = (d: number) => ((Math.log10(d) - MIN) / (MAX - MIN)) * 100;

const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

/** What a liquidation would take from a WETH-backed USDC loan, against what a Shield exit at 1.05 costs. */
export function SavingsCalculator() {
  const [debt, setDebt] = useState(100_000);
  const collateral = (debt * 1.07) / LT;
  const penalty = aavePenaltyUsd(debt, collateral, BONUS);
  const exit = shieldExitUsd({ debtUsd: debt, trigger: TRIGGER, liquidationThreshold: LT });
  const premiumFar = 0.00125 * 0.8 * debt / 0.2;
  const max = Math.max(penalty, exit.costUsd);

  return (
    <div className="panel grid overflow-hidden lg:grid-cols-[1fr_1.15fr]">
      <div className="border-b p-6 sm:p-8 lg:border-b-0 lg:border-r">
        <label htmlFor="calc-debt" className="text-sm font-medium">
          USDC borrowed against WETH
        </label>
        <p className="reading mt-2 text-[2.5rem] font-medium leading-none">{whole.format(debt)}</p>
        <Slider id="calc-debt" className="mt-6" min={0} max={100} step={0.5} value={[toPos(debt)]} onValueChange={(v) => setDebt(toDebt(v[0]!))} aria-label="USDC borrowed" />
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Loan sizes">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDebt(p)}
              aria-pressed={debt === p}
              className={cn(
                "h-8 rounded-full border px-3 text-[0.8125rem] font-medium num transition-colors",
                debt === p ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {compact.format(p)}
            </button>
          ))}
        </div>
        <p className="mt-6 text-[0.8125rem] text-muted-foreground">
          Assumes Aave V3 Monad&rsquo;s WETH terms: liquidation threshold 84%, liquidation penalty 5.5% on half the debt. Shield exits at a health
          factor of {TRIGGER.toFixed(2)} and repays enough to restore {(TRIGGER + 0.06).toFixed(2)}.
        </p>
      </div>
      <div className="p-6 sm:p-8">
        <dl className="grid gap-6">
          <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
            <dt className="text-sm text-muted-foreground">If Aave liquidates you</dt>
            <dd className="reading text-[1.5rem] font-semibold text-danger">&minus;{formatUsd(penalty)}</dd>
            <dd className="col-span-2 mt-2 h-3 rounded-full bg-muted" aria-hidden>
              <div className="h-3 rounded-full bg-danger/85" style={{ width: `${(penalty / max) * 100}%` }} />
            </dd>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
            <dt className="text-sm text-muted-foreground">If Shield exits first</dt>
            <dd className="reading text-[1.5rem] font-semibold text-safe">&minus;{formatUsd(exit.costUsd)}</dd>
            <dd className="col-span-2 mt-2 h-3 rounded-full bg-muted" aria-hidden>
              <div className="h-3 rounded-full bg-safe" style={{ width: `${Math.max((exit.costUsd / max) * 100, 1)}%` }} />
            </dd>
          </div>
        </dl>
        <div className="mt-8 rounded-lg bg-raised p-4">
          <p className="text-sm">
            You keep <strong className="font-semibold num">{formatUsd(penalty - exit.costUsd)}</strong> of collateral that a liquidator would have taken.
          </p>
          <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
            Cover is paid while you hold it: about <span className="num">{formatUsd(premiumFar)}</span> a year at 80% ETH volatility with your health
            factor 0.20 above the trigger. It rises as you get closer and stops when you opt out.
          </p>
        </div>
      </div>
    </div>
  );
}
